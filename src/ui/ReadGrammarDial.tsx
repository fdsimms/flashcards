import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError, type Api, type GrammarList } from '../reader/api';
import { grammarStepNote, hasPracticeRoom, stepGrammarUses, type GrammarStep } from '../reader/shelf';
import { haptic } from './haptics';
import { Button, ErrorNote, Help, Segments } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';

/**
 * The Grammar row of the end view's "For the next ones" card, beside Length: Simpler or Harder
 * changes how many times the texts written from now on may use grammar not marked yet. Harder
 * also suggests the easiest point not yet practiced or known, set to Practice on a tap (the
 * owner's approval; nothing here grades a card). Steps from the allowance as it was when the end
 * view opened, as Length does, and shows nothing when the server can't be reached or is older
 * than the dial.
 */
export function ReadGrammarDial({ api }: { api: Api }) {
  const c = useTheme();
  const [list, setList] = useState<GrammarList | null>(null);
  const base = useRef<number | null>(null);
  const [step, setStep] = useState<GrammarStep>('same');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The point just set to Practice, named in place of the suggestion.
  const [practicing, setPracticing] = useState<string | null>(null);
  // A later tap's answer is the one to keep, so an earlier one that comes back last is dropped.
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    api.grammar().then((l) => {
      if (!alive) return;
      base.current = l.stretch?.uses ?? null;
      setList(l);
    }).catch(() => undefined);
    return () => { alive = false; };
    // Once, when the end view opens: `base` is the allowance as it was then.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stretch = list?.stretch;
  if (!list || !stretch || base.current === null) return null;
  const from = base.current;

  const choose = async (next: GrammarStep) => {
    const before = step;
    const mine = ++seq.current;
    setStep(next);
    setError(null);
    try {
      const updated = await api.setGrammarStretch(stepGrammarUses(from, next));
      if (mine === seq.current) setList(updated);
    } catch (e) {
      if (mine !== seq.current) return;
      setStep(before);
      setError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
    }
  };

  const practice = async () => {
    const point = stretch.next;
    if (!point || busy) return;
    setBusy(true);
    setError(null);
    try {
      setList(await api.setGrammar(point.id, 'practice'));
      setPracticing(point.name);
      haptic.select();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't set that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const note = grammarStepNote(from, stepGrammarUses(from, step), step);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>Grammar</Text>
      <Segments<GrammarStep>
        options={[{ value: 'simpler', label: 'Simpler' }, { value: 'same', label: 'Same' }, { value: 'harder', label: 'Harder' }]}
        value={step}
        onChange={choose}
      />
      {note ? <Help>{note}</Help> : null}
      {step === 'harder' && practicing ? (
        <Help>{`${practicing} will be practiced in the next texts. Change it on the Grammar screen.`}</Help>
      ) : step === 'harder' && stretch.next ? (
        <View style={{ backgroundColor: c.fill, borderRadius: radius.m, padding: space.m, gap: space.s, marginTop: space.xs, ...smooth }}>
          <Text style={{ ...type.subhead, color: c.text }}>
            {'Suggested to practice: '}
            <Text style={{ fontWeight: '600' }}>{stretch.next.name}</Text>
          </Text>
          {hasPracticeRoom(list) ? (
            <Button label="Practice it" onPress={practice} busy={busy} />
          ) : (
            <Help>{`${list.max_practice} points are already being practiced. Set one to Know it on the Grammar screen first.`}</Help>
          )}
        </View>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
    </View>
  );
}
