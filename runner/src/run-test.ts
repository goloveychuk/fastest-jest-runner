/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */


import type { TestResult } from "@jest/test-result";
import type { TestEnv } from "./create-test-env";
import type { RunTest } from "./types";



// Keeping the core of "runTest" as a separate function (as "runTestInternal")
// is key to be able to detect memory leaks. Since all variables are local to
// the function, when "runTestInternal" finishes its execution, they can all be
// freed, UNLESS something else is leaking them (and that's why we can detect
// the leak!).
//
// If we had all the code in a single function, we should manually nullify all
// references to verify if there is a leak, which is not maintainable and error
// prone. That's why "runTestInternal" CANNOT be inlined inside "runTest".




export function createRunTest({testFramework, runtime, globalConfig, projectConfig, environment, testConsole, teardown}: TestEnv): RunTest {
  const sendMessageToJest = undefined

  return async (path: string) => {
    const start = Date.now();
    // console.log('started executing test', path);

    try {
      let result: TestResult;

      try {
        // if (collectV8Coverage) {
        //   await runtime.collectV8Coverage();
        // }
        result = await testFramework(
          // globalConfig,
          // projectConfig,
          // environment,
          // runtime,
          path,
          // sendMessageToJest,
        );
      } catch (err: any) {
        // Access stack before uninstalling sourcemaps
        err.stack;

        throw err;
      } finally {
        // if (collectV8Coverage) {
        //   await runtime.stopCollectingV8Coverage();
        // }
        console.log('finished executing test', path);
      }

      // freezeConsole(testConsole, projectConfig);

      const testCount =
        result.numPassingTests +
        result.numFailingTests +
        result.numPendingTests +
        result.numTodoTests;

      const end = Date.now();
      const testRuntime = end - start;
      result.perfStats = {
        end,
        runtime: testRuntime,
        slow: testRuntime / 1000 > projectConfig.slowTestThreshold,
        start,
      };
      result.testFilePath = path;
      result.console = testConsole.getBuffer();
      result.skipped = testCount === result.numPendingTests;
      result.displayName = projectConfig.displayName;

      const coverage = runtime.getAllCoverageInfoCopy();
      if (coverage) {
        const coverageKeys = Object.keys(coverage);
        if (coverageKeys.length) {
          result.coverage = coverage;
        }
      }

      // if (collectV8Coverage) {
      //   const v8Coverage = runtime.getAllV8CoverageInfoCopy();
      //   if (v8Coverage && v8Coverage.length > 0) {
      //     result.v8Coverage = v8Coverage;
      //   }
      // }

      if (globalConfig.logHeapUsage) {
        globalThis.gc?.();

        result.memoryUsage = process.memoryUsage().heapUsed;
      }
      // Delay the resolution to allow log messages to be output.

      // todo unhandled rejections
      // getSettingsMenuItems.unit 
      // return result

      return new Promise<TestResult>(resolve => {
        setImmediate(() => resolve(result));
      });
    } finally {
      await teardown()
    }
  };
}