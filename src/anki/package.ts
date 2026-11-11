import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough } from 'fflate';
import { decodeMediaList, encodeMediaList, encodeMeta, packageVersion, type MediaEntry } from './packageFormat';
import { Sha1 } from './sha1';
import { concat, RawZstdEncoder, zstdDecoder } from './zstd';

/**
 * Reads and writes Anki collection packages a chunk at a time, over plain byte streams, so the
 * same code runs on the phone (file handles) and in tests (Node files), and a package with a few
 * hundred megabytes of media is never whole in memory. packageFormat.ts says what's inside.
 */

export interface ByteSource {
  /** Up to `max` bytes, or null at the end. */
  read(max: number): Promise<Uint8Array | null>;
}

export interface ByteSink {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

const CHUNK = 256 * 1024;
const isZstd = (b: Uint8Array) => b.length >= 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;

export interface ReadPackageResult {
  version: number;
  /** Media file names, in package order: entry i went to `mediaSink(String(i))`. */
  mediaNames: string[];
  /** Whether a current-format collection (collection.anki21b) was found and written. */
  hasCollection: boolean;
}

/**
 * Unpacks a package: the collection, decompressed, into `collectionSink`; each media file,
 * decompressed, into `mediaSink(index)` (named by position: the media list naming them comes at
 * the end). Small entries (meta, the media list) are kept in memory.
 */
export async function readPackage(
  source: ByteSource,
  sinks: { collection: () => Promise<ByteSink>; media: (index: string) => Promise<ByteSink> },
): Promise<ReadPackageResult> {
  let chain: Promise<void> = Promise.resolve();
  let failure: unknown;
  const later = (fn: () => Promise<void>) => { chain = chain.then(fn).catch((e) => { failure ??= e; }); };
  const small = new Map<string, Uint8Array[]>();
  const names: string[] = [];
  let hasCollection = false;

  const unzip = new Unzip((file) => {
    names.push(file.name);
    const name = file.name;
    if (name === 'meta' || name === 'media') {
      small.set(name, []);
      file.ondata = (err, chunk) => { if (err) failure ??= err; else small.get(name)!.push(chunk); };
      file.start();
      return;
    }
    const isCollection = name === 'collection.anki21b';
    const isMedia = /^\d+$/.test(name);
    if (!isCollection && !isMedia) { file.ondata = () => undefined; file.start(); return; } // collection.anki2 stub, old formats
    if (isCollection) hasCollection = true;

    let sink: ByteSink | undefined;
    later(async () => { sink = isCollection ? await sinks.collection() : await sinks.media(name); });
    // Decide per entry from its first bytes whether it's zstd: current packages compress every
    // file, older ones none.
    let decoder: ReturnType<typeof zstdDecoder> | undefined;
    let decided = false;
    // The first few bytes are held until there are enough to see zstd's 4-byte marker, which a
    // chunk boundary could otherwise split.
    let head: Uint8Array = new Uint8Array(0);
    const write = (chunk: Uint8Array) => { const copy = chunk.slice(); later(async () => sink!.write(copy)); };
    file.ondata = (err, chunk, final) => {
      if (err) { failure ??= err; return; }
      let data: Uint8Array = chunk;
      if (!decided) {
        head = concat([head, chunk]);
        if (head.length < 4 && !final) return;
        decided = true;
        if (isZstd(head)) decoder = zstdDecoder(write);
        data = head;
      }
      if (decoder) decoder.push(data, final);
      else if (data.length) write(data);
      if (final) later(async () => sink!.close());
    };
    file.start();
  });
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);

  for (;;) {
    const chunk = await source.read(CHUNK);
    unzip.push(chunk ?? new Uint8Array(0), chunk === null);
    // Let the writes catch up before reading more: holds memory to about one chunk's worth.
    await chain;
    if (failure) throw failure;
    if (chunk === null) break;
  }
  await chain;
  if (failure) throw failure;

  const meta = small.has('meta') ? concat(small.get('meta')!) : undefined;
  const version = packageVersion(meta, names);
  const media = small.has('media') ? decodeMediaList(concat(small.get('media')!), version) : [];
  return { version, mediaNames: media, hasCollection };
}

export interface MediaFileSource {
  name: string;
  open(): Promise<ByteSource>;
}

/**
 * Packs a current-format package into `sink`: meta, the collection, each media file, then the
 * media list (with each file's size and SHA-1, computed while it streams through).
 */
export async function writePackage(
  sink: ByteSink,
  collection: () => Promise<ByteSource>,
  media: MediaFileSource[],
): Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  let failure: unknown;
  const zip = new Zip((err, chunk) => {
    if (err) { failure ??= err; return; }
    const copy = chunk.slice();
    chain = chain.then(() => sink.write(copy)).catch((e) => { failure ??= e; });
  });
  const settle = async () => { await chain; if (failure) throw failure; };

  const addWhole = async (name: string, bytes: Uint8Array) => {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(bytes, true);
    await settle();
  };

  const addStream = async (name: string, src: ByteSource, onRaw?: (b: Uint8Array) => void) => {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    const enc = new RawZstdEncoder((b) => entry.push(b, false));
    for (;;) {
      const chunk = await src.read(CHUNK);
      if (chunk === null) break;
      onRaw?.(chunk);
      enc.push(chunk);
      await settle();
    }
    enc.finish();
    entry.push(new Uint8Array(0), true);
    await settle();
  };

  await addWhole('meta', encodeMeta());
  await addStream('collection.anki21b', await collection());
  const entries: MediaEntry[] = [];
  for (let i = 0; i < media.length; i++) {
    const hash = new Sha1();
    let size = 0;
    await addStream(String(i), await media[i].open(), (b) => { hash.update(b); size += b.length; });
    entries.push({ name: media[i].name, size, sha1: hash.digest() });
  }
  await addWhole('media', encodeMediaList(entries));
  zip.end();
  await settle();
  await sink.close();
}
