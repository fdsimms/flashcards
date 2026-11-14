import { useEffect, useState } from 'react';
import type { DeckRow } from '../core/deckTree';
import { answersFrom, type Answer } from '../core/stats';
import { SUMMARY_LOOKBACK_DAYS, todaySummary } from '../core/todaySummary';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';

/**
 * The deck list's "Studied today" line (src/core/todaySummary.ts), read again whenever the deck
 * list is recounted (after a study session, a sync, coming back to the screen), so it follows the
 * counts above it. WaniKani's answers given here count with the rest, as they do on Stats.
 * Undefined until the first read, and when it fails: the line is only a convenience.
 */
export function useTodaySummary(repo: Repo & AnkiLink, decks: DeckRow[], wanikani: Answer[]): string | undefined {
  const [text, setText] = useState<string>();
  useEffect(() => {
    let live = true;
    (async () => {
      const now = new Date();
      const { dayStartsAtHour } = await repo.collectionSettings();
      const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - SUMMARY_LOOKBACK_DAYS);
      const [cards, reviews, revlog] = await Promise.all([repo.listCards(), repo.listReviews(since), repo.ankiReviewLog(since)]);
      const answers = [...answersFrom({ revlog, reviews, cards }), ...wanikani];
      if (live) setText(todaySummary(answers, now, dayStartsAtHour).text ?? undefined);
    })().catch(() => {});
    return () => { live = false; };
  }, [repo, decks, wanikani]);
  return text;
}
