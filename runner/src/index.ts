import {fork} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import Emittery = require('emittery');
import pLimit = require('p-limit');
import type {
  Test,
  TestEvents,
  TestResult,
} from '@jest/test-result';
import type {TestWatcher} from 'jest-watcher';

import {
  CreateSnapshotInput,
  EmittingTestRunner,
  TestRunnerOptions,
  UnsubscribeFn,
  WorkerInput,
  WorkerResponse,
  makeErrorResp,
  SnapshotConfig,
} from './types';

import {FifoMaker} from './fifo-maker';
import {OnProcExit, ProcControl} from './proc-control';
import {createAsyncFifoWriter} from './protocol';
import type {SnapshotBuilderModule} from './snapshot';



function withCache<TArg extends string | number, TRes>(
  fn: (arg: TArg) => TRes,
) {
  const cache = new Map<TArg, TRes>();

  return (arg: TArg) => {
    if (!cache.has(arg)) {
      cache.set(arg, fn(arg));
    }
    return cache.get(arg)!;
  };
}


class TestRunner extends EmittingTestRunner {
  readonly #eventEmitter = new Emittery<TestEvents>();

  async runTests(
    _tests: Array<Test>,
    watcher: TestWatcher,
    options: TestRunnerOptions,
  ): Promise<void> {
    // const tests = new Array(100).fill(0).map((_, i) => {
    //   return _tests[0];
    // });
    const tests = _tests;

    // const tests = _tests.filter(f => {
    //   for (const n of failed) {
    //     if (f.path.endsWith(n)) {
    //       return true;
    //     }
    //   }
    //   return false;
    // });

    return this.runSnapshotsTests(tests, watcher, options);
  }

  

  async runSnapshotsTests(
    tests: Array<Test>,
    watcher: TestWatcher,
    options: TestRunnerOptions,
  ) {
    const snapEntry = require.resolve('./snapshot-entry');
    // const rootDir = '/tmp/jj'
    // const rootDir = '/dev/shm/jj'
    // const rootDir = '/mnt/tmp/jj';
    const rootDir = '/tmp/jj';
    const confP = path.join(rootDir, 'config.json');
    fs.mkdirSync(rootDir, {recursive: true});
    // const snapPath = path.join(rootDir, 'snapshot.blob');

    const fifoMaker = new FifoMaker(rootDir);
    const workerFifo = fifoMaker.makeFifo('worker');

    const testsLeft = new Set<string>();
    const onProcExit: OnProcExit = data => {
      const fifo = fifoMaker.getFifoById(data.id);
      const resp: WorkerResponse.Response = {
        pid: data.pid,
        testResult: makeErrorResp(
          `Proc exited without response, status=${data.status}`,
        ),
      };
      fs.writeFileSync(fifo.path, JSON.stringify(resp));
    };

    const procControlFifo = fifoMaker.makeFifo('proc_contrk');

    const procControl = new ProcControl(procControlFifo, onProcExit);

    const procLoop = procControl.loop();

    const config = tests[0].context.config;
    const serializableModuleMap = tests[0].context.moduleMap.toJSON();

    const snapshotConfig: SnapshotConfig = {
      snapshotBuilderPath: require.resolve('./snapshot'),
    };

    const snapshotBuilder =
      require(snapshotConfig.snapshotBuilderPath) as SnapshotBuilderModule;

    const nodePath = '/home/badim/github/node/out/Release/node';
    // const snapshotConfig = await collectDeps(tests, config);

    const createSnapshotInput: CreateSnapshotInput = {
      workerFifo,
      procControlFifo,
      allfiles: tests.map(t => t.path),
      snapshotConfig,
      context: this._context,
      projectConfig: config,
      serializableModuleMap,
      globalConfig: this._globalConfig,
    };

    fs.writeFileSync(confP, JSON.stringify(createSnapshotInput));
    const was = Date.now();

    const child = fork(
      // 'node',
      snapEntry,
      [
        // '--no-concurrent-recompilation',
        // '--v8-pool-size=0',

        // --turbo-filter=~ --no-concurrent-marking  --no-concurrent-sweeping

        // '--max-semi-space-size=1024',
        // '--noconcurrent_sweeping',
        // `--build-snapshot`, `--snapshot-blob`, `${snapPath}`,
        confP,
      ],
      {
        execArgv: [
          '--max-old-space-size=8096',
          '--expose-gc',
          '--v8-pool-size=0',
          '--single-threaded',
          // '--unhandled-rejections=warn'
        ],
        stdio: 'pipe',
      },
    );
    child.on('exit', res => {
      console.log('exit from root process!!!!!', res);
      // if (testsLeft) {
      console.log('Tests left:', Array.from(testsLeft).join('\n'));
      // }
    });
    // child.stdin.

    child.stdout!.on('data', data => {
      console.log('stdout', data.toString('utf-8'));
    });
    child.stderr!.on('data', data => {
      console.log('stderr', data.toString('utf-8'));
    });

    // child.stdin.write()
    // child.on('message', msg => {
    //   console.log('got msg' + msg)
    // })

    // let cur = 0;
    // const inter = setInterval(() => {
    //   if (!tests[cur]) {
    //     clearInterval(inter);
    //     return;
    //   }
    //   child.stdin!.cork();
    //   for (const d of serialize({testPath: tests[cur]})) {
    //     child.stdin!.write(d);
    //   }
    //   child.stdin!.uncork();
    //   cur += 1;
    // }, 5000);
    // });

    // child.on('message', function handler(msg) {
    //   console.log('got msg in main' + msg)
    // })
    // return;
    // console.log(res.stdout);
    // if (res.status !== 0) {
    //   console.log(res.stderr);
    //   throw new Error('err in res ' + res.stdout + res.stderr);
    // }
    // throw console.error
    // console.log(
    //   'snapshot built ' +
    //     Math.round(fs.statSync(snapPath).size / 1024 / 1024) +
    //     'mb, took ' +
    //     Math.round((Date.now() - was) / 1000) +
    //     's',
    // );
    // throw res.stdout
    // for (const t of tests) {

    // const res2 = fork(runtimeEntry, [], {
    //   execArgv: [`--snapshot-blob`, `${snapPath}`], //process.argv are not overriden
    //   stdio: 'inherit'
    // });
    // res2.send(testfile)
    // res2.on('message', console.log)
    // console.log([`--snapshot-blob`, `${snapPath}`, runtimeEntry, testfile])
    // console.log(nodePath, `--snapshot-blob`, `${snapPath}`, runtimeEntry)
    // options.serial ? 1 :
    const concurrency = this._globalConfig.maxWorkers;
    // let concurrency = 25;
    console.log({concurrency});

    const workerWriter = await createAsyncFifoWriter<WorkerInput.Input>(
      workerFifo,
    );

    const testsById = new Map<number, Test>();
    const cleanups: Array<() => Promise<void>> = [];

    const initSnapshot = async (name: string) => {
      const snapFifo = fifoMaker.makeFifo('snapshot');

      const writer = await createAsyncFifoWriter<WorkerInput.Input>(snapFifo);
      console.log(`spinning!!!!!!!!!!!!!!!!! ${name}`);
      await workerWriter.write({
        type: 'spinSnapshot',
        name,
        snapFifo,
      });
      cleanups.push(async () => {
        await writer.write({type: 'stop'});
      });
      return {writer};
    };

    const initOrGetSnapshot = withCache(initSnapshot);

    const runTest = async (test: Test): Promise<TestResult> => {
      testsLeft.add(test.path);
      // return new Promise<TestResult>((resolve, reject) => {
      const snapshotName = await snapshotBuilder.default.getSnapshot({
        testPath: test.path,
      });

      const snapshotObj = await initOrGetSnapshot(snapshotName);

      const resultFifo = fifoMaker.makeFifo('result');
      testsById.set(resultFifo.id, test);

      console.log(`sent msg ${test.path}`);

      await snapshotObj.writer.write({
        type: 'test',
        testPath: test.path,
        resultFifo,
      });

      // child.stdin!.uncork()
      // child.send([id, test.path]);

      const resp = JSON.parse(
        await fs.promises.readFile(resultFifo.path, 'utf8'),
      ) as WorkerResponse.Response;
      await fs.promises.unlink(resultFifo.path);
      testsLeft.delete(test.path);
      // process.kill(resp.pid, 'SIGKILL'); // killing zombies, better to wait for SIGCHLD
      //
      if (resp.testResult.type === 'error') {
        throw resp.testResult.data;
      }
      return resp.testResult.data;
      // if (oneResolved) {
      //   setTimeout(() => {
      //     reject(new Error('timeout'));
      //   }, 60000);
      // }
      // });
    };
    // setInterval(() => {
    //   console.log('tick');
    // }, 1000);
    const mutex = pLimit(concurrency);
    const runTestLimited = (test: Test) =>
      mutex(async () => {
        if (watcher.isInterrupted()) {
          throw new CancelRun();
        }
        await this.#eventEmitter.emit('test-file-start', [test]);

        return runTest(test)
          .then(
            result =>
              this.#eventEmitter.emit('test-file-success', [test, result]),
            error =>
              this.#eventEmitter.emit('test-file-failure', [test, error]),
          )
          .catch(() => {
            //muting error?????
            return true;
          });
      });

    const cleanup = async () => {
      await Promise.all(cleanups.map(cl => cl()));
      await workerWriter.write({type: 'stop'});
      await fs.promises.rm(rootDir, {recursive: true});
      console.log('before proc loop');
      const timer = setTimeout(() => {
        //better wait for worker exit
        const processes = procControl.getLeftProcesses(); //case for ayout/switchLayoutUtil.unit.ts // deadlock, workers
        // console.warn('got not finished processes:\n', JSON.stringify(processes.map(([pid, data]) => {
        //   return {pid, ...data, filename: testsById.get(data.id)?.path}
        // })))
        for (const [pid, data] of processes) {
          if (!testsById.has(data.id)) {
            continue; //not a test process
          }
          const fileName = testsById.has(data.id);

          if (data.receivedOk) {
            console.error('Stale process', pid, fileName);
            process.kill(pid, 'SIGKILL');
          } else {
            throw new Error(
              `should not happen, im in cleanup after all results, ${pid}, ${fileName}`,
            );
          }
        }
      }, 3000);
      await procLoop;
      clearTimeout(timer);
      console.log('after proc loop await');
      // if (testsLeft.size) {
      console.log('Tests left:', Array.from(testsLeft).join('\n'));
      // }
      // child.kill('SIGTERM');
    };

    return Promise.all(tests.map(test => runTestLimited(test))).then(
      cleanup,
      cleanup,
    );

  }
  
  on<Name extends keyof TestEvents>(
    eventName: Name,
    listener: (eventData: TestEvents[Name]) => void | Promise<void>,
  ): UnsubscribeFn {
    return this.#eventEmitter.on(eventName, listener);
  }
}

class CancelRun extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'CancelRun';
  }
}

export default TestRunner;



export type {SnapshotBuilder} from './snapshot' 