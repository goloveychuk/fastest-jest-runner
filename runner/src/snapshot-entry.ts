import * as fs from 'fs';
import {createTestEnv, TestEnv} from './create-test-env';
import {CreateSnapshotInput, makeErrorResp, RunTest, WorkerInput, WorkerResponse} from './types';
import {Module, builtinModules} from 'module';
import {createRunTest} from './run-test';
import {createSyncFifoReader} from './protocol';
import * as addon from './addon';
import type {SnapshotBuilderModule} from './snapshot';
import type { Fifo, FifoMaker } from './fifo-maker';
// console.log(process.argv[2]);
// fs.readFileSync(process.argv[2], 'utf8')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function patchRequire() {
  const origLoad = (Module as any)._load;

  const bulidins = new Set(builtinModules);
  const imported = new Set();

  const mock: Record<string, any> = {
    http: {
      request: () => {},
    },
    https: {
      request: () => {},
    },
    'node:worker_threads': {},
    worker_threads: {},
    child_process: {},
    zlib: {
      Inflate: class {},
    }, //after run segfault when require jsdom
    // assert: {},
    // crypto: {
    //   createHash: crypto.createHash
    // },
    // '@jridgewell/sourcemap-codec': {}
    // comment text decoder
    // /home/badim/github/jest/node_modules/@jridgewell/sourcemap-codec/dist/sourcemap-codec.umd.js

    // _recomposeAuthority in /home/badim/work/santa-editor-parent/node_modules/uri-js/dist/es5/uri.all.js
  };

  (Module as any)._load = function (
    request: string,
    parent: any,
    isMain: boolean,
  ) {
    if (mock[request]) {
      return mock[request];
    }
    // if (!request.startsWith('.') && !imported.has(request)) {
    //   const built = bulidins.has(request) ? '!!!!!!!!!' : '';
    //   console.log('!!' + built, request);
    //   imported.add(request);
    // }
    return origLoad(request, parent, isMain);
  };
}

// patchRequire();

// /home/badim/github/jest/node_modules/@jridgewell/sourcemap-codec/dist/sourcemap-codec.umd.js
// globalThis.TextDecoder = undefined;
// globalThis.TextEncoder = undefined;

const snapshotInput: CreateSnapshotInput = JSON.parse(
  fs.readFileSync(process.argv[2], 'utf8'),
);

// const {
//   // isBuildingSnapshot,
//   addSerializeCallback,
//   // addDeserializeCallback,
//   // setDeserializeMainFunction
// } = require('v8').startupSnapshot;

// const listener = ({
//   config,
//   serializableModuleMap,
// }: {
//   config: Config.ProjectConfig;
//   serializableModuleMap: SerializableModuleMap;
// }) => {
//   process.removeListener('message', listener);

// createRunTest(globalConfig, config, resolver, context).then(console.log, err => {
//     console.error('err here', err)
//     throw err
// })
declare module globalThis {
  let runTest: RunTest;
}

// globalThis.MessageChannel = class {
//   port1 = {
//     onmessage: () => {},
//     postMessage: () => {},
//   };
//   port2 = {
//     onmessage: () => {},
//     postMessage: () => {},
//   };
// };


const runGc = async () => {
  global.gc!();
  global.gc!();

  await sleep(300); //waiting for gc??
};


function handleChild(payload: WorkerInput.RunTest) {
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
    const myPid = addon.getpid();
    const resp: WorkerResponse.Response = {
      pid: myPid,
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

  globalThis
    .runTest(payload.testPath)
    .then(
      data => handle({type: 'result', data}),
      err => handle(makeErrorResp(err)),
    )
    .finally(() => {
      // process.exit(0);
      // setTimeout(() => {
      console.log('exiting');
      process.exit(0);
      // }, 2000);
    });
}
// function loop1() {
//   process.on('message', function handler(payload: Payload) {)
//     console.log('got msg11', payload[1]);
//     const {childPid, myPid} = addon.fork();
//     if (childPid < 0) {
//       throw new Error('fork failed ' + childPid);
//     }
//     // const res = 0 ;
//     const isChild = childPid === 0;
//     console.log({childPid, myPid});
//     // console.log('after fork', isChild)

//     if (isChild) {
//       // return

//       process.off('message', handler);
//       handleChild(myPid, payload);
//       // setTimeout(() => {
//       // }, 100)
//     } else {
//       // process.exit(0)
//       // console.log('is main')
//     }
//   });
// }

// const snapshotBuilderMod = require(snapshotInput.snapshotConfig
//   .snapshotBuilderPath) as SnapshotBuilderModule;



async function spinSnapshot(testEnv: TestEnv, payload: WorkerInput.SpinSnapshot) {
  const req = (mod: string) => {
    const resolved = testEnv.resolver.resolveModule(
      snapshotInput.snapshotConfig.snapshotBuilderPath,
      mod,
    );
    console.log('requiring', resolved);
    return testEnv.runtime.requireModule(resolved);
  };
  //todo move to worker
  //todo mb run snapshotBuilderPath in test context
  const snapshotBuilder = await testEnv.transformer.requireAndTranspileModule<SnapshotBuilderModule>(snapshotInput.snapshotConfig.snapshotBuilderPath);

  const build = snapshotBuilder.snapshots[payload.name];
  if (!build) {
    throw new Error('No snapshot with name: ' + payload.name);
  }
  await build({require: req, global: testEnv.environment.global});
  await runGc();

  if (loop(testEnv, payload.snapFifo) === 'main') {
    console.log('snapshot loop stopped: ' + payload.name);
    addon.sendThisProcOk()
    addon.waitForAllChildren()
    process.exit(0);
  }
}

function loop(testEnv: TestEnv, fifo: Fifo): 'child' | 'main' {
  // process.on('exit', () => {
  //   console.log('exit inside loop '+queuePath)
  // })
  const reader = createSyncFifoReader<WorkerInput.Input>(fifo)

  while (true) {
    const payload = reader.read();
    switch (payload.type) {
      case 'stop': {
        return 'main';
      }
      case 'spinSnapshot': {
        const childPid = addon.fork(payload.snapFifo.id);
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
          handleChild(payload);
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
  // for (const file of snapshotInput.allfiles) {
  //   testEnv.runtime.transformFile(file);
  // }
  // const detectNotClosed = createNotClosedDetector()
  // await warmup(snapshotInput.snapshotData, testEnv);

  // detectNotClosed()

  const runTest = createRunTest(testEnv);
  // addSerializeCallback(() => {
  globalThis.runTest = runTest; //todo rm
  return {runTest, testEnv};
  // console.log(Object.keys(require.cache).length)
  // console.log(testEnv.runtime._moduleRegistry?.size, testEnv.runtime._isolatedModuleRegistry?.size, testEnv.runtime._internalModuleRegistry?.size)
  // globalThis.runtime = testEnv.runtime;
  // globalThis.runTest2 = p => {
  //   // const res = testEnv.transformer.transform(p, {})

  //   console.log('before');
  //   const tr = testEnv.transformer._getTransformer(p)!;
  //   console.log('before 1');
  //   const content = fs.readFileSync(p, 'utf8');
  //   console.log('before 2');
  //   let res;
  //   try {
  //     res = testEnv.runtime.transformFile(p); //  res= tr.transformer.process!(content, p, {asdlog:true})
  //     console.log('before 3');
  //   } catch (e) {
  //     console.log('before -3', e);
  //   }
  //   return res;
  // };
  // process.send!('ready');
  console.log('after ready sent');

  await runGc();

  // global.gc();
  // global.gc();

  // }, 1000)
  // })
}
// const origSend = process.send
// process.on('message', function handler(data) {

//   console.log('got msg2', data)
//   console.log(process.send === origSend, process.send?.toString(), origSend)
//   process.send('respfromprocess')
// })

setRunTestFn()
  .then(({testEnv, runTest}) => {
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

// };

// process.on('message', listener);

// setTimeout(() => {
//   console.log('started')

// } , 18000);
