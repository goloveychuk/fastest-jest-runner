
module.exports = {
  snapshots: {
    def: async (builder)=> {
      await builder.import('./mod')
    }
  },
  getSnapshot: async () => {
    return 'def'
  },
};
