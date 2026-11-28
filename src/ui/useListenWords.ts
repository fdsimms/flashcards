import { useCallback, useEffect, useState } from 'react';
import { addCalendarDays } from '../core/day';
import { pickListenWords, RECENT_DAYS, startedSince, type ListenWord } from '../core/listenWords';
import { useApp } from './AppContext';

/**
 * Your words' words from `deck` (src/core/listenWords.ts), read from the collection on the phone, so
 * a word answered a minute ago counts. Null while reading, or with no deck. Reads only.
 */
export function useListenWords(deck: string | null | undefined, count: number): { words: ListenWord[] | null; reload: () => void } {
  const { repo } = useApp();
  const [words, setWords] = useState<ListenWord[] | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!deck) { setWords(null); return; }
    let live = true;
    const now = new Date();
    const since = addCalendarDays(now, -RECENT_DAYS);
    Promise.all([repo.listNotes(), repo.listCards(), repo.listReviews(since), repo.collectionSettings()]).then(([notes, cards, reviews, settings]) => {
      if (!live) return;
      setWords(pickListenWords({ notes, cards, started: startedSince(reviews, since), deck, now, dayStartsAtHour: settings.dayStartsAtHour, count }));
    }, () => { if (live) setWords([]); });
    return () => { live = false; };
  }, [repo, deck, count, asked]);
  const reload = useCallback(() => setAsked((n) => n + 1), []);
  return { words, reload };
}
