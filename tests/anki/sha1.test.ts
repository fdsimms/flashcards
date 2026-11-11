import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sha1, sha1 } from '../../src/anki/sha1';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const nodeSha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');

describe('sha1', () => {
  it("matches Node's SHA-1 across padding boundaries", () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_000]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
      expect(hex(sha1(data))).toBe(nodeSha1(data));
    }
  });
  it('gives the same hash fed in uneven chunks', () => {
    const data = Uint8Array.from({ length: 5000 }, (_, i) => (i * 13) & 255);
    const h = new Sha1();
    for (let i = 0; i < data.length; i += 37) h.update(data.subarray(i, i + 37));
    expect(hex(h.digest())).toBe(nodeSha1(data));
  });
});
