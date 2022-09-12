import * as fs from 'fs';
import { createTestEnv, TestEnv } from './create-test-env';
import {
  WorkerConfig,
  makeErrorResp,
  RunTest,
  WorkerInput,
  WorkerResponse,
} from './types';
import { createAsyncFifoReader, createSyncFifoReader } from './protocol';
import * as addon from './addon';
import type { Fifo } from './fifo-maker';
import RuntimeMod from 'jest-runtime';
import HasteMap from 'jest-haste-map';
import { buildSnapshot } from './snapshots/build';
import { createTimings, Timing } from './log';


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

  const handle = (data: WorkerResponse.Response['testResult']) => {
    if (handled) {
      console.warn('already handled, fix me');
      return;
    }
    handled = true;
    // __timing.time('handleTestRes', 'start');
    const resp: WorkerResponse.Response = {
      pid: process.pid,
      testResult: data,
    };
    console.log('writing to', payload.resultFifo.path);
    // __timing.time('writeResult', 'start');
    fs.writeFileSync(payload.resultFifo.path, JSON.stringify(resp));
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
  if (await loop(workerConfig, testEnv, payload.snapFifo) === 'main') {
    console.log('snapshot loop stopped: ' + payload.name);
    addon.sendThisProcOk();
    addon.waitForAllChildren();
    process.exit(0);
  }
}

async function loop(
  workerConfig: WorkerConfig,
  testEnv: TestEnv,
  fifo: Fifo,
): Promise<'child' | 'main' | 'asd'> {

  const reader = await createAsyncFifoReader<WorkerInput.Input>(fifo);
  let loopStart = Date.now()
  let anything = false
  loop: while (true) {

    // console.error('!!loop!!', Math.round((Date.now() - loopStart)/1000))
    // const was = Date.now();
    if (fifo.id == 0) {
      // console.error('loop waiting', fifo.id, process.pid)
    }
    const payload = await reader.read();
    // console.error('got msg', fifo.id, process.pid, payload.type)
    // if (fifo.id == 0) {
    //   console.error('loop read', fifo.id)
    // }
    loopStart = Date.now()
    // console.error('!!reader.read()!!', Math.round((Date.now() - was)/1000))
    switch (payload.type) {
      case 'stop': {
        return 'main';
      }
      case 'spinSnapshot': {
        const childPid = addon.fork(payload.snapFifo.id);
        // debugger;

        console.error('fork!spinSnapshot!!!', process.pid)
        const isChild = childPid === 0;
        if (isChild) {
          reader.closeFd()
          spinSnapshot(workerConfig, testEnv, payload).catch((err) => {
            console.error('err in spinSnapshot', err);
            //todo handle properly
          });
          return 'child';
        } else {
          // reader.closeFd()
          // anything = true
          console.error('subscribed!!!!!!!');
          process.on('message', d => {
            console.error(d, process.pid)
          });
          (async() => {
            const reader = await createAsyncFifoReader<WorkerInput.Input>(workerConfig.fifo2);
            while (true) {
              const d = await reader.read();
              console.error('cycle', d.type)
            }
          })()
          setInterval(() => {
            console.error('tick')
          }, 1000)
          continue loop;
          // return 'asd'
        }
      }
      case 'test': {
        const __timing = createTimings()

        __timing.time('fork', 'start');
        const childPid = addon.fork(payload.resultFifo.id);
        // const res = 0 ;
        const isChild = childPid === 0;

        if (isChild) {
          reader.closeFd()
          __timing.time('fork', 'end');
          handleChild(__timing, testEnv, payload);
          return 'child';
        } else {
          continue loop;
        }
      }
      case 'ping': {
        console.error('!!pong', Math.round((Date.now() - payload.time)/1000))
        continue loop;
      }
      default: {

        // throw new Error('bad payload type: ' + payload.type);
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

      
      if (await loop(workerConfig, testEnv, workerConfig.workerFifo) === 'main') {
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
