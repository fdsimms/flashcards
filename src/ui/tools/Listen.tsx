import { useEffect, useRef, useState } from 'react';
import type { Phrase } from '../../tools/phrase';
import { haptic } from '../haptics';

/**
 * Listening, in the Practice tools that have it (Numbers, Telling the time, Counting money): the
 * question is read aloud as it comes up, a large button plays it again (PracticeCard.tsx's
 * ListenPrompt), and the answer (digits typed, a clock set) is checked once. The first check of each question is its mark, so Try again
 * can't count it twice. What's checked, and how, is each tool's own.
 */

/** Reads `phrase` aloud whenever the question (`key`) comes up while `on`, and on a change of language. */
export function useSpeakEach(on: boolean, key: string, language: string, phrase: Phrase | undefined, speak: (p: Phrase) => void) {
  useEffect(() => {
    if (on && phrase) speak(phrase);
    // Once per question and language: `phrase` and `speak` are new objects with them.
  }, [on, key, language]);
}

export interface ListenCheck {
  /** How the check of this question went, or null before it. */
  verdict: { right: boolean } | null;
  /** Records the check (once per question, at the first: `onResult`). */
  check: (right: boolean) => void;
  /** Try again: unchecked, still marked. */
  retry: () => void;
  /** A new question: unchecked and unmarked, even if it's one asked before (a retry). */
  reset: () => void;
}

/** A listening question's check, for the question `key`. `onResult` hears its first check. */
export function useListenCheck(key: string, onResult: (right: boolean) => void): ListenCheck {
  const [checked, setChecked] = useState<{ key: string; right: boolean } | null>(null);
  const resulted = useRef<string | null>(null);
  const verdict = checked?.key === key ? checked : null;
  return {
    verdict,
    check: (right) => {
      if (verdict) return;
      setChecked({ key, right });
      if (resulted.current !== key) {
        resulted.current = key;
        onResult(right);
      }
      haptic.answer();
    },
    retry: () => setChecked(null),
    reset: () => { setChecked(null); resulted.current = null; },
  };
}
