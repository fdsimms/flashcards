import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/** What an answer's numbered senses do in Review (useSenseMarks). Numbers count from 1. */
export interface SenseMarking {
  /** The senses tapped as missed on this answer. */
  marked: ReadonlySet<number>;
  /** The senses the card's latest answer marked. */
  last: readonly number[];
  onToggle: (sense: number) => void;
}

/**
 * A numbered Meaning on the answer, each sense a row to tap when it wasn't recalled (src/core/senseMarks.ts).
 * A tapped sense says "Missed"; one missed last time is tinted and says so until it is tapped. `size` is the
 * meaning's own text style, so the rows read as the Meaning they stand in for.
 */
export function MarkableSenses({ senses, marking, size }: { senses: string[]; marking: SenseMarking; size: { fontSize: number; lineHeight?: number } }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      {senses.map((sense, k) => {
        const n = k + 1;
        const on = marking.marked.has(n);
        const before = !on && marking.last.includes(n);
        return (
          <Tappable
            key={n}
            onPress={() => { haptic.select(); marking.onToggle(n); }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Sense ${n}: ${sense}${on ? ', marked as missed' : before ? ', missed last time' : ''}`}
            accessibilityHint={on ? 'Tap to take the mark off' : 'Tap if you missed this sense'}
            scaleTo={0.98}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP, paddingHorizontal: space.m, paddingVertical: space.xs,
              borderRadius: radius.m, ...smooth, backgroundColor: on ? c.dangerFill : before ? c.accentFill : 'transparent',
            }}
          >
            <Text style={{ ...size, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{n}.</Text>
            <Text style={{ ...size, color: c.text, flex: 1, minWidth: 0 }}>{sense}</Text>
            {on ? <Text style={{ ...type.caption, fontWeight: '600', color: c.danger }}>Missed</Text>
              : before ? <Text style={{ ...type.caption, fontWeight: '600', color: c.accentInk }}>Missed last time</Text> : null}
          </Tappable>
        );
      })}
      {marking.marked.size || marking.last.length ? null : (
        <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>Tap a sense you missed.</Text>
      )}
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
