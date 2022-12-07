import { createTestEnv, TestEnv } from './create-test-env';
import {
  WorkerConfig,
  makeErrorResp,
  RunTest,
  WorkerInput,
  WorkerResponse,
} from './types';
import * as addon from './addon';
import RuntimeMod from 'jest-runtime';
import HasteMap from 'jest-haste-map';
import { buildSnapshot } from './snapshots/build';
import { createTimings, Timing } from './log';
import { ProcessLike } from './wrapChild';

// console.log(process.argv[2]);
// fs.readFileSync(process.argv[2], 'utf8')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runGc = async () => {
  global.gc?.();
  global.gc?.();

  await sleep(300); //waiting for gc??
};

function handleChild(
  childProcess: ProcessLike,
  __timing: Timing,
  testEnv: TestEnv,
  payload: WorkerInput.RunTest,
) {
  let handled = false;

  const handle = async (data: WorkerResponse.Response['testResult']) => {
    if (handled) {
      console.warn('already handled, fix me');
      return;
    }
    handled = true;
    // __timing.time('handleTestRes', 'start');
    const resp: WorkerResponse.Response = {
      testId: payload.testId,
      pid: process.pid,
      testResult: data,
    };
    // __timing.time('writeResult', 'start');
    // fs.writeFileSync(payload.resultFifo.path, JSON.stringify(resp));
    // await sendRequest(payload.resPath, resp);
    await childProcess.send(resp); //TODO
    // __timing.time('writeResult', 'end');
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

// async function spinSnapshot(
//   workerConfig: WorkerConfig,
//   testEnv: TestEnv,
//   payload: WorkerInput.SpinSnapshot,
// ) {

// }

interface Loop<P> {
  handle(payload: P): HandleRes;
}
let req = 0

function createSnapshotLoop(
  parent: ProcessLike,
  testEnv: TestEnv,
): Loop<WorkerInput.RunTest> {
  console.log('createSnapshotLoop');
  return {
    handle: async (payload) => {
      // console.log('snap', payload);
      const __timing = createTimings();

      __timing.time('fork', 'start');
      const childProcess = addon.fork();
      // const res = 0 ;
      if (childProcess.isChild) {
        // reader.stop()
        __timing.time('fork', 'end');
        handleChild(childProcess, __timing, testEnv, payload);
        return 'child';
      } else {
        childProcess.on('message', (msg) => {
          parent.send(msg);
        });
      }
    },
  };
}

function runLoop(
  loop: Loop<unknown>,
  pr: ProcessLike,
): Promise<'main' | 'child'> {
  return new Promise((resolve) => {
    pr.on('message', async (msg) => {
      try {
        const res = await loop.handle(msg);
        if (res === 'child') {
          resolve('child');
        } else {
          return;
        }
      } catch (err) {
        console.error('err in loop', err);
      }
    });
  });
}

type HandleRes = Promise<void | 'child'>;

function createWorkerLoop(
  workerConfig: WorkerConfig,
  testEnv: TestEnv,
): Loop<WorkerInput.Input> {
  const snapshots = new Map<string, Promise<addon.ForkedProcess>>();

  async function spinSnapshot(payload: WorkerInput.SpinSnapshot) {
    const childProcess = addon.fork();
    let resolve: any;
    const promise = new Promise<addon.ForkedProcess>( _resolve => {
      resolve = _resolve
    })
    snapshots.set(payload.name, promise)
    if (childProcess.isChild) {
      // reader.stop()
      // console.log(process.channel)
      process.disconnect()
      // process.channel?.close?.()
      await buildSnapshot(workerConfig.snapshotConfig, testEnv, payload.name);
      await runGc();
      const snapshotLoop = createSnapshotLoop(childProcess, testEnv);
      if ((await runLoop(snapshotLoop, childProcess)) === 'main') {
        //todo handle
        console.log('snapshot loop stopped: ' + payload.name);
        addon.waitForAllChildren();
        process.exit(0);
      }

      // spinSnapshot(workerConfig, testEnv, payload).catch((err) => {
      //   console.error('err in spinSnapshot', err);
      //   //todo handle properly
      // });
      return 'child';
    } else {
      resolve(childProcess);
      childProcess.on('message', (msg) => {
        console.log('got test resp', ++req, process.pid, msg)
        process.send!(msg);
      });
      console.log('set snapshot', payload.name);
    }
  }
  return {
    async handle(payload) {
      switch (payload.type) {
        case 'spinSnapshot': {
          const res = await spinSnapshot(payload);
          return res
          break;
        }
        case 'test': {
          // await sleep(10000);
          const snap = await snapshots.get(payload.snapshotName);
          if (!snap) {
            throw new Error(
              'no snapshot: ' + payload.snapshotName + snapshots.size,
            );
            // return
          }
          console.log('has snapshot~~~~~~~~~~~~~~!!!!!!!!!');
          await snap.send(payload, console.log); //todo
          break;
        }
        default: {
          // @ts-expect-error
          throw new Error('bad payload type: ' + payload.type);
        }
      }
    },
  };
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

      const workerLoop = createWorkerLoop(workerConfig, testEnv);
      if ((await runLoop(workerLoop, process as any)) === 'main') {
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

// `Proc exited without response, status=${data.status}`,
