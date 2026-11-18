import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { RatingValue } from '../core/scheduler';
import { Tappable } from './kit';
import { radius, smooth, type, useTheme } from './theme';

/**
 * The last answer, as one line above the answer buttons: what it was ("Good · 24d") and three
 * icon buttons, Undo, Undo with a check (change it to Good) and Undo with an X (change it to
 * Again). It stays until the next answer replaces it, so it never needs a timer or an
 * animation. Review does the changes (an undo and an answer in one step); this never reaches
 * the scheduler itself, it only offers the taps.
 */

export interface LastAnswer {
  cardId: string;
  rating: RatingValue;
  /** The interval the answer gave, as the button showed it ("4d"). */
  interval?: string;
}

const NAMES: Record<RatingValue, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

/** The line's state. `show(null)` takes it away. */
export function useLastAnswer() {
  const [last, show] = useState<LastAnswer | null>(null);
  return { last, show };
}

/** The undo arrow, with a check or an X badge in a cutout at its lower right. SF Symbols has neither, so it's drawn. */
function UndoIcon({ badge, color, cutout }: { badge?: { kind: 'check' | 'x'; color: string }; color: string; cutout: string }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M8 13 3 8l5-5" stroke={color} />
      <Path d="M3 8h9a5 5 0 0 1 5 5" stroke={color} />
      {badge ? <Circle cx={17.5} cy={17.5} r={5.8} fill={cutout} /> : null}
      {badge?.kind === 'check' ? <Path d="M14.6 17.6l2 2 3.8-4.2" stroke={badge.color} /> : null}
      {badge?.kind === 'x' ? <Path d="M15.1 15.1l4.8 4.8M19.9 15.1l-4.8 4.8" stroke={badge.color} /> : null}
    </Svg>
  );
}

/**
 * Put at the top of Review's footer. A change to the rating the answer already has isn't offered:
 * no check after Good, no X after Again, so each label below is always true.
 */
export function LastAnswerLine({ last, onUndo, onChange }: { last: LastAnswer; onUndo: () => void; onChange: (to: RatingValue) => void }) {
  const c = useTheme();
  const name = NAMES[last.rating];
  const button = { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.m, ...smooth } as const;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, ...type.footnote, color: c.textSecondary }}>
        Last answer: <Text style={{ fontWeight: '600', color: c.text }}>{name}{last.interval ? ` · ${last.interval}` : ''}</Text>
      </Text>
      <Tappable onPress={onUndo} accessibilityRole="button" accessibilityLabel="Undo the last answer" scaleTo={0.9} style={button}>
        <UndoIcon color={c.textSecondary} cutout={c.bg} />
      </Tappable>
      {last.rating !== 3 ? (
        <Tappable onPress={() => onChange(3)} accessibilityRole="button" accessibilityLabel={`Change ${name} to Good`} scaleTo={0.9} style={button}>
          <UndoIcon color={c.textSecondary} cutout={c.bg} badge={{ kind: 'check', color: c.goodInk }} />
        </Tappable>
      ) : null}
      {last.rating !== 1 ? (
        <Tappable onPress={() => onChange(1)} accessibilityRole="button" accessibilityLabel={`Change ${name} to Again`} scaleTo={0.9} style={button}>
          <UndoIcon color={c.textSecondary} cutout={c.bg} badge={{ kind: 'x', color: c.danger }} />
        </Tappable>
      ) : null}
    </View>
  );
}
