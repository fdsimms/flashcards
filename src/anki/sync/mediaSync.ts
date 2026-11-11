import { unzipSync } from 'fflate';
import { utf8Decode, utf8Encode } from '../protobuf';
import type { SyncClient } from './client';
import { MEDIA_FILES_PER_REQUEST, SyncError, type MediaChange } from './protocol';

/**
 * Brings the server's images and sounds down to the phone: Anki's media sync
 * (rslib/src/sync/media/syncer.rs), the receiving half only, since Franki doesn't add or change
 * media. The server numbers every change to its media folder (usn); Franki remembers the last one
 * it has seen and each file's SHA-1, asks for everything newer, downloads what differs and
 * deletes what the server deleted.
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
}

export interface MediaFolder {
  exists(name: string): boolean;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): void;
}

export interface MediaPullResult {
  downloaded: number;
  deleted: number;
  /** Names the server holds that can't be a file name here (a "/" in them), so weren't saved. */
  skipped: string[];
}

const usable = (name: string) => name.length > 0 && !name.includes('/') && name !== '.' && name !== '..';

/** What to do with one change from the server, given what's here (rslib's determine_required_change). */
export function mediaAction(change: MediaChange, recorded: string | undefined, present: boolean): 'download' | 'delete' | 'record' | 'none' {
  const [, , sha1] = change;
  if (!sha1) return recorded !== undefined || present ? 'delete' : 'none';
  if (recorded === sha1) return 'none';
  if (recorded === undefined && present) return 'record';
  return 'download';
}

export async function pullMedia(client: SyncClient, state: MediaState, folder: MediaFolder, serverUsn: number): Promise<MediaPullResult> {
  const result: MediaPullResult = { downloaded: 0, deleted: 0, skipped: [] };
  let lastUsn = await state.lastUsn();
  if (lastUsn === serverUsn) return result;

  for (;;) {
    const batch = await client.media<MediaChange[]>('mediaChanges', { lastUsn });
    if (!batch.length) break;
    const toDownload = new Map<string, string>();
    for (const change of batch) {
      const [name, , sha1] = change;
      if (!usable(name)) { if (sha1) result.skipped.push(name); continue; }
      const action = mediaAction(change, await state.recorded(name), folder.exists(name));
      if (action === 'delete') {
        if (folder.exists(name)) folder.remove(name);
        await state.record(name, null);
        result.deleted++;
      } else if (action === 'record') {
        await state.record(name, sha1);
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
