import { unzipSync, zipSync } from 'fflate';
import { utf8Decode, utf8Encode } from '../protobuf';
import { sha1 } from '../sha1';
import type { SyncClient } from './client';
import { MEDIA_FILES_PER_REQUEST, MEDIA_UPLOAD_TARGET_BYTES, SyncError, type MediaChange } from './protocol';

/**
 * Anki's media sync (rslib/src/sync/media/syncer.rs). Pulling brings the server's images and
 * sounds down to the phone: the server numbers every change to its media folder (usn); Franki
 * remembers the last one it has seen and each file's SHA-1, asks for everything newer, downloads
 * what differs and deletes what the server deleted. Pushing sends the files Franki made itself
 * (a recording), which wait in a pending list until the server has them. Franki never deletes
 * media on its own, so it sends no deletions.
 *
 * A file already in the media folder with no SHA-1 on record came in with the collection package
 * (step 1's import, or a backup), so it's taken to be the server's version rather than downloaded
 * again: Anki gives an edited image a new name, so a same-named file with different contents is
 * rare, and fetching every file on the first sync would be slow on a large collection.
 */

export interface MediaState {
  lastUsn(): Promise<number>;
  setLastUsn(usn: number): Promise<void>;
  /** The SHA-1 (hex) recorded for a file at a past sync, if any. */
  recorded(name: string): Promise<string | undefined>;
  /** Records a file's SHA-1, or forgets the file (null). */
  record(name: string, sha1: string | null): Promise<void>;
  /** Files made here and not yet sent, by name, with their SHA-1 when they were made (Anki's `sync_required`). */
  pending(): Promise<Map<string, string>>;
  /** Adds a file to the pending list, or takes it off (null). */
  setPending(name: string, sha1: string | null): Promise<void>;
}

export interface MediaFolder {
  exists(name: string): boolean;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): void;
}

/** The media folder as pushing needs it: a file's bytes, or undefined when it's gone. */
export interface MediaReader {
  read(name: string): Promise<Uint8Array | undefined>;
}

export interface MediaPushResult {
  uploaded: number;
}

export type MediaSyncResult = MediaPullResult & MediaPushResult;

/** A SHA-1 as Anki writes it in media changes: lowercase hex. */
export function sha1Hex(bytes: Uint8Array): string {
  return Array.from(sha1(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface MediaPullResult {
  downloaded: number;
  deleted: number;
  /** Names the server holds that can't be a file name here (a "/" in them), so weren't saved. */
  skipped: string[];
}

const usable = (name: string) => name.length > 0 && !name.includes('/') && name !== '.' && name !== '..';

/**
 * What to do with one change from the server, given what's here (rslib's
 * determine_required_change). A file waiting to be sent (`pending`, its SHA-1) stays when the
 * server deleted it, is only recorded when the server already has the same, and otherwise loses
 * to the server's, as in Anki.
 */
export function mediaAction(change: MediaChange, recorded: string | undefined, present: boolean, pending?: string): 'download' | 'delete' | 'record' | 'none' {
  const [, , sha1] = change;
  if (pending !== undefined) {
    if (!sha1) return 'none';
    return pending === sha1 ? 'record' : 'download';
  }
  if (!sha1) return recorded !== undefined || present ? 'delete' : 'none';
  if (recorded === sha1) return 'none';
  if (recorded === undefined && present) return 'record';
  return 'download';
}

export async function pullMedia(client: SyncClient, state: MediaState, folder: MediaFolder, serverUsn: number): Promise<MediaPullResult> {
  const result: MediaPullResult = { downloaded: 0, deleted: 0, skipped: [] };
  let lastUsn = await state.lastUsn();
  if (lastUsn === serverUsn) return result;
  const pending = await state.pending();

  for (;;) {
    const batch = await client.media<MediaChange[]>('mediaChanges', { lastUsn });
    if (!batch.length) break;
    const toDownload = new Map<string, string>();
    for (const change of batch) {
      const [name, , sha1] = change;
      if (!usable(name)) { if (sha1) result.skipped.push(name); continue; }
      const waiting = pending.get(name);
      const action = mediaAction(change, await state.recorded(name), folder.exists(name), waiting);
      if (action === 'delete') {
        if (folder.exists(name)) folder.remove(name);
        await state.record(name, null);
        result.deleted++;
      } else if (action === 'record') {
        await state.record(name, sha1);
        if (waiting !== undefined) { await state.setPending(name, null); pending.delete(name); }
      } else if (action === 'download') {
        toDownload.set(name, sha1);
      }
    }

    let names = [...toDownload.keys()];
    while (names.length) {
      const zip = await client.callBytes('msync/downloadFiles', utf8Encode(JSON.stringify({ files: names.slice(0, MEDIA_FILES_PER_REQUEST) })));
      const entries = unzipSync(zip);
      const meta = JSON.parse(utf8Decode(entries._meta ?? utf8Encode('{}'))) as Record<string, string>;
      const got = new Set<string>();
      for (const [entry, name] of Object.entries(meta)) {
        const bytes = entries[entry];
        if (!bytes || !toDownload.has(name)) continue;
        await folder.write(name, bytes);
        await state.record(name, toDownload.get(name)!);
        if (pending.has(name)) { await state.setPending(name, null); pending.delete(name); }
        got.add(name);
        result.downloaded++;
      }
      // The server sends fewer when the files are large; ask again for the rest.
      if (!got.size) throw new SyncError('server', `The server sent none of the media files asked for (${names.slice(0, 3).join(', ')}).`);
      names = names.filter((n) => !got.has(n));
    }

    lastUsn = batch[batch.length - 1][1];
    await state.setLastUsn(lastUsn);
  }
  return result;
}

/**
 * Sends the pending files (rslib's send_changes): up to 25 a request and about 2.5 MB, stored
 * uncompressed in a zip whose `_meta` lists [name, name in the zip] pairs. The server answers
 * with how many it took and its usn after them; each one taken is recorded with its SHA-1 and
 * leaves the pending list. Anki moves its usn up to the server's only when that's exactly its own
 * plus the files sent, so another device's changes in between are still pulled next time.
 *
 * A file that's gone, empty, or named in a way Anki would refuse (not NFC, a "/") is taken off
 * the list rather than sent, as Anki drops such entries.
 */
export async function pushMedia(client: SyncClient, state: MediaState, folder: MediaReader): Promise<MediaPushResult> {
  const result: MediaPushResult = { uploaded: 0 };
  for (;;) {
    const pending = [...(await state.pending()).keys()];
    if (!pending.length) return result;
    const batch: { name: string; bytes: Uint8Array }[] = [];
    let size = 0;
    for (const name of pending.slice(0, MEDIA_FILES_PER_REQUEST)) {
      if (size > MEDIA_UPLOAD_TARGET_BYTES) break;
      const bytes = usable(name) && name.normalize('NFC') === name ? await folder.read(name) : undefined;
      if (!bytes?.length) { await state.setPending(name, null); continue; }
      batch.push({ name, bytes });
      size += bytes.length;
    }
    if (!batch.length) continue;

    const zip: Record<string, Uint8Array> = {};
    batch.forEach((f, i) => { zip[String(i)] = f.bytes; });
    zip._meta = utf8Encode(JSON.stringify(batch.map((f, i) => [f.name, String(i)])));
    const reply = await client.mediaBytes<[number, number]>('uploadChanges', zipSync(zip, { level: 0 }));
    const [processed, serverUsn] = reply;
    if (!processed) throw new SyncError('server', `The server took none of the media files sent (${batch.slice(0, 3).map((f) => f.name).join(', ')}).`);
    const taken = batch.slice(0, processed);
    for (const f of taken) {
      await state.record(f.name, sha1Hex(f.bytes));
      await state.setPending(f.name, null);
    }
    result.uploaded += taken.length;
    const lastUsn = await state.lastUsn();
    if (lastUsn + taken.length === serverUsn) await state.setLastUsn(serverUsn);
  }
}

/** A whole media sync, as Anki runs one: the server's changes first, then Franki's own. */
export async function syncMedia(client: SyncClient, state: MediaState, folder: MediaFolder & MediaReader, serverUsn: number): Promise<MediaSyncResult> {
  const pulled = await pullMedia(client, state, folder, serverUsn);
  return { ...pulled, ...(await pushMedia(client, state, folder)) };
}
