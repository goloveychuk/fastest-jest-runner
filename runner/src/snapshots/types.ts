import { Global } from '@jest/types';

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
export type BuildSnapshotFn = (builder: SnapshotBuilderContext) => Promise<void> | void;

export type SnapshotBuilder<T extends string> = {
  snapshots: Record<T, BuildSnapshotFn>;

  getSnapshot(conf: GetSnapshotConfig): Promise<T>;
};

export type SnapshotBuilderModule = SnapshotBuilder<string>;

export interface SnapshotConfig {
  //   imports: Array<{from: string; allImports: string[]}>;
  snapshotBuilderPath: string;
}
