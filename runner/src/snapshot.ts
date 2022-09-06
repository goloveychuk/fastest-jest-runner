import {Global} from '@jest/types'

interface Builder {
  import<T>(name: string): Promise<T>;
  global: Global.Global;
  // snapshot(name: string): void
  // fork(fn1: () => void, fn2: () => void): void
}

type MkSnapshotFn = (builder: Builder) => Promise<void>;

export type SnapshotBuilder<T extends string> = {
  snapshots: Record<T, MkSnapshotFn>;

  getSnapshot(conf: {testPath: string}): Promise<T>;
};


export type SnapshotBuilderModule =  SnapshotBuilder<string>
