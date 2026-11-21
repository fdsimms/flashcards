import { describe, expect, it } from 'vitest';
import { changeCounter } from '../../src/core/collectionChanged';

describe('the count of collection changes', () => {
  it('goes up by one a change and tells whoever is listening', () => {
    const c = changeCounter();
    let told = 0;
    const stop = c.subscribe(() => { told++; });
    expect(c.get()).toBe(0);
    c.bump();
    c.bump();
    expect(c.get()).toBe(2);
    expect(told).toBe(2);
    stop();
    c.bump();
    expect(told).toBe(2);
    expect(c.get()).toBe(3);
  });
});
