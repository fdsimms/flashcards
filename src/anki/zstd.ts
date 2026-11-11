import { Decompress, decompress } from 'fzstd';

/**
 * zstd, which Anki's current package format uses for the collection, the media list and each
 * media file. Reading uses fzstd (pure JS). Writing has no JS compressor to lean on, so it writes
 * zstd's own uncompressed ("raw") blocks: a valid zstd frame Anki reads like any other, just no
 * smaller than its input. Checked by importing such a package with Anki's own code.
 */

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
/** Frame header: no content size, not single-segment, no checksum, no dictionary; 128 KiB window. */
const FRAME_HEADER = [...MAGIC, 0x00, 0x38];
const MAX_BLOCK = 128 * 1024;

function blockHeader(size: number, last: boolean): Uint8Array {
  // Block_Type 0 (Raw) in bits 1-2, Last_Block in bit 0, size in the rest.
  const h = size * 8 + (last ? 1 : 0);
  return Uint8Array.of(h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff);
}

/**
 * Wraps bytes in a zstd frame of raw blocks, a chunk at a time, so a large file never has to be
 * whole in memory. Holds back one block so the last one can be marked last.
 */
export class RawZstdEncoder {
  private started = false;
  private pending = new Uint8Array(MAX_BLOCK);
  private pendingLen = 0;

  constructor(private emit: (bytes: Uint8Array) => void) {}

  push(chunk: Uint8Array) {
    this.start();
    let i = 0;
    while (i < chunk.length) {
      if (this.pendingLen === MAX_BLOCK) this.flush(false);
      const take = Math.min(MAX_BLOCK - this.pendingLen, chunk.length - i);
      this.pending.set(chunk.subarray(i, i + take), this.pendingLen);
      this.pendingLen += take;
      i += take;
    }
  }

  finish() {
    this.start();
    this.flush(true);
  }

  private start() {
    if (!this.started) { this.emit(Uint8Array.from(FRAME_HEADER)); this.started = true; }
  }

  private flush(last: boolean) {
    this.emit(blockHeader(this.pendingLen, last));
    if (this.pendingLen) this.emit(this.pending.slice(0, this.pendingLen));
    this.pendingLen = 0;
  }
}

/** A whole buffer as one zstd frame of raw blocks. */
export function zstdWrap(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  const enc = new RawZstdEncoder((b) => parts.push(b));
  enc.push(data);
  enc.finish();
  return concat(parts);
}

export function zstdUnwrap(data: Uint8Array): Uint8Array {
  return decompress(data);
}

/** Streaming decompression: push compressed chunks, decompressed ones come out of `onData`. */
export function zstdDecoder(onData: (chunk: Uint8Array) => void): { push(chunk: Uint8Array, final: boolean): void } {
  const d = new Decompress((chunk) => onData(chunk));
  return { push: (chunk, final) => d.push(chunk, final) };
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
