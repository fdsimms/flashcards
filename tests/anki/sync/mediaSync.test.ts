import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SyncClient, type HttpPost } from '../../../src/anki/sync/client';
import { mediaAction, pullMedia, type MediaState } from '../../../src/anki/sync/mediaSync';
import type { MediaChange } from '../../../src/anki/sync/protocol';
import { zstdUnwrap, zstdWrap } from '../../../src/anki/zstd';

function server(changes: MediaChange[][], files: Record<string, string>, perRequest = 25) {
  const asked: string[][] = [];
  const reply = (bytes: Uint8Array) => {
    let sent = false;
    return { status: 200, read: async () => (sent ? null : ((sent = true), zstdWrap(bytes))) };
  };
  const post: HttpPost = async (url, _h, body) => {
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
  return { client: new SyncClient('https://anki.example', 'k', post), asked };
}

function local(files: Record<string, string>, recorded: Record<string, string> = {}, usn = 0) {
  const rec = new Map(Object.entries(recorded));
  let last = usn;
  const state: MediaState = {
    lastUsn: async () => last,
    setLastUsn: async (u) => { last = u; },
    recorded: async (n) => rec.get(n),
    record: async (n, s) => { if (s) rec.set(n, s); else rec.delete(n); },
  };
  const folder = {
    exists: (n: string) => n in files,
    write: async (n: string, b: Uint8Array) => { files[n] = new TextDecoder().decode(b); },
    remove: (n: string) => { delete files[n]; },
  };
  return { state, folder, files, rec, last: () => last };
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
