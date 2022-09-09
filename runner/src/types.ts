/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {ConsoleBuffer} from '@jest/console';
import type {JestEnvironment} from '@jest/environment';
import * as path from 'path'
import type {
  SerializableError,
  Test,
  TestEvents,
  TestFileEvent,
  TestResult,
} from '@jest/test-result';
import type {Config} from '@jest/types';
import type {SerializableModuleMap} from 'jest-haste-map';
import type RuntimeType from 'jest-runtime';
import type {TestWatcher} from 'jest-watcher';

import type {Fifo} from './fifo-maker';
import { SnapshotConfig } from './snapshots/types';


export type ErrorWithCode = Error & {code?: string};

export type OnTestStart = (test: Test) => Promise<void>;

export type OnTestFailure = (
  test: Test,
  serializableError: SerializableError,
) => Promise<void>;

export type OnTestSuccess = (
  test: Test,
  testResult: TestResult,
) => Promise<void>;

export type TestFramework = (testPath: string) => Promise<TestResult>

export type TestFrameworkFactory = (
  globalConfig: Config.GlobalConfig,
  config: Config.ProjectConfig,
  environment: JestEnvironment,
  runtime: RuntimeType,
  // testPath?: string,
  // sendMessageToJest?: TestFileEvent,
) => Promise<TestFramework>;

export type TestRunnerOptions = {
  serial: boolean;
};

export type TestRunnerContext = {
  changedFiles?: Set<string>;
  sourcesRelatedToTestsInChangedFiles?: Set<string>;
};

type SerializeSet<T> = T extends Set<infer U> ? Array<U> : T;

export type TestRunnerSerializedContext = {
  [K in keyof TestRunnerContext]: SerializeSet<TestRunnerContext[K]>;
};

export type UnsubscribeFn = () => void;

export interface CallbackTestRunnerInterface {
  readonly isSerial?: boolean;
  readonly supportsEventEmitters?: boolean;

  runTests(
    tests: Array<Test>,
    watcher: TestWatcher,
    onStart: OnTestStart,
    onResult: OnTestSuccess,
    onFailure: OnTestFailure,
    options: TestRunnerOptions,
  ): Promise<void>;
}

export interface EmittingTestRunnerInterface {
  readonly isSerial?: boolean;
  readonly supportsEventEmitters: true;

  runTests(
    tests: Array<Test>,
    watcher: TestWatcher,
    options: TestRunnerOptions,
  ): Promise<void>;

  on<Name extends keyof TestEvents>(
    eventName: Name,
    listener: (eventData: TestEvents[Name]) => void | Promise<void>,
  ): UnsubscribeFn;
}

abstract class BaseTestRunner {
  readonly isSerial?: boolean;
  abstract readonly supportsEventEmitters: boolean;

  constructor(
    protected readonly _globalConfig: Config.GlobalConfig,
    protected readonly _context: TestRunnerContext,
  ) {}
}

export abstract class CallbackTestRunner
  extends BaseTestRunner
  implements CallbackTestRunnerInterface
{
  readonly supportsEventEmitters = false;

  abstract runTests(
    tests: Array<Test>,
    watcher: TestWatcher,
    onStart: OnTestStart,
    onResult: OnTestSuccess,
    onFailure: OnTestFailure,
    options: TestRunnerOptions,
  ): Promise<void>;
}


export interface NormalizedFastestJestRunnerConfig  {
  snapshotBuilderPath: string
  maxOldSpace: number | undefined
}

type InputFastestJestRunnerConfig = undefined | Partial<NormalizedFastestJestRunnerConfig>

export function normalizeRunnerConfig(conf: InputFastestJestRunnerConfig): NormalizedFastestJestRunnerConfig {
  const maxOldSpace = conf?.maxOldSpace

  const snapshotBuilderPath = conf?.snapshotBuilderPath ?? require.resolve('./snapshots/defaultSnapshotBuilder')
  return {maxOldSpace, snapshotBuilderPath}
}
 
export abstract class EmittingTestRunner
  extends BaseTestRunner
  implements EmittingTestRunnerInterface
{
  readonly supportsEventEmitters = true;

  abstract runTests(
    tests: Array<Test>,
    watcher: TestWatcher,
    options: TestRunnerOptions,
  ): Promise<void>;

  abstract on<Name extends keyof TestEvents>(
    eventName: Name,
    listener: (eventData: TestEvents[Name]) => void | Promise<void>,
  ): UnsubscribeFn;
}

export type JestTestRunner = CallbackTestRunner | EmittingTestRunner;



export interface WorkerConfig {
  projectConfig: Config.ProjectConfig;
  globalConfig: Config.GlobalConfig;
  context: TestRunnerContext;
  snapshotConfig: SnapshotConfig;

  workerFifo: Fifo;
  procControlFifo: Fifo;
  serializableModuleMap: SerializableModuleMap;
}


export type JestConsole = Console & {
  getBuffer: () => ConsoleBuffer | undefined;
};

export type RunTest = (path: string) => Promise<TestResult>;

export declare namespace WorkerInput {
  export type RunTest = {
    type: 'test';
    testPath: string;
    resultFifo: Fifo;
  };

  export type Stop = {
    type: 'stop';
  };

  export type SpinSnapshot = {
    type: 'spinSnapshot';
    name: string;
    snapFifo: Fifo;
  };

  export type Input = RunTest | Stop | SpinSnapshot;
}

export type RetryData = {
  left: number
}


export declare namespace WorkerResponse {
  export type TestResultResp = {
    type: 'result';
    data: TestResult;
  };
  export type ErrorResp = {
    type: 'error';
    data: SerializableError;
    retryData?: RetryData
  };

  export type Response = {
    pid: number;
    testResult: TestResultResp | ErrorResp;
  };
}

export const makeErrorResp = (
  msg: string | Error,
  retryData?: RetryData
): WorkerResponse.ErrorResp => {
  const error = typeof msg === 'string' ? new Error(msg) : msg;

  const data = {
    code: (error as any).code || undefined,
    message: error.message,
    stack: error.stack,
    type: 'Error',
  };
  return {type: 'error', data};
};


