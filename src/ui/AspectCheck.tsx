import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ASPECT_MISS_RATING, aspectVerdict, type Aspect } from '../core/aspectCheck';
import { haptic } from './haptics';
import { answerLook, Tappable } from './kit';
import { MIN_TAP, hairline, space, type, useTheme } from './theme';

/**
 * Review's aspect check (src/core/aspectCheck.ts): the question and its two buttons in their own band
 * along the bottom of the verb's card, under a divider. Optional: Show answer works without a pick.
 * Nothing here may live in Review's footer: the footer keeps the tallest height it has shown for
 * the whole session (ReviewFooter.tsx), so a question there shrank every later card.
 *
 * Rule for any check run inside a Review card (this, a skill card's drill): it may only outline a
 * rating (`suggested`), never rate. Nothing feeds FSRS but the answer button the learner presses.
 * `showing` is Review's key for the card on screen, so a card shown again starts unanswered.
 */
export function useAspectCheck(showing: string | undefined, aspect: Aspect | undefined) {
  const [state, setState] = useState<{ key: string; pick: Aspect } | null>(null);
  const pick = state && state.key === showing ? state.pick : undefined;
  const verdict = aspect && pick ? aspectVerdict(aspect, pick) : undefined;
  // How tall the band is while it shows (0 while it doesn't), so Review can lift the Play button clear of it.
  const [bandHeight, setBandHeight] = useState(0);
  return {
    aspect,
    bandHeight,
    setBandHeight,
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

/**
 * The question and its buttons, as a band for the foot of the card (Review puts it under the card's
 * scroll area). A right pick turns its button green; a wrong one turns red and the
 * right one is outlined green, so no line of text is needed (VoiceOver gets it as the button's label).
 * Once the answer is shown it stays on the front with the result, and is left out if nothing was picked.
 */
export function AspectQuestion({ check, revealed }: { check: ReturnType<typeof useAspectCheck>; revealed: boolean }) {
  const c = useTheme();
  const { aspect, pick, verdict, setBandHeight } = check;
  const shown = !!aspect && !(revealed && !pick);
  useEffect(() => { if (!shown) setBandHeight(0); }, [shown, setBandHeight]);
  if (!shown) return null;
  return (
    <View onLayout={(e) => setBandHeight(Math.ceil(e.nativeEvent.layout.height))} style={{ gap: space.s, alignSelf: 'stretch', padding: space.m, borderTopWidth: hairline, borderTopColor: c.border, backgroundColor: c.fill }}>
      <Text style={{ ...type.footnote, fontWeight: '600', color: c.accentInk, textAlign: 'center' }}>Imperfective or perfective?</Text>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        {CHOICES.map((o) => {
          const mark = !pick ? 'open' : o.value === aspect ? 'right' : o.value === pick ? 'wrong' : 'open';
          return (
            <Tappable
              key={o.value}
              onPress={() => check.choose(o.value)}
              disabled={!!pick}
              accessibilityRole="button"
              accessibilityLabel={pick && o.value === pick && verdict ? `${o.label}. ${verdict.text}` : o.label}
              accessibilityState={{ selected: pick === o.value, disabled: !!pick }}
              style={{ flex: 1, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', ...answerLook(c, mark) }}
            >
              <Text style={{ ...type.body, color: c.text, fontWeight: mark === 'right' ? '600' : '400' }}>{o.label}</Text>
            </Tappable>
          );
        })}
      </View>
    </View>
  );
}
