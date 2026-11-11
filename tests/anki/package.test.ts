import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { readPackage, writePackage } from '../../src/anki/package';
import { decodeMediaList, encodeMediaList, encodeMeta, packageVersion } from '../../src/anki/packageFormat';
import { readCollectionRows } from '../support/ankiRows';
import { bytesSource, fileSource, memorySink, writeBytes } from '../support/bytes';

const DIR = join(__dirname, '..', 'fixtures', 'anki');
/** Anki's own export of the fixture collection (make-collection.py writes it). */
const COLPKG = join(DIR, 'collection.colpkg');
const MEDIA = join(DIR, 'collection.media');

async function unpack(source: ReturnType<typeof fileSource>) {
  const collection = memorySink();
  const media = new Map<string, ReturnType<typeof memorySink>>();
  const result = await readPackage(source, {
    collection: async () => collection,
    media: async (i) => { const s = memorySink(); media.set(i, s); return s; },
  });
  return { result, collection, media };
}

describe('package format', () => {
  it('reads the version from meta, or from the entry names of an old package', () => {
    expect(packageVersion(encodeMeta(), [])).toBe(3);
    expect(packageVersion(undefined, ['collection.anki21', 'media'])).toBe(2);
  });
  it('round-trips the media list', () => {
    const sha1 = new Uint8Array(20).fill(7);
    const raw = encodeMediaList([{ name: 'flag.svg', size: 3, sha1 }, { name: 'ä.mp3', size: 1, sha1 }]);
    expect(decodeMediaList(raw, 3)).toEqual(['flag.svg', 'ä.mp3']);
  });
});

describe('reading a package Anki wrote', () => {
  it('unpacks the collection and every media file, decompressed, under its real name', async () => {
    const { result, collection, media } = await unpack(fileSource(COLPKG));
    expect(result.version).toBe(3);
    expect(result.hasCollection).toBe(true);
    expect(Buffer.from(collection.bytes().subarray(0, 15)).toString()).toBe('SQLite format 3');
    expect(collection.closed).toBe(true);
    expect([...result.mediaNames].sort()).toEqual(readdirSync(MEDIA).sort());
    result.mediaNames.forEach((name, i) => {
      expect(Buffer.from(media.get(String(i))!.bytes()).equals(readFileSync(join(MEDIA, name)))).toBe(true);
    });
  });

  it('gives the same answer fed a few bytes at a time', async () => {
    const { result, collection } = await unpack(bytesSource(new Uint8Array(readFileSync(COLPKG)), 5));
    expect(result.mediaNames).toHaveLength(3);
    expect(Buffer.from(collection.bytes().subarray(0, 15)).toString()).toBe('SQLite format 3');
  });

  it('holds a collection the reader understands', async () => {
    const { collection } = await unpack(fileSource(COLPKG));
    const path = join(mkdtempSync(join(tmpdir(), 'pkg-')), 'c.anki2');
    writeBytes(path, collection.bytes());
    expect(buildExport(await readCollectionRows(path)).notes).toHaveLength(7);
  });
});

describe('writing a package', () => {
  it('writes what it reads back: the collection and media, by name', async () => {
    const { collection } = await unpack(fileSource(COLPKG));
    const col = collection.bytes();
    const names = readdirSync(MEDIA).sort();
    const out = memorySink();
    await writePackage(out, async () => bytesSource(col, 64 * 1024), names.map((name) => ({
      name, open: async () => fileSource(join(MEDIA, name)),
    })));
    expect(out.closed).toBe(true);
    const again = await unpack(bytesSource(out.bytes(), 64 * 1024));
    expect(again.result.version).toBe(3);
    expect(again.result.mediaNames).toEqual(names);
    expect(Buffer.from(again.collection.bytes()).equals(Buffer.from(col))).toBe(true);
    names.forEach((name, i) => {
      expect(Buffer.from(again.media.get(String(i))!.bytes()).equals(readFileSync(join(MEDIA, name)))).toBe(true);
    });
  });
});
