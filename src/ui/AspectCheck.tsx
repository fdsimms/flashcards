import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ASPECT_MISS_RATING, aspectVerdict, type Aspect } from '../core/aspectCheck';
import { haptic } from './haptics';
import { Tappable } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';

/**
 * Review's aspect check (src/core/aspectCheck.ts): the question above Show answer on a verb's
 * front, and its result above the rating buttons. Optional: Show answer works without a pick.
 * `showing` is Review's key for the card on screen, so a card shown again starts unanswered.
 */
export function useAspectCheck(showing: string | undefined, aspect: Aspect | undefined) {
  const [state, setState] = useState<{ key: string; pick: Aspect } | null>(null);
  const pick = state && state.key === showing ? state.pick : undefined;
  const verdict = aspect && pick ? aspectVerdict(aspect, pick) : undefined;
  return {
    aspect,
    pick,
    verdict,
    /** Hard, outlined after a wrong pick. */
    suggested: verdict && !verdict.right ? ASPECT_MISS_RATING : undefined,
    choose: (p: Aspect) => { if (showing && !pick) { haptic.select(); setState({ key: showing, pick: p }); } },
  };
}

const CHOICES: { value: Aspect; label: string }[] = [
  { value: 'imperfective', label: 'Imperfective' },
  { value: 'perfective', label: 'Perfective' },
];

export function AspectQuestion({ check }: { check: ReturnType<typeof useAspectCheck> }) {
  const c = useTheme();
  const { aspect, pick, verdict } = check;
  if (!aspect) return null;
  return (
    <View style={{ gap: space.s }}>
      <Text style={{ ...type.callout, color: c.textSecondary, textAlign: 'center' }}>Imperfective or perfective?</Text>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        {CHOICES.map((o) => {
          const mark = pick === o.value ? (o.value === aspect ? 'right' : 'wrong') : undefined;
          const color = mark === 'right' ? c.goodInk : mark === 'wrong' ? c.warningInk : c.text;
          return (
            <Tappable
              key={o.value}
              onPress={() => check.choose(o.value)}
              disabled={!!pick}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: pick === o.value, disabled: !!pick }}
              style={{
                flex: 1, minHeight: 44, borderRadius: radius.m, ...smooth, alignItems: 'center', justifyContent: 'center',
                backgroundColor: c.fill, borderWidth: mark ? 2 : 1, borderColor: mark ? color : c.controlEdge,
              }}
            >
              <Text style={{ ...type.body, color }}>{o.label}</Text>
            </Tappable>
          );
        })}
      </View>
      {verdict ? <Text style={{ ...type.footnote, color: verdict.right ? c.goodInk : c.warningInk, textAlign: 'center' }}>{verdict.text}</Text> : null}
    </View>
  );
}

/** The pick's result above the rating buttons, once the answer is shown. */
export function AspectResult({ check }: { check: ReturnType<typeof useAspectCheck> }) {
  const c = useTheme();
  if (!check.verdict) return null;
  return <Text style={{ ...type.footnote, color: check.verdict.right ? c.goodInk : c.warningInk, textAlign: 'center' }}>{check.verdict.text}</Text>;
}
