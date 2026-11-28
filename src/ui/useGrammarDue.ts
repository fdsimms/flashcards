import { useCallback, useState } from 'react';
import { studyDayKey } from '../core/day';
import { grammarPointsFor } from '../core/grammar';
import { dueByLanguage } from '../core/grammarDrills';
import type { Repo } from '../db/repo';
import type { Api } from '../reader/api';
import type { GrammarDue } from '../reader/grammarDueCopy';
import { LANGUAGE_ORDER } from '../reader/languages';
import { loadGrammarDueCopy, saveGrammarDueCopy } from '../reader/storage';
import { useReadWhileShown } from './useReadWhileShown';

export type { GrammarDue };

/**
 * The grammar points due today (src/core/grammarDrills.ts, `duePoints`), for the Practice tab's Grammar row
 * and Today's extras. Read from Read & Listen's choices and the phone's answers each time the screen
 * comes into view or the app comes back to it, since both change elsewhere and the day can turn.
 * Null with Read & Listen off, or until known: nothing is said about grammar then, rather than a
 * guess. After a failed request it keeps what it had, the phone's copy from earlier today if any.
 */
export function useGrammarDue(readerApi: Api | null, repo: Repo): GrammarDue | null {
  return useGrammarDueState(readerApi, repo).due;
}

/**
 * `useGrammarDue` with whether it's known yet: `settled` once the answer for today is in hand, from
 * the phone's copy of the last one (src/reader/grammarDueCopy.ts) or the server, or once it's clear
 * there's none (Read & Listen off, a request that failed with no copy). Today waits for it, so its
 * grammar chips are there when it shows rather than arriving after the server answers. The copy
 * stands in until the server does, which then replaces it.
 */
export function useGrammarDueState(readerApi: Api | null, repo: Repo): { due: GrammarDue | null; settled: boolean } {
  const [due, setDue] = useState<GrammarDue | null>(null);
  const [settled, setSettled] = useState(false);
  useReadWhileShown(useCallback(() => {
    if (!readerApi) { setDue(null); setSettled(true); return; }
    let live = true;
    const languages = LANGUAGE_ORDER.filter((l) => grammarPointsFor(l).length > 0);
    const settings = repo.collectionSettings();
    // The copy first, unless the server has already answered.
    let answered = false;
    settings
      .then(({ dayStartsAtHour }) => loadGrammarDueCopy(studyDayKey(new Date(), dayStartsAtHour)))
      .then((copy) => { if (live && !answered && copy) setDue(copy); })
      .catch(() => undefined)
      .finally(() => { if (live) setSettled(true); });
    Promise.all([readerApi.grammarChoices(), repo.listGrammarAnswers(), settings])
      .then(([{ choices, defaults }, answers, { dayStartsAtHour }]) => {
        if (!live) return;
        const now = new Date();
        const byLanguage = dueByLanguage(languages, choices, answers, now, dayStartsAtHour, defaults) as GrammarDue['languages'];
        const fresh = { total: byLanguage.reduce((n, d) => n + d.count, 0), languages: byLanguage };
        answered = true;
        setDue(fresh);
        setSettled(true);
        saveGrammarDueCopy(fresh, studyDayKey(now, dayStartsAtHour));
      })
      .catch(() => { if (live) { answered = true; setSettled(true); } });
    return () => { live = false; };
  }, [readerApi, repo]));
  return { due, settled };
}
