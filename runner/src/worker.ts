import * as fs from 'fs';
import {createTestEnv, TestEnv} from './create-test-env';
import {CreateSnapshotInput, makeErrorResp, RunTest, WorkerInput, WorkerResponse} from './types';
import {createSyncFifoReader} from './protocol';
import * as addon from './addon';
import type {SnapshotBuilderModule} from './snapshot';
import type { Fifo } from './fifo-maker';

// console.log(process.argv[2]);
// fs.readFileSync(process.argv[2], 'utf8')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const snapshotInput: CreateSnapshotInput = JSON.parse(
  fs.readFileSync(process.argv[2], 'utf8'),
);



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
    // return new Promise<void>((resolve, reject) => {
    // console.log('sending resp', input)
    console.log(
      'resultsasd',
      Boolean((data.data as any).numPassingTests !== undefined),
      payload.testPath,
    );
    const resp: WorkerResponse.Response = {
      pid: process.pid,
      testResult: data,
    };
    console.log('writing to', payload.resultFifo.path);
    fs.writeFileSync(payload.resultFifo.path, JSON.stringify(resp));
    addon.sendThisProcOk()
    // });
  };

  process.on('unhandledRejection', (reason, _promise) => { //better to merge results
    const throwOnUnhandled = false //todo
    const err: Error = (reason as any) || new Error();
    const ignText = throwOnUnhandled ? '' : ' (ignored)';
    err.message = `unhandledRejection${ignText}: ${err.message}`;
    if (throwOnUnhandled) {
      handle(makeErrorResp(err));
    } else {
      console.error(err)
    }
  });
  process.on('uncaughtException', err => {
    err.message = 'uncaughtException: ' + err.message;
    handle(makeErrorResp(err));
  });
  process.on('exit', code => {
    if (handled) {
      return;
    }
    handle(makeErrorResp('exited before result: ' + code));
  });

  testEnv.runTest(payload.testPath)
    .then(
      data => handle({type: 'result', data}),
      err => handle(makeErrorResp(err)),
    )
    .finally(() => {    
      console.log('exiting');
      process.exit(0);
    });
}



async function spinSnapshot(testEnv: TestEnv, payload: WorkerInput.SpinSnapshot) {
  const {runtime } = testEnv;
  const imp = async <T>(_mod: string): Promise<T> => {
    const resolved = testEnv.resolver.resolveModule(
      snapshotInput.snapshotConfig.snapshotBuilderPath,
      _mod,
    );
    console.log('requiring', resolved);
    const esm = runtime.unstable_shouldLoadAsEsm(resolved);

    if (esm) {
      const esmmod: any = await runtime.unstable_importModule(resolved);
      return esmmod.exports
    } else {
      return runtime.requireModule(resolved);
    }
  };
  //todo move to worker
  //todo mb run snapshotBuilderPath in test context
  const snapshotBuilder = await testEnv.transformer.requireAndTranspileModule<SnapshotBuilderModule>(snapshotInput.snapshotConfig.snapshotBuilderPath);

  const build = snapshotBuilder.snapshots[payload.name];
  if (!build) {
    throw new Error('No snapshot with name: ' + payload.name);
  }
  await build({import: imp, global: testEnv.environment.global});
  await runGc();

  if (loop(testEnv, payload.snapFifo) === 'main') {
    console.log('snapshot loop stopped: ' + payload.name);
    addon.sendThisProcOk()
    addon.waitForAllChildren()
    process.exit(0);
  }
}

function loop(testEnv: TestEnv, fifo: Fifo): 'child' | 'main' {

  const reader = createSyncFifoReader<WorkerInput.Input>(fifo)

  while (true) {
    const payload = reader.read();
    switch (payload.type) {
      case 'stop': {
        return 'main';
      }
        case 'spinSnapshot': {

          const childPid = addon.fork(payload.snapFifo.id);
          debugger
        const isChild = childPid === 0;
        if (isChild) {
          spinSnapshot(testEnv, payload).catch(err => {
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

async function setRunTestFn() {
  console.log('before runtest create');

  const testEnv = await createTestEnv(snapshotInput);

  await runGc();

  return { testEnv };
}



setRunTestFn()
  .then(({testEnv}) => {
    console.log('setRunTestFn');

    console.log('before loop');
    addon.startProcControl(snapshotInput.procControlFifo.path)

    if (loop(testEnv, snapshotInput.workerFifo) === 'main') {
      console.log('worker loop stopped');
      addon.waitForAllChildren()
      process.exit(0);
    }
    // setInterval(() => {
    //   console.log('interval');
    // }, 1000)
  })
  .catch(err => {
    console.error('err in setRunTestFn', err);
    process.exit(1);
  });
