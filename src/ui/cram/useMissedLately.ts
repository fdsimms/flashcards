import { useEffect, useState } from 'react';
import { missedLately } from '../../core/cram';
import { answersFrom, calendarStart } from '../../core/stats';
import { RECENT_DAYS, troubleCards } from '../../core/trouble';
import { reviewWrites } from '../../core/writeQueue';
import type { Language } from '../../reader/api';
import type { AppRepo } from '../AppContext';

/**
 * The note ids of the words in `language` missed lately, most missed first: Trouble's own "Missed
 * lately" (`troubleCards`), so the cram and Stats, Trouble count the same answers. Read once per
 * language, after Review's answers are written. Empty until it's read, and when it can't be (it's a
 * suggestion, so a failure leaves it out rather than stopping the screen).
 */
export function useMissedLately(repo: AppRepo, language: Language | undefined): string[] {
  const [ids, setIds] = useState<{ language?: Language; ids: string[] }>({ ids: [] });
  useEffect(() => {
    if (!language) return undefined;
    let live = true;
    (async () => {
      await reviewWrites.idle();
      const now = new Date();
      const { dayStartsAtHour } = await repo.collectionSettings();
      const since = calendarStart(now, dayStartsAtHour, RECENT_DAYS);
      const [notes, cards, reviews, revlog] = await Promise.all([repo.listNotes(), repo.listCards(), repo.listReviews(since), repo.ankiReviewLog(since)]);
      const rows = troubleCards({ cards, notes, answers: answersFrom({ revlog, reviews, cards }), deck: null, mode: 'lately', now, dayStartsAtHour });
      if (live) setIds({ language, ids: missedLately(rows, language) });
    })().catch(() => undefined);
    return () => { live = false; };
  }, [repo, language]);
  return ids.language === language ? ids.ids : [];
}
