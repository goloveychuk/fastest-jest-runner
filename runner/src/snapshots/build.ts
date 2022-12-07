import type { TestEnv } from '../create-test-env';
import { debugLog } from '../log';
import type { SnapshotBuilderModule, SnapshotConfig } from './types';

export async function buildSnapshot(
    snapshotConfig: SnapshotConfig,
    testEnv: TestEnv,
    snapshotName: string,
  ) {
    const { runtime } = testEnv;
    const imp = async <T>(_mod: string): Promise<T> => {
      const resolved = testEnv.resolver.resolveModule(
        snapshotConfig.snapshotBuilderPath,
        _mod,
      );
      debugLog('requiring', resolved);
      const esm = runtime.unstable_shouldLoadAsEsm(resolved);
  
      if (esm) {
        const esmmod: any = await runtime.unstable_importModule(resolved);
        return esmmod.exports;
      } else {
        return runtime.requireModule(resolved);
      }
    };
    //todo move to worker
    //todo mb run snapshotBuilderPath in test context
    const snapshotBuilder =
      await testEnv.transformer.requireAndTranspileModule<SnapshotBuilderModule>(
        snapshotConfig.snapshotBuilderPath,
      );
  
    const build = snapshotBuilder.snapshots[snapshotName];
    if (!build) {
      throw new Error('No snapshot with name: ' + snapshotName);
    }
    await build({ import: imp, global: testEnv.environment.global });
  }
  