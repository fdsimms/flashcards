import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FURIGANA_MODE, type FuriganaMode, type FuriganaSetting } from '../core/furigana';
import type { Repo } from '../db/repo';
import { buildFuriganaData, furiganaStale, kanjiReadingsOf, learnedOf, vocabularyIds, type FuriganaData } from '../wanikani/furigana';
import { loadFuriganaData, saveFuriganaData } from '../wanikani/storage';
import { useApp } from './AppContext';

/**
 * The furigana setting, read each time the screen shows, and WaniKani's data for it: the copy on
 * the phone, read again from WaniKani once a study day while the setting is on and a token is
 * entered. When WaniKani can't be reached the last copy is used, and without one every kanji gets
 * its reading.
 */
export function useFurigana(repo: Repo, dayStartsAtHour: number): FuriganaSetting {
  const [mode, setMode] = useState<FuriganaMode>(DEFAULT_FURIGANA_MODE);
  const [data, setData] = useState<FuriganaData | null>(null);
  const loading = useRef(false);
  useFocusEffect(useCallback(() => { repo.furiganaMode().then(setMode).catch(() => undefined); }, [repo]));

  const { api, user } = useApp().wanikani;
  useEffect(() => {
    if (mode === 'off' || !api || !user || loading.current) return;
    loading.current = true;
    let stale = false;
    (async () => {
      const kept = await loadFuriganaData();
      if (!stale) setData(kept);
      if (!furiganaStale(kept, new Date(), dayStartsAtHour)) return;
      const [kanji, passed] = await Promise.all([api.kanji(), api.passed(user.maxLevel)]);
      const vocabulary = await api.subjects(vocabularyIds(passed));
      const fresh = buildFuriganaData(kanji, passed, vocabulary, new Date());
      saveFuriganaData(fresh);
      if (!stale) setData(fresh);
    })()
      // WaniKani out of reach: the copy already loaded stands, and it's tried again next time.
      .catch(() => undefined)
      .finally(() => { loading.current = false; });
    return () => { stale = true; };
  }, [mode, api, user, dayStartsAtHour]);

  return useMemo(() => ({
    mode,
    learned: data && api ? learnedOf(data) : null,
    ...(data && api ? { readings: kanjiReadingsOf(data) } : {}),
  }), [mode, data, api]);
}
