import { describe, expect, it, vi } from 'vitest';
import { SyncClient } from '../../../src/anki/sync/client';
import type { SyncOutcome } from '../../../src/anki/sync/collectionSync';
import * as collectionSync from '../../../src/anki/sync/collectionSync';
import { runSync, syncErrorText, type SyncDeps } from '../../../src/anki/sync/runSync';
import { SyncError } from '../../../src/anki/sync/protocol';

const client = new SyncClient('https://anki.example', 'k', async () => { throw new Error('no network in this test'); });

function deps(outcome: SyncOutcome | null, over: Partial<SyncDeps> = {}) {
  const calls: string[] = [];
  vi.spyOn(collectionSync, 'syncCollection').mockImplementation(async () => outcome!);
  const d: SyncDeps = {
    client,
    lock: async (fn) => { calls.push('lock'); const r = await fn(); calls.push('unlock'); return r; },
    hasCollection: async () => outcome !== null,
    withCollection: async (fn) => fn({} as never),
    unsentAnswers: async () => 0,
    download: async () => { calls.push('download'); },
    upload: async () => { calls.push('upload'); },
    refresh: async () => { calls.push('refresh'); },
    pullMedia: async (usn) => { calls.push(`media ${usn}`); return { downloaded: 1, deleted: 0, skipped: [] }; },
    choose: async () => { calls.push('ask'); return null; },
    ...over,
  };
  return { d, calls };
}

const full = (over: Partial<Extract<SyncOutcome, { kind: 'fullSyncRequired' }>> = {}): SyncOutcome =>
  ({ kind: 'fullSyncRequired', uploadOk: true, downloadOk: true, reason: 'schema', mediaUsn: 7, ...over });

describe('one sync, start to finish', () => {
  it('refreshes Franki\'s decks only when the collection changed here, and always pulls media', async () => {
    const a = deps({ kind: 'synced', received: false, sent: 3, mediaUsn: 7 });
    expect(await runSync(a.d)).toMatchObject({ collection: 'synced', sent: 3 });
    expect(a.calls).toEqual(['lock', 'unlock', 'media 7']);
    const b = deps({ kind: 'synced', received: true, sent: 0, mediaUsn: 7 });
    await runSync(b.d);
    expect(b.calls).toEqual(['lock', 'refresh', 'unlock', 'media 7']);
  });

  it('downloads after a sync that sent its answers but couldn\'t take everything in', async () => {
    const a = deps({ kind: 'downloadNeeded', sent: 2, reason: 'a deck was added', mediaUsn: 7 });
    expect(await runSync(a.d)).toMatchObject({ collection: 'downloaded', sent: 2 });
    expect(a.calls).toEqual(['lock', 'download', 'unlock', 'media 7']);
  });

  it('downloads without asking when nothing here would be lost', async () => {
    const a = deps(full());
    expect((await runSync(a.d)).collection).toBe('downloaded');
    expect(a.calls).toEqual(['lock', 'download', 'unlock', 'media 7']);
  });

  it('uploads without asking when the server has nothing', async () => {
    const a = deps(full({ downloadOk: false }), { unsentAnswers: async () => 5 });
    expect((await runSync(a.d)).collection).toBe('uploaded');
  });

  it('asks when a download would lose answers, and does what was chosen', async () => {
    const asked: unknown[] = [];
    const a = deps(full(), { unsentAnswers: async () => 4, choose: async (q) => { asked.push(q); return 'upload'; } });
    expect((await runSync(a.d)).collection).toBe('uploaded');
    expect(asked).toEqual([{ uploadOk: true, downloadOk: true, unsent: 4, reason: 'schema' }]);
    const b = deps(full(), { unsentAnswers: async () => 4 });
    expect(await runSync(b.d)).toEqual({ collection: 'cancelled', sent: 0 });
    expect(b.calls).toEqual(['lock', 'ask', 'unlock']);
  });

  it('asks when the kept collection has deck changes of its own, even with no answers unsent', async () => {
    const a = deps(full({ reason: 'local' }));
    expect((await runSync(a.d)).collection).toBe('cancelled');
    expect(a.calls).toEqual(['lock', 'ask', 'unlock']);
  });

  it('keeps the collection\'s sync when only the media pull fails', async () => {
    const a = deps({ kind: 'noChanges', mediaUsn: 7 }, { pullMedia: async () => { throw new SyncError('network', 'offline'); } });
    expect(await runSync(a.d)).toEqual({ collection: 'unchanged', sent: 0, mediaError: 'offline' });
  });

  it('says what to do about each kind of failure', () => {
    expect(syncErrorText(new SyncError('auth', 'x'))).toMatch(/Sign in again/);
    expect(syncErrorText(new SyncError('network', 'timed out'))).toMatch(/Couldn't reach the server.*timed out/);
  });
});

describe('what a sync says', async () => {
  const { reportText, syncStatusText, fullSyncPrompt } = await import('../../../src/anki/sync/runSync');

  it('sums up a sync in a line', () => {
    expect(reportText({ collection: 'synced', sent: 3, media: { downloaded: 1, deleted: 0, skipped: [] } }))
      .toBe('Synced. Sent 3 answers. Downloaded 1 image or sound.');
    expect(reportText({ collection: 'unchanged', sent: 0 })).toBe('Already up to date.');
    expect(reportText({ collection: 'synced', sent: 0, mediaError: 'offline' })).toBe("Synced. Images and sounds didn't finish syncing: offline");
  });

  it('says when it last synced, or what went wrong', () => {
    const now = new Date(2026, 10, 11, 12);
    expect(syncStatusText({ lastSyncAt: null, lastError: null }, now)).toBe('Not synced yet.');
    expect(syncStatusText({ lastSyncAt: new Date(2026, 10, 11, 11, 58).toISOString(), lastError: null }, now)).toBe('Synced 2 minutes ago.');
    expect(syncStatusText({ lastSyncAt: new Date(2026, 10, 11, 9).toISOString(), lastError: null }, now)).toBe('Synced 3 hours ago.');
    expect(syncStatusText({ lastSyncAt: new Date(2026, 10, 9, 12).toISOString(), lastError: null }, now)).toBe('Last synced 2 days ago.');
    expect(syncStatusText({ lastSyncAt: null, lastError: "Couldn't reach the server." }, now)).toBe("Couldn't reach the server.");
  });

  it('says what a download would lose', () => {
    expect(fullSyncPrompt({ uploadOk: true, downloadOk: true, unsent: 2, reason: 'schema' }).message).toMatch(/loses 2 answers given in Franki that aren't on the server/);
    expect(fullSyncPrompt({ uploadOk: true, downloadOk: true, unsent: 0, reason: 'local' }).message).not.toMatch(/loses/);
  });
});
