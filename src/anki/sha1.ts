/**
 * SHA-1, fed in chunks, in plain TypeScript: an Anki package lists each media file's SHA-1 and
 * Anki refuses a package without them, and the phone has no hashing API that takes a stream.
 * Not for security; only to match what Anki expects. Checked against Node's own SHA-1 in tests.
 */
export class Sha1 {
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  private block = new Uint8Array(64);
  private blockLen = 0;
  private total = 0;
  private w = new Uint32Array(80);

  update(data: Uint8Array): this {
    let i = 0;
    this.total += data.length;
    if (this.blockLen) {
      const take = Math.min(64 - this.blockLen, data.length);
      this.block.set(data.subarray(0, take), this.blockLen);
      this.blockLen += take;
      i = take;
      if (this.blockLen === 64) { this.compress(this.block, 0); this.blockLen = 0; }
    }
    for (; i + 64 <= data.length; i += 64) this.compress(data, i);
    if (i < data.length) { this.block.set(data.subarray(i), 0); this.blockLen = data.length - i; }
    return this;
  }

  digest(): Uint8Array {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.blockLen < 56 ? 56 : 120) - this.blockLen) + 8);
    pad[0] = 0x80;
    const hi = Math.floor(bits / 0x100000000);
    const lo = bits >>> 0;
    const n = pad.length;
    pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi;
    pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo;
    this.total -= pad.length; // update() counts the padding; the length was already written above
    this.update(pad);
    const out = new Uint8Array(20);
    for (let j = 0; j < 5; j++) {
      out[j * 4] = this.h[j] >>> 24; out[j * 4 + 1] = this.h[j] >>> 16; out[j * 4 + 2] = this.h[j] >>> 8; out[j * 4 + 3] = this.h[j];
    }
    return out;
  }

  private compress(d: Uint8Array, o: number) {
    const w = this.w;
    for (let t = 0; t < 16; t++) w[t] = (d[o + t * 4] << 24) | (d[o + t * 4 + 1] << 16) | (d[o + t * 4 + 2] << 8) | d[o + t * 4 + 3];
    for (let t = 16; t < 80; t++) { const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31); }
    let [a, b, c, e, f] = [this.h[0], this.h[1], this.h[2], this.h[3], this.h[4]];
    for (let t = 0; t < 80; t++) {
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const fn = t < 20 ? (b & c) | (~b & e) : t < 40 ? b ^ c ^ e : t < 60 ? (b & c) | (b & e) | (c & e) : b ^ c ^ e;
      const tmp = (((a << 5) | (a >>> 27)) + fn + f + k + w[t]) >>> 0;
      f = e; e = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
    }
    this.h[0] += a; this.h[1] += b; this.h[2] += c; this.h[3] += e; this.h[4] += f;
  }
}

export function sha1(data: Uint8Array): Uint8Array {
  return new Sha1().update(data).digest();
}

/** A SHA-1 as lowercase hex, as Anki writes it in media changes. */
export function sha1Hex(data: Uint8Array): string {
  return Array.from(sha1(data), (b) => b.toString(16).padStart(2, '0')).join('');
}
