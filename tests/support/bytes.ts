import { closeSync, openSync, readSync, writeFileSync } from 'node:fs';
import type { ByteSink, ByteSource } from '../../src/anki/package';

/** A file read in chunks, as the phone reads one through a file handle. */
export function fileSource(path: string): ByteSource {
  const fd = openSync(path, 'r');
  let done = false;
  return {
    async read(max) {
      if (done) return null;
      const buf = new Uint8Array(max);
      const n = readSync(fd, buf, 0, max, null);
      if (n === 0) { done = true; closeSync(fd); return null; }
      return buf.subarray(0, n);
    },
  };
}

/** Bytes as a source, handed out in chunks of `size` (small, to cross every boundary). */
export function bytesSource(bytes: Uint8Array, size = 7): ByteSource {
  let i = 0;
  return {
    async read(max) {
      if (i >= bytes.length) return null;
      const n = Math.min(max, size, bytes.length - i);
      const out = bytes.subarray(i, i + n);
      i += n;
      return out;
    },
  };
}

export function memorySink(): ByteSink & { bytes(): Uint8Array; closed: boolean } {
  const parts: Uint8Array[] = [];
  const sink = {
    closed: false,
    async write(b: Uint8Array) { parts.push(b.slice()); },
    async close() { sink.closed = true; },
    bytes() {
      const n = parts.reduce((a, p) => a + p.length, 0);
      const out = new Uint8Array(n);
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    },
  };
  return sink;
}

export function writeBytes(path: string, bytes: Uint8Array) {
  writeFileSync(path, bytes);
}
