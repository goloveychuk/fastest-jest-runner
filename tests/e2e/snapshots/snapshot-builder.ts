import type { SnapshotBuilder, BuildSnapshotFn } from 'fastest-jest-runner';

type SnapshotsNames =
  | 'units'
  | 'specs'
  | 'mocks'
  

const snapshotBuilder: SnapshotBuilder<SnapshotsNames> = {
  snapshots: {
    units: async (builder) => {
        builder.global.lodash = await builder.import('lodash');
    },
    specs: async (builder) => {
        await builder.import('./mod'); //setting module cache
    },
    mocks: async (builder) => {
        builder.global.isMocks = true
    },
  },
  getSnapshot: async ({ testPath, docblockPragmas }) => {
    const mocks = docblockPragmas.mocks === 'true';
    if (mocks) {
        return 'mocks'
    }
    if (testPath.includes('.spec.')) {
      return 'specs'
    }
    return 'units'
  },
};

export default snapshotBuilder;
