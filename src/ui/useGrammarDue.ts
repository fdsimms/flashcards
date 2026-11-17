import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { grammarPointsFor } from '../core/grammar';
import { dueByLanguage } from '../core/grammarDrills';
import type { Repo } from '../db/repo';
import type { Api, Language } from '../reader/api';
import { LANGUAGE_ORDER } from '../reader/languages';

/** Grammar due today: in each language with some, most first, and in all. */
export interface GrammarDue {
  total: number;
  languages: { language: Language; count: number }[];
}

/**
 * The grammar points due today (src/core/grammarDrills.ts, `duePoints`), for the Practice tab's Grammar row
 * and Today's extras. Read from Read & Listen's choices and the phone's answers each time the screen
 * comes into view, since both change elsewhere. Null with Read & Listen off, or until known and after a
 * failed request: nothing is said about grammar then, rather than a guess.
 */
export function useGrammarDue(readerApi: Api | null, repo: Repo): GrammarDue | null {
  const [due, setDue] = useState<GrammarDue | null>(null);
  useFocusEffect(useCallback(() => {
    if (!readerApi) { setDue(null); return; }
    let live = true;
    const languages = LANGUAGE_ORDER.filter((l) => grammarPointsFor(l).length > 0);
    Promise.all([readerApi.grammarChoices(), repo.listGrammarAnswers(), repo.collectionSettings()])
      .then(([{ choices }, answers, settings]) => {
        if (!live) return;
        const byLanguage = dueByLanguage(languages, choices, answers, new Date(), settings.dayStartsAtHour) as GrammarDue['languages'];
        setDue({ total: byLanguage.reduce((n, d) => n + d.count, 0), languages: byLanguage });
      })
      .catch(() => { if (live) setDue(null); });
    return () => { live = false; };
  }, [readerApi, repo]));
  return due;
}
