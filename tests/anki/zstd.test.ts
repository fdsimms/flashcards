import { describe, expect, it } from 'vitest';
import { RawZstdEncoder, concat, zstdUnwrap, zstdWrap } from '../../src/anki/zstd';

describe('zstd raw frames', () => {
  it('round-trips through a real zstd decoder, across block boundaries and when empty', () => {
    for (const n of [0, 1, 128 * 1024, 128 * 1024 + 1, 300_000]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 17) & 255);
      expect(Buffer.from(zstdUnwrap(zstdWrap(data))).equals(Buffer.from(data))).toBe(true);
    }
  });
  it('streams: many small pushes make the same frame', () => {
    const data = Uint8Array.from({ length: 200_000 }, (_, i) => i & 255);
    const parts: Uint8Array[] = [];
    const enc = new RawZstdEncoder((b) => parts.push(b));
    for (let i = 0; i < data.length; i += 999) enc.push(data.subarray(i, i + 999));
    enc.finish();
    expect(Buffer.from(zstdUnwrap(concat(parts))).equals(Buffer.from(data))).toBe(true);
  });
});
