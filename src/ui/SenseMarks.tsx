import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/** What the learner said about one sense on this answer. A sense with no verdict counts as recalled (nothing is kept for it). */
export type SenseVerdict = 'got' | 'missed';

/** What an answer's numbered senses do in Review (useSenseMarks). Numbers count from 1. */
export interface SenseMarking {
  /** The verdicts tapped on this answer. Only 'missed' is kept with the answer. */
  verdicts: ReadonlyMap<number, SenseVerdict>;
  /** The senses the card's latest answer marked. */
  last: readonly number[];
  /** Sets a sense's verdict, or takes it off when it is already that one. */
  onMark: (sense: number, verdict: SenseVerdict) => void;
}

/**
 * A numbered Meaning on the answer, each sense a row with a check and an X to say whether it was recalled
 * (src/core/senseMarks.ts). Only an X is kept; a sense left alone counts as recalled. One missed last time is
 * tinted and says so until it is given a verdict. `size` is the meaning's own text style, so the rows read as
 * the Meaning they stand in for.
 */
export function MarkableSenses({ senses, marking, size }: { senses: string[]; marking: SenseMarking; size: { fontSize: number; lineHeight?: number } }) {
  const c = useTheme();
  const verdictButton = (n: number, sense: string, verdict: SenseVerdict, current: SenseVerdict | undefined) => {
    const on = current === verdict;
    const fill = verdict === 'got' ? c.good : c.danger;
    return (
      <Tappable
        onPress={() => { haptic.select(); marking.onMark(n, verdict); }}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`Sense ${n}: ${sense}, ${verdict === 'got' ? 'recalled' : 'missed'}`}
        accessibilityHint={on ? 'Tap to take this off' : verdict === 'got' ? 'Tap if you recalled this sense' : 'Tap if you missed this sense'}
        scaleTo={0.9}
        style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 30, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: on ? fill : c.controlEdge, backgroundColor: on ? fill : 'transparent' }}>
          <Icon name={verdict === 'got' ? 'checkmark' : 'xmark'} size={15} weight="bold" color={on ? c.bg : c.textSecondary} />
        </View>
      </Tappable>
    );
  };
  return (
    <View style={{ gap: space.xs }}>
      {senses.map((sense, k) => {
        const n = k + 1;
        const verdict = marking.verdicts.get(n);
        const before = !verdict && marking.last.includes(n);
        return (
          <View
            key={n}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP, paddingLeft: space.m, paddingRight: space.xs, paddingVertical: space.xs,
              borderRadius: radius.m, ...smooth, backgroundColor: verdict === 'missed' ? c.dangerFill : verdict === 'got' ? c.goodFill : before ? c.accentFill : 'transparent',
            }}
          >
            <Text style={{ ...size, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{n}.</Text>
            <Text style={{ ...size, color: c.text, flex: 1, minWidth: 0 }}>{sense}</Text>
            {before ? <Text style={{ ...type.caption, fontWeight: '600', color: c.accentInk }}>Missed last time</Text> : null}
            <View style={{ flexDirection: 'row' }}>
              {verdictButton(n, sense, 'got', verdict)}
              {verdictButton(n, sense, 'missed', verdict)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Under the card's front: how many meanings the answer has (senseCountLabel). Not shown with a missed-sense reminder, which says the count itself. */
export function SenseCount({ text }: { text: string }) {
  const c = useTheme();
  return <Text accessibilityLabel={text} style={{ ...type.footnote, fontWeight: '600', color: c.accentInk, textAlign: 'center' }}>{text}</Text>;
}

/**
 * Under the card's front when its last answer marked a sense: how many senses there are and how many
 * were missed, never which. "Show the ones you got" lists the others, for when it's not clear which
 * one is missing; each card's line starts closed (Review keys it by card).
 */
export function SenseReminder({ text, got }: { text: string; got: string[] }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ alignSelf: 'center', alignItems: 'center', gap: space.xs }}>
      <View accessible accessibilityLabel={text} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, borderRadius: radius.m, ...smooth, backgroundColor: c.highlight, paddingHorizontal: space.m, paddingVertical: space.s }}>
        <Icon name="exclamationmark.circle.fill" size={16} color={c.warning} />
        <Text style={{ ...type.callout, color: c.warning, fontWeight: '600', flexShrink: 1 }}>{text}</Text>
      </View>
      {got.length ? (
        open ? (
          <Text style={{ ...type.subhead, lineHeight: 21, color: c.textSecondary, textAlign: 'center' }}>You got: {got.join(', ')}</Text>
        ) : (
          <Tappable onPress={() => { haptic.select(); setOpen(true); }} accessibilityRole="button" style={{ minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.m }}>
            <Text style={{ ...type.subhead, fontWeight: '600', color: c.accentInk }}>Show the ones you got</Text>
          </Tappable>
        )
      ) : null}
    </View>
  );
}
