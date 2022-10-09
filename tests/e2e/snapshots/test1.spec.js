

it('lodash works', () => {
    expect(require.cache[require.resolve('./mod')]?.exports).toBe(42);
})