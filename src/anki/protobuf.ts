/**
 * Just enough protobuf to read and write the few Anki messages Franki touches: deck settings,
 * note types, templates, a package's metadata and its media list. No schema, no codegen: callers
 * name the field numbers they read, taken from Anki's `proto/anki/*.proto` (each caller says
 * which message). Everything else in a message is skipped on read.
 */

import { strFromU8, strToU8 } from 'fflate';

export type Field =
  | { wire: 0; value: bigint }
  | { wire: 1 | 5; value: Uint8Array }
  | { wire: 2; value: Uint8Array };

export type Message = Map<number, Field[]>;

export function decodeMessage(bytes: Uint8Array): Message {
  const out: Message = new Map();
  let i = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= bytes.length) throw new Error('truncated varint');
      const b = bytes[i++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
  };
  while (i < bytes.length) {
    const key = Number(varint());
    const num = key >>> 3;
    const wire = key & 7;
    let field: Field;
    if (wire === 0) field = { wire: 0, value: varint() };
    else if (wire === 1) { field = { wire: 1, value: bytes.subarray(i, i + 8) }; i += 8; }
    else if (wire === 2) { const len = Number(varint()); field = { wire: 2, value: bytes.subarray(i, i + len) }; i += len; }
    else if (wire === 5) { field = { wire: 5, value: bytes.subarray(i, i + 4) }; i += 4; }
    else throw new Error(`unsupported protobuf wire type ${wire}`);
    if (!out.has(num)) out.set(num, []);
    out.get(num)!.push(field);
  }
  return out;
}

const f32 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);

export function uint(msg: Message, num: number): number | undefined {
  const v = msg.get(num)?.at(-1);
  return v && v.wire === 0 ? Number(v.value) : undefined;
}

export function float(msg: Message, num: number): number | undefined {
  const v = msg.get(num)?.at(-1);
  return v && v.wire === 5 ? f32(v.value) : undefined;
}

/** A repeated float, packed (one length-delimited run) or not (one fixed32 per value). */
export function floats(msg: Message, num: number): number[] {
  const out: number[] = [];
  for (const v of msg.get(num) ?? []) {
    if (v.wire === 5) out.push(f32(v.value));
    else if (v.wire === 2) for (let j = 0; j + 4 <= v.value.length; j += 4) out.push(f32(v.value.subarray(j, j + 4)));
  }
  return out;
}

export function bytesField(msg: Message, num: number): Uint8Array | undefined {
  const v = msg.get(num)?.at(-1);
  return v && v.wire === 2 ? v.value : undefined;
}

export function string(msg: Message, num: number): string | undefined {
  const b = bytesField(msg, num);
  return b ? utf8Decode(b) : undefined;
}

export function message(msg: Message, num: number): Message | undefined {
  const b = bytesField(msg, num);
  return b ? decodeMessage(b) : undefined;
}

/** Every occurrence of a repeated message field. */
export function messages(msg: Message, num: number): Message[] {
  return (msg.get(num) ?? []).filter((f) => f.wire === 2).map((f) => decodeMessage(f.value as Uint8Array));
}

// ---- writing ----

function varintBytes(n: number): number[] {
  // A negative int32/int64 is its 64-bit two's complement: ten bytes, as protobuf writes it.
  if (n < 0) {
    const out: number[] = [];
    let v = BigInt.asUintN(64, BigInt(n));
    while (v > 127n) { out.push(Number(v & 127n) | 128); v >>= 7n; }
    out.push(Number(v));
    return out;
  }
  const out: number[] = [];
  let v = n;
  while (v > 127) { out.push((v % 128) | 128); v = Math.floor(v / 128); }
  out.push(v);
  return out;
}

function f32Bytes(v: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return Array.from(b);
}

/** A signed varint field (int32/int64) read back as a number, negative values included. */
export function int(msg: Message, num: number): number | undefined {
  const v = msg.get(num)?.at(-1);
  return v && v.wire === 0 ? Number(BigInt.asIntN(64, v.value)) : undefined;
}

/** Builds a message field by field, in the order written. */
export class MessageWriter {
  private parts: number[] = [];
  /** A varint field: uint32/uint64, bool (0/1), an enum, or int32/int64 (negatives included). */
  uint(num: number, value: number): this {
    this.parts.push(...varintBytes(num * 8), ...varintBytes(value));
    return this;
  }
  float(num: number, value: number): this {
    this.parts.push(...varintBytes(num * 8 + 5), ...f32Bytes(value));
    return this;
  }
  /** A repeated float, packed as proto3 writes it. */
  packedFloats(num: number, values: number[]): this {
    return this.bytes(num, Uint8Array.from(values.flatMap(f32Bytes)));
  }
  bytes(num: number, value: Uint8Array): this {
    this.parts.push(...varintBytes(num * 8 + 2), ...varintBytes(value.length));
    for (let i = 0; i < value.length; i++) this.parts.push(value[i]);
    return this;
  }
  string(num: number, value: string): this {
    return this.bytes(num, utf8Encode(value));
  }
  finish(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

// fflate's pure-JS UTF-8 rather than TextDecoder, which Hermes may not have.
export function utf8Encode(s: string): Uint8Array {
  return strToU8(s);
}
export function utf8Decode(b: Uint8Array): string {
  return strFromU8(b);
}
