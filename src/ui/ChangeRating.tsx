import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { RatingValue } from '../core/scheduler';
import { haptic } from './haptics';
import { Tappable } from './kit';
import { radius, smooth, type, useTheme } from './theme';

/**
 * The last answer, as one line above the answer buttons: what it was and for which word ("Good · 24d · kot") and three
 * icon buttons, Undo, Undo with a check (change it to Good) and Undo with an X (change it to
 * Again). It stays until the next answer replaces it. A tap on one of the buttons is confirmed in the
 * line's place for a moment ("Changed to Good") with its own haptic, since the line otherwise looks
 * the same afterward. Review does the changes (an undo and an answer in one step); this never reaches
 * the scheduler itself, it only offers the taps.
 */

export interface LastAnswer {
  cardId: string;
  rating: RatingValue;
  /** The interval the answer gave, as the button showed it ("4d"). */
  interval?: string;
  /** The card's word (`headword`), so the line says which card it's about. */
  word?: string;
}

const NAMES: Record<RatingValue, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

/** What a tap on one of the line's buttons did, said for a moment in the line's place. */
export type AnswerNotice = 'undone' | 'good' | 'again';

const NOTICE_MS = 1500;

/** The line's state. `show(null)` takes it away. `announce` says what a button just did, then clears itself. */
export function useLastAnswer() {
  const [last, show] = useState<LastAnswer | null>(null);
  const [notice, setNotice] = useState<AnswerNotice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = useCallback((what: AnswerNotice) => {
    clearTimeout(timer.current);
    setNotice(what);
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { last, show, notice, announce };
}

/** The haptic that goes with each button: a tick for Undo, success for Good, a warning for Again. */
export function buttonHaptic(to?: RatingValue) {
  if (to === 3) haptic.success();
  else if (to === 1) haptic.warning();
  else haptic.select();
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
export function LastAnswerLine({ last, notice, onUndo, onChange }: { last: LastAnswer | null; notice: AnswerNotice | null; onUndo: () => void; onChange: (to: RatingValue) => void }) {
  const c = useTheme();
  const name = last ? NAMES[last.rating] : '';
  const button = { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.m, ...smooth } as const;
  const said = notice === 'good' ? { text: 'Changed to Good', color: c.goodInk, badge: { kind: 'check', color: c.goodInk } as const }
    : notice === 'again' ? { text: 'Changed to Again', color: c.danger, badge: { kind: 'x', color: c.danger } as const }
    : notice === 'undone' ? { text: 'Answer undone', color: c.text, badge: undefined }
    : null;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
      {said ? (
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <UndoIcon color={said.color} cutout={c.bg} badge={said.badge} />
          <Text numberOfLines={1} style={{ flexShrink: 1, ...type.footnote, fontWeight: '600', color: said.color }}>{said.text}</Text>
        </View>
      ) : last ? (
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, ...type.footnote, color: c.textSecondary }}>
          Last answer: <Text style={{ fontWeight: '600', color: c.text }}>{[name, last.interval, last.word].filter(Boolean).join(' · ')}</Text>
        </Text>
      ) : null}
      {last ? (
        <>
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
        </>
      ) : null}
    </View>
  );
}
