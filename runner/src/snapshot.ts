import { Global } from '@jest/types';
import { TestEnv } from './create-test-env';

export interface SnapshotBuilderContext {
  import<T>(name: string): Promise<T>;
  global: Global.Global;
  // snapshot(name: string): void
  // fork(fn1: () => void, fn2: () => void): void
}

export type GetSnapshotConfig = {
  docblockPragmas: Record<string, string | string[]>;
  testPath: string
}
export type BuildSnapshotFn = (builder: SnapshotBuilderContext) => Promise<void>;

export type SnapshotBuilder<T extends string> = {
  snapshots: Record<T, BuildSnapshotFn>;

  getSnapshot(conf: GetSnapshotConfig): Promise<T>;
};

export type SnapshotBuilderModule = SnapshotBuilder<string>;

export interface SnapshotConfig {
  //   imports: Array<{from: string; allImports: string[]}>;
  snapshotBuilderPath: string;
}

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
    console.log('requiring', resolved);
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
