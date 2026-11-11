import { MessageWriter, decodeMessage, messages, string, uint, utf8Decode } from './protobuf';
import { zstdUnwrap, zstdWrap } from './zstd';

/**
 * What's inside an Anki collection package (.colpkg), per Anki's
 * proto/anki/import_export.proto:
 *
 *   meta                 PackageMetadata { version = 1 }: 3 for the current format
 *   collection.anki21b   the collection (SQLite, schema 18), zstd-compressed     (version 3)
 *   collection.anki21    the collection (SQLite, schema 11), plain              (version 2)
 *   media                MediaEntries, zstd-compressed (v3); JSON {"0": "name"} (v2)
 *   0, 1, 2...           the media files in media-list order, zstd-compressed (v3) or plain (v2)
 *
 * Franki reads the current format and writes it back the same way. The older one ("Support
 * older Anki versions" when exporting) stores note types as JSON in a different schema; it's
 * recognized and refused with what to change, not half-read.
 */

export const LATEST_VERSION = 3;

/** The `meta` entry's version, or 1/2 for an old package that has none (Anki's own rule). */
export function packageVersion(meta: Uint8Array | undefined, names: string[]): number {
  if (meta) return uint(decodeMessage(meta), 1) ?? 0;
  return names.includes('collection.anki21') ? 2 : 1;
}

export function encodeMeta(version = LATEST_VERSION): Uint8Array {
  return new MessageWriter().uint(1, version).finish();
}

export interface MediaEntry {
  name: string;
  size: number;
  /** 20 bytes. Anki refuses a package whose entries lack it. */
  sha1: Uint8Array;
}

/** The media list: entry i is stored in the package as file "i". */
export function decodeMediaList(raw: Uint8Array, version: number): string[] {
  if (version >= LATEST_VERSION) {
    return messages(decodeMessage(zstdUnwrap(raw)), 1).map((e) => string(e, 1) ?? '');
  }
  const map = JSON.parse(utf8Decode(raw)) as Record<string, string>;
  const out: string[] = [];
  for (const [k, v] of Object.entries(map)) out[Number(k)] = v;
  return out;
}

export function encodeMediaList(entries: MediaEntry[]): Uint8Array {
  const all = new MessageWriter();
  for (const e of entries) {
    all.bytes(1, new MessageWriter().string(1, e.name).uint(2, e.size).bytes(3, e.sha1).finish());
  }
  return zstdWrap(all.finish());
}
