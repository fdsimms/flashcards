import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError, type Api, type DifficultyLevel } from '../../reader/api';
import { levelOf, newWordsStepNote, stepLevel, type NewWordsStep } from '../../reader/difficulty';
import { ErrorNote, Help, Segments } from '../kit';
import { space, type, useTheme } from '../theme';

/**
 * The New words row of the end view's "For the next ones" card, beside Length and Grammar: Fewer or
 * More steps the language's text difficulty (Settings, Read & Listen) one level, which is how many
 * words in a text are outside the deck. Steps from the level as it was when the end view opened,
 * as Length does, and shows nothing when the server can't be reached.
 */
export function ReadNewWordsDial({ api }: { api: Api }) {
  const c = useTheme();
  const base = useRef<DifficultyLevel | null>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<NewWordsStep>('same');
  const [error, setError] = useState<string | null>(null);
  // A later tap's answer is the one to keep, so an earlier one that fails last is dropped.
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    api.progress().then((p) => {
      if (!alive) return;
      base.current = levelOf(p.next.floor);
      setReady(true);
    }).catch(() => undefined);
    return () => { alive = false; };
    // Once, when the end view opens: `base` is the level as it was then.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const from = base.current;
  if (!ready || !from) return null;

  const choose = async (next: NewWordsStep) => {
    const before = step;
    const mine = ++seq.current;
    setStep(next);
    setError(null);
    try {
      await api.setDifficulty(stepLevel(from, next));
    } catch (e) {
      if (mine !== seq.current) return;
      setStep(before);
      setError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
    }
  };

  const note = newWordsStepNote(from, stepLevel(from, step), step);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>New words</Text>
      <Segments<NewWordsStep>
        options={[{ value: 'fewer', label: 'Fewer' }, { value: 'same', label: 'Same' }, { value: 'more', label: 'More' }]}
        value={step}
        onChange={choose}
      />
      {note ? <Help>{note}</Help> : null}
      {error ? <ErrorNote message={error} /> : null}
    </View>
  );
}
