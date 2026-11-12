import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SyncClient, type HttpPost } from '../../../src/anki/sync/client';
import { mediaAction, pullMedia, pushMedia, syncMedia, type MediaState } from '../../../src/anki/sync/mediaSync';
import { sha1Hex } from '../../../src/anki/sha1';
import type { MediaChange } from '../../../src/anki/sync/protocol';
import { zstdUnwrap, zstdWrap } from '../../../src/anki/zstd';

function server(changes: MediaChange[][], files: Record<string, string>, perRequest = 25, serverUsn = 0) {
  const asked: string[][] = [];
  const uploads: { meta: [string, string | null][]; files: Record<string, string> }[] = [];
  let usn = serverUsn;
  const reply = (bytes: Uint8Array) => {
    let sent = false;
    return { status: 200, read: async () => (sent ? null : ((sent = true), zstdWrap(bytes))) };
  };
  const post: HttpPost = async (url, _h, body) => {
    if (url.endsWith('msync/uploadChanges')) {
      const entries = unzipSync(zstdUnwrap(body));
      const meta = JSON.parse(strFromU8(entries._meta)) as [string, string | null][];
      uploads.push({ meta, files: Object.fromEntries(meta.map(([name, inZip]) => [name, strFromU8(entries[inZip!])])) });
      usn += meta.length;
      return reply(strToU8(JSON.stringify({ data: [meta.length, usn], err: '' })));
    }
    const json = JSON.parse(new TextDecoder().decode(zstdUnwrap(body)));
    if (url.endsWith('msync/mediaChanges')) {
      const batch = changes.find((b) => b.length && b[0][1] > json.lastUsn) ?? [];
      return reply(strToU8(JSON.stringify({ data: batch, err: '' })));
    }
    if (url.endsWith('msync/downloadFiles')) {
      asked.push(json.files);
      const names = (json.files as string[]).slice(0, perRequest);
      const zip: Record<string, Uint8Array> = { _meta: strToU8(JSON.stringify(Object.fromEntries(names.map((n, i) => [String(i), n])))) };
      names.forEach((n, i) => { zip[String(i)] = strToU8(files[n]); });
      return reply(zipSync(zip));
    }
    throw new Error(url);
  };
  return { client: new SyncClient('https://anki.example', 'k', post), asked, uploads };
}

function local(files: Record<string, string>, recorded: Record<string, string> = {}, usn = 0, waiting: Record<string, string> = {}) {
  const rec = new Map(Object.entries(recorded));
  const pending = new Map(Object.entries(waiting));
  let last = usn;
  const state: MediaState = {
    lastUsn: async () => last,
    setLastUsn: async (u) => { last = u; },
    recorded: async (n) => rec.get(n),
    record: async (n, s) => { if (s) rec.set(n, s); else rec.delete(n); },
    pending: async () => new Map(pending),
    setPending: async (n, s) => { if (s) pending.set(n, s); else pending.delete(n); },
  };
  const folder = {
    exists: (n: string) => n in files,
    read: async (n: string) => (n in files ? strToU8(files[n]) : undefined),
    write: async (n: string, b: Uint8Array) => { files[n] = new TextDecoder().decode(b); },
    remove: (n: string) => { delete files[n]; },
  };
  return { state, folder, files, rec, pending, last: () => last };
}

describe('pulling media from the server', () => {
  it('decides per file as Anki does', () => {
    expect(mediaAction(['a', 1, ''], undefined, false)).toBe('none');
    expect(mediaAction(['a', 1, ''], 'x', true)).toBe('delete');
    expect(mediaAction(['a', 1, 'x'], 'x', true)).toBe('none');
    expect(mediaAction(['a', 1, 'y'], 'x', true)).toBe('download');
    expect(mediaAction(['a', 1, 'y'], undefined, false)).toBe('download');
    // Already here from the collection package, never recorded: taken as the server's.
    expect(mediaAction(['a', 1, 'y'], undefined, true)).toBe('record');
  });

  it('keeps a file waiting to be sent as Anki does: through a deletion, recorded when the server has the same, else the server wins', () => {
    expect(mediaAction(['a', 1, ''], undefined, true, 'p')).toBe('none');
    expect(mediaAction(['a', 1, 'p'], undefined, true, 'p')).toBe('record');
    expect(mediaAction(['a', 1, 'q'], 'p', true, 'p')).toBe('download');
  });

  it('takes a waiting file off the list once the server has it or replaced it', async () => {
    const s = server([[['same.mp3', 1, 'h1'], ['other.mp3', 2, 'theirs']]], { 'other.mp3': 'THEIRS' });
    const l = local({ 'same.mp3': 'x', 'other.mp3': 'mine' }, {}, 0, { 'same.mp3': 'h1', 'other.mp3': 'mine-sha' });
    await pullMedia(s.client, l.state, l.folder, 2);
    expect([...l.pending.keys()]).toEqual([]);
    expect(l.files['other.mp3']).toBe('THEIRS');
    expect(l.rec.get('same.mp3')).toBe('h1');
  });

  it('downloads new and changed files, deletes removed ones, and remembers where it got to', async () => {
    const s = server(
      [[['new.mp3', 3, 'n1'], ['changed.png', 4, 'c2'], ['gone.jpg', 5, '']], [['late.svg', 6, 'l1']]],
      { 'new.mp3': 'NEW', 'changed.png': 'CHANGED', 'late.svg': 'LATE' },
    );
    const l = local({ 'changed.png': 'old', 'gone.jpg': 'bye', 'kept.gif': 'same' }, { 'changed.png': 'c1', 'gone.jpg': 'g1' }, 2);
    const r = await pullMedia(s.client, l.state, l.folder, 6);
    expect(r).toEqual({ downloaded: 3, deleted: 1, skipped: [] });
    expect(l.files).toEqual({ 'changed.png': 'CHANGED', 'kept.gif': 'same', 'new.mp3': 'NEW', 'late.svg': 'LATE' });
    expect(l.rec.get('new.mp3')).toBe('n1');
    expect(l.last()).toBe(6);
  });

  it('asks again for what the server left out of a reply', async () => {
    const names = ['a', 'b', 'c'];
    const s = server([names.map((n, i) => [n, i + 1, `h${n}`] as MediaChange)], { a: 'A', b: 'B', c: 'C' }, 2);
    const l = local({});
    await pullMedia(s.client, l.state, l.folder, 3);
    expect(s.asked).toEqual([['a', 'b', 'c'], ['c']]);
    expect(l.files).toEqual({ a: 'A', b: 'B', c: 'C' });
  });

  it('does nothing when already up to date, and skips a name that can\'t be a file here', async () => {
    const l = local({}, {}, 9);
    expect(await pullMedia(server([], {}).client, l.state, l.folder, 9)).toEqual({ downloaded: 0, deleted: 0, skipped: [] });
    const l2 = local({});
    const r = await pullMedia(server([[['sub/dir.png', 1, 'x']]], {}).client, l2.state, l2.folder, 1);
    expect(r.skipped).toEqual(['sub/dir.png']);
  });
});

describe('sending media made here', () => {
  it("sends each waiting file in Anki's upload zip, records it, and moves up to the server's usn", async () => {
    const s = server([], {}, 25, 5);
    const l = local({ 'rec.mp3': 'AUDIO' }, {}, 5, { 'rec.mp3': sha1Hex(strToU8('AUDIO')) });
    expect(await pushMedia(s.client, l.state, l.folder)).toEqual({ uploaded: 1 });
    expect(s.uploads).toEqual([{ meta: [['rec.mp3', '0']], files: { 'rec.mp3': 'AUDIO' } }]);
    expect(l.rec.get('rec.mp3')).toBe(sha1Hex(strToU8('AUDIO')));
    expect([...l.pending.keys()]).toEqual([]);
    expect(l.last()).toBe(6);
  });

  it("leaves its usn when another device's change came in between, so the next pull still fetches it", async () => {
    const s = server([], {}, 25, 9);
    const l = local({ 'rec.mp3': 'AUDIO' }, {}, 5, { 'rec.mp3': 'x' });
    await pushMedia(s.client, l.state, l.folder);
    expect(l.last()).toBe(5);
  });

  it('sends at most 25 a request, and drops a waiting file that is gone or empty', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `f${i}.mp3`);
    const s = server([], {});
    const l = local({ ...Object.fromEntries(names.map((n) => [n, n])), 'empty.mp3': '' }, {}, 0,
      { ...Object.fromEntries(names.map((n) => [n, 'x'])), 'gone.mp3': 'x', 'empty.mp3': 'x' });
    expect(await pushMedia(s.client, l.state, l.folder)).toEqual({ uploaded: 30 });
    expect(s.uploads.map((u) => u.meta.length)).toEqual([25, 5]);
    expect(l.pending.size).toBe(0);
  });

  it('pulls first, then sends', async () => {
    const s = server([[['new.png', 1, 'n1']]], { 'new.png': 'NEW' }, 25, 1);
    const l = local({ 'rec.mp3': 'AUDIO' }, {}, 0, { 'rec.mp3': 'x' });
    expect(await syncMedia(s.client, l.state, l.folder, 1)).toEqual({ downloaded: 1, deleted: 0, skipped: [], uploaded: 1 });
    expect(l.last()).toBe(2);
  });
});
