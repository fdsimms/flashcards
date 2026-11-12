import type { SyncClient } from './client';
import { serverMeta, syncCollection, type SyncDb, type SyncOutcome } from './collectionSync';
import type { MediaSyncResult } from './mediaSync';
import { SyncError } from './protocol';

/**
 * One sync, start to finish: the collection, then media. Decides what happens when the two sides
 * can't simply be merged. The pieces that touch the phone (files, the database, a prompt) are
 * passed in, so this runs in tests as it does in the app.
 *
 * A full sync replaces one side with the other. Franki only asks when it has to:
 * - Franki has no collection yet, or has nothing of its own the server lacks (no unsent answers,
 *   and no notes or cards changed here and not sent): download, since nothing is lost. This is the first sync after setting the server up. Not when
 *   the kept collection has deck or note type changes of its own (`local`), which a download drops.
 * - The server has no collection yet: upload Franki's.
 * - Otherwise one side's changes will be lost, so the person chooses (or cancels).
 */

export interface FullSyncQuestion {
  uploadOk: boolean;
  downloadOk: boolean;
  /** Answers given in Franki that aren't on the server yet: what a download would lose. */
  unsent: number;
  /** Other changes made in Franki and not on the server yet (notes, deletions, card states), which a download loses too. */
  edits: number;
  reason: 'schema' | 'sanity' | 'local';
}

export interface SyncDeps {
  client: SyncClient;
  /**
   * Holds the kept collection for the whole collection phase (the sync, a full download or
   * upload, the refresh), so an answer given meanwhile waits rather than landing in a file that
   * is about to be replaced. Media comes after, outside it: a long download never holds up Review.
   */
  lock<T>(fn: () => Promise<T>): Promise<T>;
  /** Whether Franki holds an Anki collection at all. */
  hasCollection(): Promise<boolean>;
  /** Runs `fn` on a connection of its own to the kept collection (inside `lock`). */
  withCollection<T>(fn: (db: SyncDb) => Promise<T>): Promise<T>;
  unsentAnswers(): Promise<number>;
  /** Notes, deletions and card changes made here and not on the server yet. */
  unsentEdits(): Promise<number>;
  /** Replaces the kept collection with the server's, then refreshes Franki's decks from it. */
  download(): Promise<void>;
  /** Replaces the server's collection with the kept one. */
  upload(): Promise<void>;
  /** Re-reads the kept collection into Franki's decks after a sync changed it. */
  refresh(): Promise<void>;
  /** Media both ways: the server's changes, then files made here (`syncMedia`). */
  syncMedia(serverUsn: number): Promise<MediaSyncResult>;
  /** Asks which side to keep; null cancels. Automatic syncs that can't ask return null. */
  choose(q: FullSyncQuestion): Promise<'download' | 'upload' | null>;
}

export interface SyncReport {
  collection: 'unchanged' | 'synced' | 'downloaded' | 'uploaded' | 'cancelled' | 'serverEmpty';
  /** Answers sent to the server. */
  sent: number;
  media?: MediaSyncResult;
  /** The media sync failed after the collection synced: the collection's sync still stands. */
  mediaError?: string;
}

export async function runSync(deps: SyncDeps): Promise<SyncReport> {
  const phase = await deps.lock(() => syncTheCollection(deps));
  const { report, mediaUsn } = phase;
  if (report.collection === 'cancelled' || report.collection === 'serverEmpty') return report;
  try {
    report.media = await deps.syncMedia(mediaUsn);
  } catch (e) {
    report.mediaError = e instanceof Error ? e.message : String(e);
  }
  return report;
}

async function syncTheCollection(deps: SyncDeps): Promise<{ report: SyncReport; mediaUsn: number }> {
  let outcome: SyncOutcome;
  if (!(await deps.hasCollection())) {
    const meta = await serverMeta(deps.client);
    if (meta.empty) return { report: { collection: 'serverEmpty', sent: 0 }, mediaUsn: 0 };
    outcome = { kind: 'fullSyncRequired', uploadOk: false, downloadOk: true, reason: 'schema', mediaUsn: meta.media_usn ?? 0 };
  } else {
    outcome = await deps.withCollection((db) => syncCollection(db, deps.client));
  }

  const report: SyncReport = { collection: 'unchanged', sent: 0 };
  switch (outcome.kind) {
    case 'noChanges':
      break;
    case 'synced':
      report.collection = 'synced';
      report.sent = outcome.sent;
      if (outcome.received) await deps.refresh();
      break;
    case 'downloadNeeded':
      report.sent = outcome.sent;
      await deps.download();
      report.collection = 'downloaded';
      break;
    case 'fullSyncRequired': {
      const has = await deps.hasCollection();
      const unsent = has ? await deps.unsentAnswers() : 0;
      const edits = has ? await deps.unsentEdits() : 0;
      let pick: 'download' | 'upload' | null;
      if (!outcome.downloadOk) pick = 'upload';
      else if (!outcome.uploadOk || (unsent === 0 && edits === 0 && outcome.reason !== 'local')) pick = 'download';
      else pick = await deps.choose({ uploadOk: outcome.uploadOk, downloadOk: outcome.downloadOk, unsent, edits, reason: outcome.reason });
      if (!pick) return { report: { collection: 'cancelled', sent: 0 }, mediaUsn: outcome.mediaUsn };
      if (pick === 'download') { await deps.download(); report.collection = 'downloaded'; }
      else { await deps.upload(); report.collection = 'uploaded'; }
      break;
    }
  }
  return { report, mediaUsn: outcome.mediaUsn };
}

/** A sync failure as one line for the person: what went wrong, and what to do about it. */
export function syncErrorText(e: unknown): string {
  if (e instanceof SyncError) {
    switch (e.kind) {
      case 'auth': return 'The server didn\'t accept the sign-in. Sign in again in Sync settings.';
      case 'network': return `Couldn't reach the server. Check the connection and the server address. (${e.message})`;
      case 'clock': return e.message;
      case 'server': return `The server reported a problem: ${e.message}`;
      case 'sanity': return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a sync did, as one line. */
export function reportText(r: SyncReport): string {
  const sent = r.sent ? ` Sent ${count(r.sent, 'answer', 'answers')}.` : '';
  const media = (r.media?.downloaded ? ` Downloaded ${count(r.media.downloaded, 'image or sound', 'images and sounds')}.` : '')
    + (r.media?.uploaded ? ` Sent ${count(r.media.uploaded, 'recording or image', 'recordings and images')}.` : '');
  const mediaFailed = r.mediaError ? ` Images and sounds didn't finish syncing: ${r.mediaError}` : '';
  switch (r.collection) {
    case 'unchanged': return `Already up to date.${media}${mediaFailed}`;
    case 'synced': return `Synced.${sent}${media}${mediaFailed}`;
    case 'downloaded': return `Synced.${sent} Downloaded the whole collection from the server.${media}${mediaFailed}`;
    case 'uploaded': return `Sent Franki's collection to the server, replacing the one there.${media}${mediaFailed}`;
    case 'cancelled': return 'Sync canceled. Nothing was changed.';
    case 'serverEmpty': return 'The server has no collection yet. Sync Anki on your computer with it first, then sync here.';
  }
}

/** The deck list's line about sync: when it last worked, or why it didn't. */
export function syncStatusText(s: { lastSyncAt: string | null; lastError: string | null }, now: Date): string {
  if (s.lastError) return s.lastError;
  if (!s.lastSyncAt) return 'Not synced yet.';
  const minutes = Math.floor((now.getTime() - new Date(s.lastSyncAt).getTime()) / 60000);
  if (minutes < 1) return 'Synced just now.';
  if (minutes < 60) return `Synced ${count(minutes, 'minute', 'minutes')} ago.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${count(hours, 'hour', 'hours')} ago.`;
  const days = Math.floor(hours / 24);
  return `Last synced ${count(days, 'day', 'days')} ago.`;
}

/** The question asked when one collection has to replace the other. */
export function fullSyncPrompt(q: FullSyncQuestion): { title: string; message: string } {
  const why = {
    schema: "The server's collection and Franki's have different histories, so one has to replace the other.",
    sanity: "After syncing, Franki and the server didn't hold the same cards, so one has to replace the other.",
    local: "Franki's collection has deck or note type changes that only a full upload can send, so one has to replace the other.",
  }[q.reason];
  const lost = [
    q.unsent ? count(q.unsent, 'answer', 'answers') : '',
    q.edits ? count(q.edits, 'other change', 'other changes') + ' (notes added, edited or deleted, cards suspended, buried or flagged)' : '',
  ].filter(Boolean);
  const loss = lost.length
    ? ` Downloading loses ${lost.join(' and ')} made in Franki that ${q.unsent + q.edits === 1 ? "isn't" : "aren't"} on the server yet. Uploading replaces what Anki on your other devices has.`
    : " Uploading replaces what Anki on your other devices has.";
  return { title: "Keep the server's collection or Franki's?", message: why + loss };
}
