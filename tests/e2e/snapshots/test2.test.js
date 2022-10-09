/**
 * @mocks true
 */

it('pragma works', () => {
    expect(global.isMocks).toBe(true);
})