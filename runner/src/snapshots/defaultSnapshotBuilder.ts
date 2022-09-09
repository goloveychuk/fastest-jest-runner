import {SnapshotBuilder} from './public'


const builder: SnapshotBuilder<'base'> =  {
    snapshots: {
        base: async (builder) => {

        }
    },
    getSnapshot: async () => {
        return 'base'
    }
}

export default builder