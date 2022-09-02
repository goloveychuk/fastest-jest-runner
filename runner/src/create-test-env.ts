import * as fs from 'graceful-fs';
import sourcemapSupport = require('source-map-support');
import {
  BufferedConsole,
  CustomConsole,
  LogMessage,
  LogType,
  NullConsole,
  getConsoleOutput,
} from '@jest/console';
import type {JestEnvironment} from '@jest/environment';

import type {Config} from '@jest/types';
// import * as docblock from 'jest-docblock';
// import LeakDetector from 'jest-leak-detector';
import {formatExecError} from 'jest-message-util';
import type Resolver from 'jest-resolve';
import RuntimeMod from 'jest-runtime';
import HasteMap, { IModuleMap } from 'jest-haste-map';
import type RuntimeClass from 'jest-runtime';
import {ErrorWithStack, interopRequireDefault} from 'jest-util';
import type {
  CreateSnapshotInput,
  JestConsole,
  TestFramework,
  TestFrameworkFactory,
} from './types';
import chalk = require('chalk');

import {createScriptTransformer, ScriptTransformer, Transformer} from '@jest/transform';


// const localRequire = <T>(name: string):T =>  {
//   const req = Module.createRequire('/home/badim/work/santa-editor-parent2/santa-editor')
//   const mod = req(name)
//   return mod as any
// }

// const {ScriptTransformer} = localRequire<typeof import('@jest/transform')>('@jest/transform')


// async function createScriptTransformer(
//   config: Config.ProjectConfig,
//   cacheFS: StringMap = new Map(),
// ): Promise<TransformerType> {
//   const transformer = new ScriptTransformer(config, cacheFS);

//   await transformer.loadTransformers();

//   return transformer;
// }

export interface TestEnv {
  resolver: Resolver;
  runtime: RuntimeClass;
  testFramework: TestFramework;
  globalConfig: Config.GlobalConfig;
  projectConfig: Config.ProjectConfig;
  environment: JestEnvironment
  testConsole: JestConsole;
  teardown: () => Promise<void>
  transformer: ScriptTransformer
}


function freezeConsole(testConsole: JestConsole, config: Config.ProjectConfig) {
  // @ts-expect-error: `_log` is `private` - we should figure out some proper API here
  testConsole._log = function fakeConsolePush(
    _type: LogType,
    message: LogMessage,
  ) {
    const error = new ErrorWithStack(
      `${chalk.red(
        `${chalk.bold(
          'Cannot log after tests are done.',
        )} Did you forget to wait for something async in your test?`,
      )}\nAttempted to log "${message}".`,
      fakeConsolePush,
    );

    const formattedError = formatExecError(
      error,
      config,
      {noStackTrace: false},
      undefined,
      true,
    );

    process.stderr.write(`\n${formattedError}\n`);
    process.exitCode = 1;
  };
}

export async function createTestEnv({
  context,
  serializableModuleMap,
  globalConfig,
  projectConfig,
}: CreateSnapshotInput): Promise<TestEnv> {
  const moduleMap = HasteMap.getStatic(projectConfig).getModuleMapFromJSON(
    serializableModuleMap,
  );
  

  const resolver = RuntimeMod.createResolver(projectConfig, moduleMap);

  //  const testSource = fs.readFileSync(path, 'utf8');
  //  const docblockPragmas = docblock.parse(docblock.extract(testSource));
  const docblockPragmas: Record<string, string | Array<string>> = {};
  //  const customEnvironment = docblockPragmas['jest-environment'];

  let testEnvironment = projectConfig.testEnvironment;

  //  if (customEnvironment) {
  //    if (Array.isArray(customEnvironment)) {
  //      throw new Error(
  //        `You can only define a single test environment through docblocks, got "${customEnvironment.join(
  //          ', ',
  //        )}"`,
  //      );
  //    }
  //    testEnvironment = resolveTestEnvironment({
  //      ...projectConfig,
  //      requireResolveFunction: require.resolve,
  //      testEnvironment: customEnvironment,
  //    });
  //  }

  const cacheFS = new Map<string, string>();
  // const cacheFS = {
  //   set: () => {},
  //   has: () => false,
  //   get: () => undefined,
  //   clear: () => {}
  // }
  const transformer = await createScriptTransformer(projectConfig, cacheFS);

  // require(testEnvironment)
  // console.log(await transformer.requireAndTranspileModule(testEnvironment))
  // return

  const TestEnvironment: typeof JestEnvironment =
    await transformer.requireAndTranspileModule(testEnvironment);

  // let testFrameworkFactory: TestFrameworkFactory =
  //   await transformer.requireAndTranspileModule(
  //     process.env.JEST_JASMINE === '1'
  //       ? require.resolve('jest-jasmine2')
  //       : projectConfig.testRunner,
  //   );

  const testFrameworkFactory = (interopRequireDefault(require('./jasmine2')) as typeof import('./jasmine2')).default

  const Runtime: typeof RuntimeClass = interopRequireDefault(
    projectConfig.runtime
      ? require(projectConfig.runtime)
      : require('jest-runtime'),
  ).default;

  const consoleOut = globalConfig.useStderr ? process.stderr : process.stdout;
  const consoleFormatter = (type: LogType, message: LogMessage) =>
    getConsoleOutput(
      // 4 = the console call is buried 4 stack frames deep
      BufferedConsole.write([], type, message, 4),
      projectConfig,
      globalConfig,
    );

  let testConsole: JestConsole;

  if (globalConfig.silent) {
    testConsole = new NullConsole(consoleOut, consoleOut, consoleFormatter);
  } else if (globalConfig.verbose) {
    testConsole = new CustomConsole(consoleOut, consoleOut, consoleFormatter);
  } else {
    testConsole = new BufferedConsole();
  }

  let extraTestEnvironmentOptions: Record<string, any> = {};

  //  const docblockEnvironmentOptions =
  //    docblockPragmas['jest-environment-options'];

  //  if (typeof docblockEnvironmentOptions === 'string') {
  //    extraTestEnvironmentOptions = JSON.parse(docblockEnvironmentOptions);
  //  }

  const environment = new TestEnvironment(
    {
      globalConfig,
      projectConfig: extraTestEnvironmentOptions
        ? {
            ...projectConfig,
            testEnvironmentOptions: {
              ...projectConfig.testEnvironmentOptions,
              ...extraTestEnvironmentOptions,
            },
          }
        : projectConfig,
    },
    {
      console: testConsole,
      docblockPragmas,
      get testPath(): string {
        throw new Error('testPath is not available yet');
      },
    },
  );

  if (typeof environment.getVmContext !== 'function') {
    console.error(
      `Test environment found at "${testEnvironment}" does not export a "getVmContext" method, which is mandatory from Jest 27. This method is a replacement for "runScript".`,
    );
    process.exit(1);
  }

  // const leakDetector = projectConfig.detectLeaks
  //   ? new LeakDetector(environment)
  //   : null;

  // setGlobal(environment.global, 'console', testConsole);

  const runtime = new Runtime(
    projectConfig,
    environment,
    resolver,
    transformer,
    cacheFS,
    {
      changedFiles: context.changedFiles,
      collectCoverage: globalConfig.collectCoverage,
      collectCoverageFrom: globalConfig.collectCoverageFrom,
      // collectCoverageOnlyFrom: globalConfig.collectCoverageOnlyFrom,
      coverageProvider: globalConfig.coverageProvider,
      sourcesRelatedToTestsInChangedFiles:
        context.sourcesRelatedToTestsInChangedFiles,
    },
    'unknownPath', //todo breaks _mainModule
  );

  // throw new Error('asd')
  // return

  // throw res
  // throw new Error('asd')

  for (const path of projectConfig.setupFiles) {
    const esm = runtime.unstable_shouldLoadAsEsm(path);

    if (esm) {
      await runtime.unstable_importModule(path);
    } else {
      const setupFile = runtime.requireModule(path);
      if (typeof setupFile === 'function') {
        await setupFile();
      }
    }
  }

  const sourcemapOptions: sourcemapSupport.Options = {
    environment: 'node',
    handleUncaughtExceptions: false,
    retrieveSourceMap: source => {
      const sourceMapSource = runtime.getSourceMaps()?.get(source);

      if (sourceMapSource) {
        try {
          return {
            map: JSON.parse(fs.readFileSync(sourceMapSource, 'utf8')),
            url: source,
          };
        } catch {}
      }
      return null;
    },
  };

  // For tests
  // runtime
  //   .requireInternalModule<typeof import('source-map-support')>(
  //     require.resolve('source-map-support'),
  //   )
    // .install(sourcemapOptions);

  // For runtime errors
  // sourcemapSupport.install(sourcemapOptions);

  if (
    false
  ) {
    const realExit = environment.global.process.exit;

    environment.global.process.exit = function exit(...args: Array<any>) {
      const error = new ErrorWithStack(
        `process.exit called with "${args.join(', ')}"`,
        exit,
      );

      const formattedError = formatExecError(
        error,
        projectConfig,
        {noStackTrace: false},
        undefined,
        true,
      );

      process.stderr.write(formattedError);

      return realExit(...args);
    };
  }

  // if we don't have `getVmContext` on the env skip coverage
  // const collectV8Coverage =
  //   globalConfig.coverageProvider === 'v8' &&
  //   typeof environment.getVmContext === 'function';

  await environment.setup();


  const teardown = async () => {
    runtime.teardown();
    await environment.teardown();

    sourcemapSupport.resetRetrieveHandlers();
  }

  // for (const path of projectConfig.setupFilesAfterEnv) { //is dublicated
  //   const esm = runtime.unstable_shouldLoadAsEsm(path);

  //   if (esm) {
  //     await runtime.unstable_importModule(path);
  //   } else {
  //     runtime.requireModule(path);
  //   }
  // }
  const testFramework = await testFrameworkFactory(globalConfig, projectConfig, environment, runtime);

  // let raw = moduleMap.getRawModuleMap()
  // raw.duplicates.clear()
  // raw.map.clear()
  // raw.mocks.clear()
  // cacheFS.clear()
  // global.gc()
  return {
    environment,
    projectConfig,
    resolver,
    runtime,
    testFramework,
    globalConfig,
    testConsole,
    teardown,
    transformer,
  };
}
