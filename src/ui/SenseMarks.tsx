import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, hairline, radius, smooth, space, type, useTheme } from './theme';

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
 * (src/core/senseMarks.ts). Only an X is kept; a sense left alone counts as recalled. When the card comes back after a miss, the senses it recalled start checked. One missed last time is
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
            <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
              <Text style={{ ...size, color: c.text }}>{sense}</Text>
              {before ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                  <Icon name="exclamationmark.circle.fill" size={13} color={c.accentInk} />
                  <Text style={{ ...type.caption, fontWeight: '600', color: c.accentInk }}>Missed last time</Text>
                </View>
              ) : null}
            </View>
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
 * Under the card's front when its last answer marked a sense: one card saying how many senses there
 * are and how many were missed, never which. The dots count them the same way (a check per sense got,
 * a dashed "?" per sense missed, in that order whichever it was). "Show the ones you got" lists the
 * others, for when it's not clear which one is missing; each card's line starts closed (Review keys it
 * by card).
 */
export function SenseReminder({ text, title, detail, got, missed }: { text: string; title: string; detail: string; got: string[]; missed: number }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const dot = { width: 24, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={{ alignSelf: 'stretch', borderRadius: radius.l, ...smooth, backgroundColor: c.warningFill, paddingHorizontal: space.l, paddingVertical: space.m, gap: space.s }}>
      <View accessible accessibilityLabel={text} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <Icon name="exclamationmark.circle.fill" size={30} color={c.warning} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...type.callout, color: c.warningInk, fontWeight: '600' }}>{title}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space.xs + 2 }}>
          {got.map((_, k) => (
            <View key={`got${k}`} style={{ ...dot, backgroundColor: c.good }}>
              <Icon name="checkmark" size={12} weight="bold" color={c.onRating} />
            </View>
          ))}
          {Array.from({ length: missed }, (_, k) => (
            <View key={`miss${k}`} style={{ ...dot, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.warning }}>
              <Text style={{ ...type.caption, fontWeight: '700', color: c.warningInk }}>?</Text>
            </View>
          ))}
        </View>
      </View>
      {got.length ? (
        <View style={{ borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.xs, gap: space.s }}>
          <Tappable
            onPress={() => { haptic.select(); setOpen(!open); }}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? 'Hide the ones you got' : 'Show the ones you got'}
            style={{ minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={open ? { ...type.overline, color: c.textSecondary } : { ...type.subhead, fontWeight: '600', color: c.accentInk }}>{open ? 'You got' : 'Show the ones you got'}</Text>
            <Icon name={open ? 'chevron.up' : 'chevron.down'} size={13} weight="semibold" color={open ? c.textSecondary : c.accentInk} />
          </Tappable>
          {open ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingBottom: space.xs }}>
              {got.map((sense, k) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, borderRadius: radius.m, ...smooth, backgroundColor: c.goodFill, paddingHorizontal: space.m, paddingVertical: space.s, maxWidth: '100%' }}>
                  <Icon name="checkmark" size={13} weight="bold" color={c.goodInk} />
                  <Text style={{ ...type.callout, color: c.text, flexShrink: 1 }}>{sense}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
