import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Phrase } from '../../tools/phrase';
import { haptic } from '../haptics';
import { Card, Icon, Tappable } from '../kit';
import { Reveal } from '../motion';
import { space, type, useTheme } from '../theme';
import { PlayButton, RuleLine, Status, Ways, type ToolActions } from './ToolScreen';

/**
 * Listening, in the Practice tools that have it (Numbers, Telling the time, Counting money): the
 * question is read aloud as it comes up, a large button plays it again, and the answer (digits
 * typed, a clock set) is checked once. The first check of each question is its mark, so Try again
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
  /** The footer: Randomize and Check, then Next (and Try again after a miss). */
  actions: (o: { canCheck: boolean; onCheck: () => void; onNext: () => void }) => ToolActions;
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
    actions: ({ canCheck, onCheck, onNext }) => {
      if (!verdict) return { secondary: { label: 'Randomize', onPress: onNext }, primary: { label: 'Check', onPress: onCheck, disabled: !canCheck } };
      const next = { label: 'Next', onPress: onNext };
      return verdict.right ? { primary: next } : { secondary: { label: 'Try again', onPress: () => setChecked(null) }, primary: next };
    },
  };
}

/** The question: a large play button, to hear it again, and what to do. */
export function ListenCard({ label, hint, onPlay }: { label: string; hint: string; onPlay: () => void }) {
  const c = useTheme();
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.l }}>
      <Tappable
        onPress={() => { haptic.tap(); onPlay(); }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="speaker.wave.2.fill" size={24} color={c.onAccent} />
      </Tappable>
      <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{hint}</Text>
    </Card>
  );
}

/** What the check came to: right, or what it was; then how it's said, with the rule after a miss. */
export function ListenResult({ right, wrong, saying, rule, last, onPlay }: {
  right: boolean;
  /** After a miss: what it was ("Not quite. It's 14:45."). */
  wrong: string;
  saying: { everyday: Phrase; also: Phrase[] };
  rule: string | undefined;
  /** A last section, such as the formal way to say it. */
  last?: { title: string; phrase: Phrase };
  onPlay: (p: Phrase) => void;
}) {
  const c = useTheme();
  return (
    <Reveal>
      <Card>
        {right ? <Status tone="good">Right.</Status> : <Status tone="bad">{wrong}</Status>}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text selectable style={{ ...type.cardBack, color: c.text }}>{saying.everyday.text}</Text>
            {saying.everyday.roman ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{saying.everyday.roman}</Text> : null}
          </View>
          <PlayButton label="Play the answer" onPress={() => onPlay(saying.everyday)} />
        </View>
        {!right && rule ? <RuleLine rule={rule} /> : null}
        {saying.also.length ? <Ways title="Also said" phrases={saying.also} onPlay={onPlay} /> : null}
        {last ? <Ways title={last.title} phrases={[last.phrase]} onPlay={onPlay} /> : null}
      </Card>
    </Reveal>
  );
}
