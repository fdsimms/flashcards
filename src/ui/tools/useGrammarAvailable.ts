import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { anyDrilled } from '../../core/grammarDrills';
import type { Api } from '../../reader/api';
import { grammarPointsFor } from '../../core/grammar';
import { LANGUAGE_ORDER } from '../../reader/languages';

/**
 * Whether the Grammar tool has anything to drill: Read & Listen is on and a point in some language is
 * set to Practice or Know it. Checked each time the Practice tab comes into view, since the choices
 * are made on another tab. Null until known, and after a failed request: the tool opens then and
 * explains itself, rather than a row being disabled on a guess.
 */
export function useGrammarAvailable(readerApi: Api | null): { available: boolean | null; reason: string | null } {
  const [drilled, setDrilled] = useState<boolean | null>(null);

  useFocusEffect(useCallback(() => {
    if (!readerApi) { setDrilled(null); return; }
    let live = true;
    const languages = LANGUAGE_ORDER.filter((l) => grammarPointsFor(l).length > 0);
    readerApi.grammarChoices()
      .then(({ choices }) => { if (live) setDrilled(anyDrilled(languages, choices)); })
      .catch(() => { if (live) setDrilled(null); });
    return () => { live = false; };
  }, [readerApi]));

  if (!readerApi) return { available: false, reason: 'Turn on Read & Listen in Settings first.' };
  if (drilled === false) return { available: false, reason: 'Set a grammar point to Practice or Know it on Read & Listen\'s Grammar screen first.' };
  return { available: drilled === null ? null : true, reason: null };
}
