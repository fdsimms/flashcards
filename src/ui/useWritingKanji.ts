import { useEffect, useState } from 'react';
import type { WritingItem } from '../tools/writing';
import type { WaniKaniApi } from '../wanikani/api';
import { loadWritingKanji, saveWritingKanji } from '../wanikani/storage';
import { buildWritingKanji, kanjiItems, writingKanjiStale, type WritingKanji } from '../wanikani/writingKanji';
import { useApp } from './AppContext';

/** Kept for the session so opening the tool again doesn't read the file or ask WaniKani again, and one request serves every caller at once. */
let kept: { data: WritingKanji; items: WritingItem[] } | null = null;
let inflight: Promise<WritingItem[]> | null = null;

async function ensure(api: WaniKaniApi, level: number, dayStartsAtHour: number): Promise<WritingItem[]> {
  if (kept && !writingKanjiStale(kept.data, level, new Date(), dayStartsAtHour)) return kept.items;
  inflight ??= (async () => {
    const copy = kept?.data ?? await loadWritingKanji();
    const use = (data: WritingKanji) => { kept = { data, items: kanjiItems(data) }; return kept.items; };
    if (copy && !writingKanjiStale(copy, level, new Date(), dayStartsAtHour)) return use(copy);
    try {
      const fresh = buildWritingKanji(await api.kanji(), level, new Date());
      saveWritingKanji(fresh);
      return use(fresh);
    } catch {
      // WaniKani out of reach: the last copy stands, and it's tried again next time.
      return copy ? use(copy) : [];
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

/**
 * The kanji Writing by hand asks for (writingKanji.ts): those in the WaniKani levels reached. Empty
 * until read, and while no token is entered. Read from WaniKani once a study day, the copy on the
 * phone in between and offline.
 */
export function useWritingKanji(): WritingItem[] {
  const { repo, wanikani } = useApp();
  const { api, user } = wanikani;
  const level = user ? Math.min(user.level, user.maxLevel) : undefined;
  const [items, setItems] = useState<WritingItem[]>(() => (api && level !== undefined && kept?.data.level === level ? kept.items : []));
  useEffect(() => {
    if (!repo || !api || level === undefined) { setItems([]); return; }
    let stale = false;
    repo.collectionSettings()
      .then((s) => ensure(api, level, s.dayStartsAtHour))
      .then((k) => { if (!stale) setItems(k); })
      .catch(() => undefined);
    return () => { stale = true; };
  }, [repo, api, level]);
  return items;
}
