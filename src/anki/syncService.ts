import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import type { AnkiLink } from '../db/ankiLink';
import { fileUriToPath } from '../db/backup';
import type { Repo } from '../db/repo';
import { hasMedia, removeMedia, writeMedia } from '../media/mediaFiles';
import { fileSink, keptCollectionFile, workFolder } from './files';
import { normalizeEndpoint, SyncClient, type HttpPost } from './sync/client';
import { downloadCollection, markDownloaded, prepareForUpload, uploadCollection } from './sync/collectionSync';
import { pullMedia } from './sync/mediaSync';
import { SyncError } from './sync/protocol';
import { runSync, syncErrorText, type FullSyncQuestion, type SyncReport } from './sync/runSync';
import { adoptDownloadedCollection, refreshFromKeptCollection } from './transfer';

/**
 * The phone's side of syncing with an Anki server: signing in, the HTTP calls (expo/fetch), and
 * the files a full download or upload moves. Native-only, so untested; everything it hands
 * work to is tested in tests/anki/sync, against Anki's own server as well (live.test.ts).
 *
 * Signing in trades the password for the key Anki's server hands out (`hostKey`), kept in the
 * iOS Keychain; the password itself is never stored, as in Anki.
 */

const HOST_KEY = 'franki.ankiSync.hostKey';

/**
 * A request gives up after this long with nothing arriving. A sync holds the kept collection, and
 * answers in Review wait for it, so a server that stops answering mustn't hold it forever. Counted
 * from the last data received, so a large download that keeps arriving is never cut off.
 */
const IDLE_TIMEOUT_MS = 60_000;

export const expoPost: HttpPost = async (url, headers, body) => {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => abort.abort(new Error(`The server stopped answering for ${IDLE_TIMEOUT_MS / 1000} seconds.`)), IDLE_TIMEOUT_MS);
  };
  idle();
  let r: Awaited<ReturnType<typeof fetch>>;
  try {
    // expo/fetch sends any ArrayBufferView as is (normalizeBodyInitAsync); the DOM type is narrower.
    r = await fetch(url, { method: 'POST', headers, body: body as unknown as BodyInit, signal: abort.signal });
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
  const reader = r.body?.getReader();
  let whole: Uint8Array | null = null;
  return {
    status: r.status,
    async read() {
      idle();
      try {
        if (reader) {
          const { value, done } = await reader.read();
          if (done || !value) { clearTimeout(timer); return null; }
          return value;
        }
        // No stream to read from: the whole body once.
        clearTimeout(timer);
        if (whole) return null;
        whole = new Uint8Array(await r.arrayBuffer());
        return whole;
      } catch (e) {
        clearTimeout(timer);
        throw e;
      }
    },
  };
};

export async function signIn(repo: AnkiLink, server: string, user: string, password: string): Promise<void> {
  const endpoint = normalizeEndpoint(server);
  const key = await SyncClient.login(endpoint, user, password, expoPost);
  await SecureStore.setItemAsync(HOST_KEY, key);
  await repo.saveSyncSettings({ enabled: true, server: endpoint, user, lastError: null });
}

export async function turnOffSync(repo: AnkiLink): Promise<void> {
  await SecureStore.deleteItemAsync(HOST_KEY);
  await repo.saveSyncSettings({ enabled: false, lastError: null });
}

/** A downloaded collection, checked and stamped as synced, in a work folder ready to be kept. */
async function receiveCollection(client: SyncClient): Promise<File> {
  const work = workFolder('anki-sync-download');
  const file = new File(work, 'collection.anki2');
  const sink = fileSink(file);
  try {
    await downloadCollection(client, (chunk) => sink.write(chunk));
  } finally {
    await sink.close();
  }
  const conn = await SQLite.openDatabaseAsync(file.name, {}, fileUriToPath(work.uri));
  try {
    const check = await conn.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check');
    if (check?.quick_check !== 'ok') throw new SyncError('server', `The collection the server sent is damaged (${check?.quick_check ?? 'unreadable'}).`);
    await markDownloaded({
      all: (sql) => conn.getAllAsync(sql),
      first: (sql) => conn.getFirstAsync(sql),
      run: async (sql) => { await conn.runAsync(sql); },
      transaction: (fn) => conn.withTransactionAsync(fn),
    });
    await conn.execAsync('PRAGMA journal_mode = DELETE');
  } finally {
    await conn.closeAsync();
  }
  return file;
}

/** Syncs now. `choose` is asked only when one side would replace the other and lose something. */
export async function syncNow(
  repo: Repo & AnkiLink,
  choose: (q: FullSyncQuestion) => Promise<'download' | 'upload' | null>,
): Promise<SyncReport> {
  const settings = await repo.syncSettings();
  const key = await SecureStore.getItemAsync(HOST_KEY);
  if (!settings.enabled || !key) throw new SyncError('auth', 'Sync is not set up.');
  const client = new SyncClient(settings.server, key, expoPost);
  try {
    const report = await runSync({
      client,
      lock: repo.lockAnki,
      hasCollection: async () => (await repo.keptCollection()) !== null,
      withCollection: (fn) => repo.withSyncConnection(fn),
      unsentAnswers: async () => (await repo.ankiStatus()).unsent,
      unsentEdits: () => repo.ankiUnsentEdits(),
      download: async () => {
        const file = await receiveCollection(client);
        await adoptDownloadedCollection(repo, file);
      },
      upload: async () => {
        await repo.withSyncConnection((db) => prepareForUpload(db));
        await uploadCollection(client, new Uint8Array(await keptCollectionFile().arrayBuffer()));
      },
      refresh: () => refreshFromKeptCollection(repo),
      pullMedia: (usn) => pullMedia(client, repo.mediaSyncState(), { exists: hasMedia, write: writeMedia, remove: removeMedia }, usn),
      choose,
    });
    await repo.saveSyncSettings({
      lastSyncAt: report.collection === 'cancelled' ? settings.lastSyncAt : new Date().toISOString(),
      lastError: report.mediaError ? `Images and sounds didn't finish syncing. ${report.mediaError}` : null,
    });
    return report;
  } catch (e) {
    await repo.saveSyncSettings({ lastError: syncErrorText(e) });
    throw e;
  }
}
