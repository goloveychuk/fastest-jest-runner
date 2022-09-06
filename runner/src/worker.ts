import * as fs from 'fs';
import { createTestEnv, TestEnv } from './create-test-env';
import {
  WorkerConfig,
  makeErrorResp,
  RunTest,
  WorkerInput,
  WorkerResponse,
} from './types';
import { createSyncFifoReader } from './protocol';
import * as addon from './addon';
import type { Fifo } from './fifo-maker';
import RuntimeMod from 'jest-runtime';
import HasteMap, { IModuleMap } from 'jest-haste-map';
import { buildSnapshot } from './snapshot';


// console.log(process.argv[2]);
// fs.readFileSync(process.argv[2], 'utf8')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runGc = async () => {
  global.gc?.();
  global.gc?.();

  await sleep(300); //waiting for gc??
};

function handleChild(testEnv: TestEnv, payload: WorkerInput.RunTest) {
  let handled = false;

  const handle = (data: WorkerResponse.Response['testResult']) => {
    if (handled) {
      console.warn('already handled, fix me');
      return;
    }
    handled = true;
  
    const resp: WorkerResponse.Response = {
      pid: process.pid,
      testResult: data,
    };
    console.log('writing to', payload.resultFifo.path);
    fs.writeFileSync(payload.resultFifo.path, JSON.stringify(resp));
    addon.sendThisProcOk();
    // });
  };

  process.on('unhandledRejection', (reason, _promise) => {
    //better to merge results
    const throwOnUnhandled = false; //todo
    const err: Error = (reason as any) || new Error();
    const ignText = throwOnUnhandled ? '' : ' (ignored)';
    err.message = `unhandledRejection${ignText}: ${err.message}`;
    if (throwOnUnhandled) {
      handle(makeErrorResp(err));
    } else {
      console.error(err);
    }
  });
  process.on('uncaughtException', (err) => {
    err.message = 'uncaughtException: ' + err.message;
    handle(makeErrorResp(err));
  });
  process.on('exit', (code) => {
    if (handled) {
      return;
    }
    handle(makeErrorResp('exited before result: ' + code));
  });

  testEnv
    .runTest(payload.testPath)
    .then(
      (data) => handle({ type: 'result', data }),
      (err) => handle(makeErrorResp(err)),
    )
    .finally(() => {
      console.log('exiting');
      process.exit(0);
    });
}

async function spinSnapshot(
  workerConfig: WorkerConfig,
  testEnv: TestEnv,
  payload: WorkerInput.SpinSnapshot,
) {
  await buildSnapshot(workerConfig.snapshotConfig, testEnv, payload.name);
  await runGc();
  if (loop(workerConfig, testEnv, payload.snapFifo) === 'main') {
    console.log('snapshot loop stopped: ' + payload.name);
    addon.sendThisProcOk();
    addon.waitForAllChildren();
    process.exit(0);
  }
}

function loop(
  workerConfig: WorkerConfig,
  testEnv: TestEnv,
  fifo: Fifo,
): 'child' | 'main' {
  const reader = createSyncFifoReader<WorkerInput.Input>(fifo);

  while (true) {
    const payload = reader.read();
    switch (payload.type) {
      case 'stop': {
        return 'main';
      }
      case 'spinSnapshot': {
        const childPid = addon.fork(payload.snapFifo.id);
        debugger;
        const isChild = childPid === 0;
        if (isChild) {
          spinSnapshot(workerConfig, testEnv, payload).catch((err) => {
            console.error('err in spinSnapshot', err);
            //todo handle properly
          });
          return 'child';
        } else {
          continue;
        }
      }
      case 'test': {
        console.log('got test job', payload.testPath);
        const childPid = addon.fork(payload.resultFifo.id);

        // const res = 0 ;
        const isChild = childPid === 0;

        if (isChild) {
          handleChild(testEnv, payload);
          return 'child';
        } else {
          continue;
        }
      }
      default: {
        // @ts-expect-error
        throw new Error('bad payload type: ' + payload.type);
      }
    }
  }
}

function run(workerConfig: WorkerConfig) {
  const moduleMap = HasteMap.getStatic(
    workerConfig.projectConfig,
  ).getModuleMapFromJSON(workerConfig.serializableModuleMap);

  const resolver = RuntimeMod.createResolver(
    workerConfig.projectConfig,
    moduleMap,
  );

  createTestEnv({
    context: workerConfig.context,
    globalConfig: workerConfig.globalConfig,
    projectConfig: workerConfig.projectConfig,
    resolver,
  })
    .then(async (testEnv) => {
      await runGc();

      console.log('setRunTestFn');

      console.log('before loop');
      addon.startProcControl(workerConfig.procControlFifo.path);

      if (loop(workerConfig, testEnv, workerConfig.workerFifo) === 'main') {
        console.log('worker loop stopped');
        addon.waitForAllChildren();
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('err in setRunTestFn', err);
      process.exit(1);
    });
}

process.on('message', function handler(payload) {
  process.off('message', handler);
  run(payload);
});
