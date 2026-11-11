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
  const out: number[] = [];
  let v = n;
  while (v > 127) { out.push((v % 128) | 128); v = Math.floor(v / 128); }
  out.push(v);
  return out;
}

/** Builds a message field by field, in the order written. */
export class MessageWriter {
  private parts: number[] = [];
  uint(num: number, value: number): this {
    this.parts.push(...varintBytes(num * 8), ...varintBytes(value));
    return this;
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
