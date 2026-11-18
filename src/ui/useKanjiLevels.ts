import { useEffect, useState } from 'react';
import { buildKanjiLevels, kanjiLevelsStale, levelsOf, type KanjiLevels } from '../wanikani/kanjiLevels';
import { loadKanjiLevels, saveKanjiLevels } from '../wanikani/storage';
import type { WaniKaniApi } from '../wanikani/api';
import { useApp } from './AppContext';

/** Kept for the session so each popup doesn't read the file or ask WaniKani again, and one request serves every caller at once. */
let kept: { data: KanjiLevels; levels: ReadonlyMap<string, number> } | null = null;
let inflight: Promise<ReadonlyMap<string, number> | null> | null = null;

async function ensure(api: WaniKaniApi, dayStartsAtHour: number): Promise<ReadonlyMap<string, number> | null> {
  if (kept && !kanjiLevelsStale(kept.data, new Date(), dayStartsAtHour)) return kept.levels;
  inflight ??= (async () => {
    const copy = kept?.data ?? await loadKanjiLevels();
    const use = (data: KanjiLevels) => { kept = { data, levels: levelsOf(data) }; return kept.levels; };
    if (copy && !kanjiLevelsStale(copy, new Date(), dayStartsAtHour)) return use(copy);
    try {
      const fresh = buildKanjiLevels(await api.kanji(), new Date());
      saveKanjiLevels(fresh);
      return use(fresh);
    } catch {
      // WaniKani out of reach: the last copy stands, and it's tried again next time.
      return copy ? use(copy) : null;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

/**
 * Each kanji's WaniKani level, for the tag in the word popup: null until read, and while no token is
 * entered. Read from WaniKani once a study day, the copy on the phone in between and offline.
 */
export function useKanjiLevels(): ReadonlyMap<string, number> | null {
  const { repo, wanikani } = useApp();
  const { api, user } = wanikani;
  const [levels, setLevels] = useState<ReadonlyMap<string, number> | null>(null);
  useEffect(() => {
    if (!repo || !api || !user) { setLevels(null); return; }
    let stale = false;
    repo.collectionSettings()
      .then((s) => ensure(api, s.dayStartsAtHour))
      .then((l) => { if (!stale) setLevels(l); })
      .catch(() => undefined);
    return () => { stale = true; };
  }, [repo, api, user]);
  return levels;
}
