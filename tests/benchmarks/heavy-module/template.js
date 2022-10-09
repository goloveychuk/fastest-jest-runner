const mod = require('../mod')

it('is fast', () => {
    expect(mod.length).toBe(20000)
});