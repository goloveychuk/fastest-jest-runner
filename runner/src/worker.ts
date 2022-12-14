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
import HasteMap from 'jest-haste-map';
import { buildSnapshot } from './snapshots/build';
import { createTimings, debugLog, Timing } from './log';
import { connectToServer, sendRequest } from './socket';


// console.log(process.argv[2]);
// fs.readFileSync(process.argv[2], 'utf8')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runGc = async () => {
  global.gc?.();
  global.gc?.();

  await sleep(300); //waiting for gc??
};

function handleChild(__timing: Timing, testEnv: TestEnv, payload: WorkerInput.RunTest) {
  let handled = false;

  const handle = async (data: WorkerResponse.Response['testResult']) => {
    if (handled) {
      console.warn('already handled, fix me');
      return;
    }
    handled = true;
    // __timing.time('handleTestRes', 'start');
    const resp: WorkerResponse.Response = {
      id: payload.resultFifo.id,
      pid: process.pid,
      testResult: data,
    };
    debugLog('writing to', payload.resultFifo.path);
    // __timing.time('writeResult', 'start');
    // fs.writeFileSync(payload.resultFifo.path, JSON.stringify(resp));
    await sendRequest(payload.resPath, resp)
    // __timing.time('writeResult', 'end');
    addon.sendThisProcOk();
    // __timing.time('handleTestRes', 'end');
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

  __timing.time('innerRunTest', 'start');
  testEnv
    .runTest(payload.testPath)
    .then(
      (data) => {
        __timing.time('innerRunTest', 'end');
        return handle({ type: 'result', data: __timing.enrich(data) });
      },
      (err) => {
        // __timing.time('innerRunTest', 'end');
        return handle(makeErrorResp(err));
      },
    )
    .finally(() => {
      debugLog('exiting');
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
  if (await loop(workerConfig, testEnv, payload.snapFifo) === 'main') {
    debugLog('snapshot loop stopped: ' + payload.name);
    addon.sendThisProcOk();
    addon.waitForAllChildren();
    process.exit(0);
  }
}

async function loop(
  workerConfig: WorkerConfig,
  testEnv: TestEnv,
  fifo: Fifo,
): Promise<'child' | 'main'> {
  const reader = await connectToServer<WorkerInput.Input>(fifo.path);

  for await (const payload of reader.gen()) {
    switch (payload.type) {
      case 'spinSnapshot': {
        const childPid = addon.fork(payload.snapFifo.id);
        const isChild = childPid === 0;
        if (isChild) {
          reader.stop()
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
        const __timing = createTimings()

        __timing.time('fork', 'start');
        const childPid = addon.fork(payload.resultFifo.id);
        // const res = 0 ;
        const isChild = childPid === 0;

        if (isChild) {
          reader.stop()
          __timing.time('fork', 'end');
          handleChild(__timing, testEnv, payload);
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
  reader.stop()
  return 'main'
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
      debugLog('before loop');
      addon.startProcControl(workerConfig.procControlFifo.path);

      if (await loop(workerConfig, testEnv, workerConfig.workerFifo) === 'main') {
        debugLog('worker loop stopped');
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
