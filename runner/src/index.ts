import { fork } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import Emittery = require('emittery');
import pLimit = require('p-limit');
import * as os from 'os';
import type {
  SerializableError,
  Test,
  TestEvents,
  TestResult,
} from '@jest/test-result';
import type { TestWatcher } from 'jest-watcher';
import inspector from 'inspector';

import {
  WorkerConfig,
  EmittingTestRunner,
  TestRunnerOptions,
  UnsubscribeFn,
  WorkerInput,
  WorkerResponse,
  makeErrorResp,
  FastestJestRunnerConfig,
} from './types';

import { FifoMaker } from './fifo-maker';
import { OnProcExit, ProcControl } from './proc-control';
import { createAsyncFifoWriter } from './protocol';
import type { SnapshotBuilderModule, SnapshotConfig } from './snapshot';
import { replaceRootDirInPath } from 'jest-config';
import { createScriptTransformer } from '@jest/transform';
import { Config } from '@jest/types';

function setCleanupBeforeExit(clean: () => void) {
  let called = false;
  function exitHandler(
    options: { exit?: boolean; cleanup?: boolean },
    exitCode: number,
  ) {
    if (!called) {
      called = true;
      clean();
    }
    // if (options.cleanup) console.log('clean');
    // if (exitCode || exitCode === 0) console.log(exitCode);
    if (options.exit) {
      process.exit(exitCode);
    }
  }

  //do something when app is closing
  process.on('exit', exitHandler.bind(null, { cleanup: true }));

  //catches ctrl+c event
  process.on('SIGINT', exitHandler.bind(null, { exit: true }));

  // catches "kill pid" (for example: nodemon restart)
  process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
  process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));

  //catches uncaught exceptions
  process.on('uncaughtException', exitHandler.bind(null, { exit: true }));
}

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

    if (inspector.url()) {
      return this.runDebug(tests, watcher);
    }

    return this.runSnapshotsTests(tests, watcher, options);
  }

  async runDebug(tests: Array<Test>, watcher: TestWatcher) {
    if (tests.length !== 1) {
      throw new Error('Debug is supported for 1 test only');
    }
    if (watcher.isWatchMode()) {
      throw new Error('Debug is not supported in watch mode');
    }

    const { createTestEnv } = await import('./create-test-env');
    const { buildSnapshot } = await import('./snapshot');

    const test = tests[0];
    const { snapshotBuilder, snapshotConfig } = await this.getCommons(
      test.context.config,
    );

    const resolver = test.context.resolver;
    const testEnv = await createTestEnv({
      context: this._context,
      projectConfig: test.context.config,
      globalConfig: this._globalConfig,
      resolver,
    });
    const snapshotName = await snapshotBuilder.getSnapshot({
      testPath: test.path,
    });

    await this.#eventEmitter.emit('test-file-start', [test]);

    await buildSnapshot(snapshotConfig, testEnv, snapshotName);

    try {
      const result = await testEnv //todo need unhandled rejection from worker
        .runTest(test.path);
      await this.#eventEmitter.emit('test-file-success', [test, result]);
    } catch (err) {
      await this.#eventEmitter.emit('test-file-failure', [
        test,
        err as SerializableError,
      ]);
    }
  }

  async getCommons(projectConfig: Config.ProjectConfig) {
    const fastestRunnerConfig = projectConfig.globals[
      'fastest-jest-runner'
    ] as FastestJestRunnerConfig;

    const snapshotPath = replaceRootDirInPath(
      projectConfig.rootDir,
      fastestRunnerConfig.snapshotBuilderPath,
    );

    const snapshotConfig: SnapshotConfig = {
      snapshotBuilderPath: snapshotPath,
    };

    const cacheFS = new Map<string, string>();
    const transformer = await createScriptTransformer(projectConfig, cacheFS);

    const snapshotBuilder =
      await transformer.requireAndTranspileModule<SnapshotBuilderModule>(
        snapshotConfig.snapshotBuilderPath,
      );

    return {
      snapshotBuilder,
      fastestRunnerConfig,
      snapshotConfig,
    };
  }

  async runSnapshotsTests(
    tests: Array<Test>,
    watcher: TestWatcher,
    options: TestRunnerOptions,
  ) {
    const snapEntry = require.resolve('./snapshot-entry');
    
    const rootDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'fastest-jest-runner-'),
    );
    //todo setCleanupBeforeExit


    const fifoMaker = new FifoMaker(rootDir);
    const workerFifo = fifoMaker.makeFifo('worker');

    const testsLeft = new Set<string>();
    const onProcExit: OnProcExit = (data) => {
      const fifo = fifoMaker.getFifoById(data.id);
      const resp: WorkerResponse.Response = {
        pid: data.pid,
        testResult: makeErrorResp(
          `Proc exited without response, status=${data.status}`,
        ),
      };
      fs.writeFileSync(fifo.path, JSON.stringify(resp));
    };

    const procControlFifo = fifoMaker.makeFifo('proc_contrl');

    const procControl = new ProcControl(procControlFifo, onProcExit);

    const procLoop = procControl.loop();

    const serializableModuleMap = tests[0].context.moduleMap.toJSON();

    const projectConfig = tests[0].context.config;

    const { fastestRunnerConfig, snapshotConfig, snapshotBuilder } =
      await this.getCommons(projectConfig);

    // const nodePath = '/home/badim/github/node/out/Release/node';
    // const snapshotConfig = await collectDeps(tests, config);

    const workerConfig: WorkerConfig = {
      context: this._context,
      projectConfig,
      globalConfig: this._globalConfig,
      snapshotConfig,
      workerFifo,
      procControlFifo,
      serializableModuleMap,
    };

    const was = Date.now();
    // debugger
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
      ],
      {
        execArgv: [
          `--max-old-space-size=${fastestRunnerConfig.maxOldSpace}`,
          '--experimental-vm-modules',
          '--expose-gc',
          '--v8-pool-size=0',
          '--single-threaded',
          // '--unhandled-rejections=warn'
        ],
        stdio: 'pipe',
      },
    );
    child.on('exit', (res) => {
      console.log('exit from root process!!!!!', res); //todo handle this, finish testrun
      // if (testsLeft) {
      console.log('Tests left:', Array.from(testsLeft).join('\n'));
      // }
    });

    child.stdout!.on('data', (data) => {
      console.log('stdout', data.toString('utf-8'));
    });
    child.stderr!.on('data', (data) => {
      console.log('stderr', data.toString('utf-8'));
    });

    child.send(workerConfig);

    const concurrency = options.serial ? 1 : this._globalConfig.maxWorkers;
    // let concurrency = 25;
    console.log({ concurrency });

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
        await writer.write({ type: 'stop' });
      });
      return { writer };
    };

    const initOrGetSnapshot = withCache(initSnapshot);

    const runTest = async (test: Test): Promise<TestResult> => {
      testsLeft.add(test.path);
      // return new Promise<TestResult>((resolve, reject) => {
      const snapshotName = await snapshotBuilder.getSnapshot({
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
            (result) =>
              this.#eventEmitter.emit('test-file-success', [test, result]),
            (error) =>
              this.#eventEmitter.emit('test-file-failure', [test, error]),
          )
          .catch(() => {
            //muting error?????
            return true;
          });
      });

    const cleanup = async () => {
      await Promise.all(cleanups.map((cl) => cl()));
      await workerWriter.write({ type: 'stop' });
      await fs.promises.rm(rootDir, { recursive: true });
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

    return Promise.all(tests.map((test) => runTestLimited(test))).then(
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

export type { SnapshotBuilder } from './snapshot';