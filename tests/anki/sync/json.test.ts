import { describe, expect, it } from 'vitest';
import { parseJson, stringifyJson } from '../../../src/anki/sync/json';

describe('sync JSON', () => {
  it('keeps a 64-bit id exact, and writes it back digit for digit', () => {
    const text = '{"id":18096852940429213357,"neg":-4702613774933266801,"small":1794408857890,"f":0.85,"e":1e3,"s":"a\\"b\\u00e9","l":[true,false,null,[]],"o":{}}';
    const v = parseJson(text) as Record<string, unknown>;
    expect(v.id).toBe(18096852940429213357n);
    expect(v.neg).toBe(-4702613774933266801n);
    expect(v.small).toBe(1794408857890);
    expect(v).toMatchObject({ f: 0.85, e: 1000, s: 'a"bé', l: [true, false, null, []], o: {} });
    expect(stringifyJson(v)).toBe('{"id":18096852940429213357,"neg":-4702613774933266801,"small":1794408857890,"f":0.85,"e":1000,"s":"a\\"bé","l":[true,false,null,[]],"o":{}}');
  });

  it('reads what JSON.parse reads, and refuses what it refuses', () => {
    for (const t of ['[]', ' {"a" : [1, 2.5, -3e-2] } ', '"x"', '0', 'null']) expect(parseJson(t)).toEqual(JSON.parse(t));
    for (const t of ['{', '[1,]', '{"a":1} x', 'tru']) expect(() => parseJson(t)).toThrow();
  });
});
