import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { APP_GROUP_ID, INBOX_FILE, mergeShares, parseShares, type SharedItem } from '../core/shareInbox';

/**
 * The shares waiting on this phone (src/core/shareInbox.ts): taken out of the App Group the share
 * extension writes to, and kept in the documents folder until one is added, cancelled or dismissed.
 * Taking copies them here before deleting the App Group's file, so the file is never the only copy
 * of a share the app has read (dundundun's shared links learned this). Nothing here reaches a server.
 */
const keptFile = () => new File(Paths.document, 'share-inbox.json');

let items: SharedItem[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<(items: SharedItem[]) => void>();

function publish(next: SharedItem[]): void {
  items = next;
  for (const l of listeners) l(items);
  try {
    const f = keptFile();
    if (!items.length) {
      if (f.exists) f.delete();
      return;
    }
    if (!f.exists) f.create();
    f.write(JSON.stringify(items));
  } catch {
    // The shares stay in memory for this run; a later change tries the file again.
  }
}

async function readJson(file: File): Promise<unknown> {
  try {
    return file.exists ? JSON.parse(await file.text()) : [];
  } catch {
    return [];
  }
}

function load(): Promise<void> {
  loaded ??= readJson(keptFile()).then((raw) => { items = mergeShares(parseShares(raw), items); });
  return loaded;
}

/** The App Group's file, or null in a build made before the share extension (no App Group entitlement). */
function inboxFile(): File | null {
  try {
    const group = Paths.appleSharedContainers[APP_GROUP_ID];
    return group ? new File(group, INBOX_FILE) : null;
  } catch {
    return null;
  }
}

export const shareInbox = {
  /** Takes whatever the extension left since last time, keeps it, and returns every share waiting. */
  async take(): Promise<SharedItem[]> {
    await load();
    const file = inboxFile();
    if (!file?.exists) return items;
    const taken = parseShares(await readJson(file));
    publish(mergeShares(items, taken));
    try {
      file.delete();
    } catch {
      // Taken again next time; the merge keeps each share once.
    }
    return items;
  },
  get(id: string | undefined): SharedItem | undefined {
    return id ? items.find((s) => s.id === id) : undefined;
  },
  /** Done with: added, cancelled from its screen, or dismissed on Today. */
  remove(id: string): void {
    if (items.some((s) => s.id === id)) publish(items.filter((s) => s.id !== id));
  },
  /** Every share waiting, following each change. */
  use(): SharedItem[] {
    const [now, setNow] = useState(items);
    useEffect(() => {
      let live = true;
      listeners.add(setNow);
      load().then(() => { if (live) setNow(items); });
      return () => { live = false; listeners.delete(setNow); };
    }, []);
    return now;
  },
};
