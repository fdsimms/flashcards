import { useCallback, useEffect, useRef, useState } from 'react';
import type { WaniKaniApi, WaniKaniUser } from '../wanikani/api';
import { hourlyForecast, levelProgress, type WaniKaniStats } from '../wanikani/stats';
import { loadStats, saveStats } from '../wanikani/storage';

/** The stats are read again at most this often, unless a screen asks for them. */
const STATS_EVERY_MS = 5 * 60_000;

/**
 * WaniKani's stage counts, the level's progress and the reviews coming up, for the row's stage bar
 * and the stats screen. Called in one line by `useWaniKani`, which hands it the counts it has just
 * read. A read that fails leaves the last one (kept on the phone) standing.
 */
export function useWaniKaniStats(api: WaniKaniApi | null) {
  const [stats, setStats] = useState<WaniKaniStats | null>(null);
  const last = useRef(0);
  const reading = useRef(false);
  // The api a read began with: one begun before sign-out or a new token must not write what it read.
  const current = useRef(api);
  current.current = api;

  useEffect(() => {
    if (!api) {
      setStats(null);
      last.current = 0;
      return;
    }
    loadStats().then((s) => { if (current.current === api) setStats((now) => now ?? s); });
  }, [api]);

  const read = useCallback(async (user: WaniKaniUser, apprentice: number, force = false) => {
    if (!api || reading.current) return;
    if (!force && Date.now() - last.current < STATS_EVERY_MS) return;
    reading.current = true;
    last.current = Date.now();
    try {
      const [stages, kanji, batches] = await Promise.all([api.stageCounts(user.maxLevel), api.levelKanji(user.level), api.upcomingReviews()]);
      if (current.current !== api) return;
      const now = new Date();
      const next: WaniKaniStats = {
        savedAt: now.toISOString(),
        level: user.level,
        stages: { apprentice, ...stages },
        progress: levelProgress(user.level, kanji.total, kanji.passed),
        forecast: hourlyForecast(batches, now),
      };
      setStats(next);
      saveStats(next);
    } catch {
      // Not reached: the last read stays, and the next refresh tries again.
      last.current = 0;
    } finally {
      reading.current = false;
    }
  }, [api]);

  return { stats, readStats: read };
}
