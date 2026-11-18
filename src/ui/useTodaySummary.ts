import { useEffect, useState } from 'react';
import type { DeckRow } from '../core/deckTree';
import { answersFrom, type Answer } from '../core/stats';
import { SUMMARY_LOOKBACK_DAYS, todaySummary } from '../core/todaySummary';
import { reviewWrites } from '../core/writeQueue';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';

/** Today's "Studied today" line, and how many answers it counts (the deck list's progress bar). */
export type StudiedToday = { text: string; answered: number };

/**
 * Today's "Studied today" line (src/core/todaySummary.ts), read again whenever the deck
 * list is recounted (after a study session, a sync, coming back to the screen), so it follows the
 * counts above it. WaniKani's answers given here count with the rest, as they do on Stats.
 * Undefined until the first read, and when it fails: the line is only a convenience. `settled` is
 * whether the first read has finished, either way, so Today can wait for the line instead of
 * growing its card when it arrives.
 */
export function useTodaySummary(repo: Repo & AnkiLink, decks: DeckRow[], wanikani: Answer[]): { studied: StudiedToday | undefined; settled: boolean } {
  const [studied, setStudied] = useState<StudiedToday>();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      // After the answers Review has shown but not yet written, so the line counts them.
      await reviewWrites.idle();
      const now = new Date();
      const { dayStartsAtHour } = await repo.collectionSettings();
      const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - SUMMARY_LOOKBACK_DAYS);
      const [cards, reviews, revlog] = await Promise.all([repo.listCards(), repo.listReviews(since), repo.ankiReviewLog(since)]);
      const answers = [...answersFrom({ revlog, reviews, cards }), ...wanikani];
      const today = todaySummary(answers, now, dayStartsAtHour);
      if (live) setStudied(today.text ? { text: today.text, answered: today.answered } : undefined);
    })().catch(() => {}).finally(() => { if (live) setSettled(true); });
    return () => { live = false; };
  }, [repo, decks, wanikani]);
  return { studied, settled };
}
