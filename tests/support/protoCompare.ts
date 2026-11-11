import { decodeMessage } from '../../src/anki/protobuf';

/**
 * A protobuf message as comparable data: each field's raw values, in order, except `other`
 * (field 255), whose JSON Anki writes from a Rust HashMap in no fixed key order, so it's parsed.
 */
export function comparable(bytes: Uint8Array | string): Record<number, unknown[]> {
  const b = typeof bytes === 'string' ? new Uint8Array(Buffer.from(bytes, 'base64')) : bytes;
  const out: Record<number, unknown[]> = {};
  for (const [num, fields] of decodeMessage(b)) {
    out[num] = fields.map((f) => (num === 255 ? JSON.parse(Buffer.from(f.value as Uint8Array).toString('utf8'))
      : f.wire === 0 ? String(f.value) : Buffer.from(f.value as Uint8Array).toString('hex')));
  }
  return out;
}
