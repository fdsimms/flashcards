import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { RatingValue } from '../core/scheduler';
import { haptic } from './haptics';
import { Tappable } from './kit';
import { Pop, Reveal } from './motion';
import { radius, smooth, type, useTheme } from './theme';

/**
 * The last answer, as one line above the answer buttons: what it was and for which word ("kot · Good · 24d") and three
 * icon buttons, Undo, Undo with a check (change it to Good) and Undo with an X (change it to
 * Again). It stays until the next answer replaces it. A tap on one of the buttons is confirmed in the
 * line's place for a moment ("Changed to Good") with its own haptic, since the line otherwise looks
 * the same afterward. While a button is held it is tinted in its own color (green for Good, red for
 * Again), and the confirmation is a pill in that tint whose icon springs in. Review does the changes (an undo and an answer in one step); this never reaches
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

/** An `rgba(r, g, b, a)` or `#rrggbb` fill laid over a `#rrggbb` ground, as one opaque color (the undo arrow's cutout has to match what it sits on). */
function flatten(fill: string, ground: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(fill);
  if (!m) return fill;
  const a = Number(m[4]);
  const mix = (i: number, over: number) => Math.round(over * a + parseInt(ground.slice(i, i + 2), 16) * (1 - a));
  return `#${[mix(1, Number(m[1])), mix(3, Number(m[2])), mix(5, Number(m[3]))].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** One of the line's icon buttons. While held it takes a disc of `fill` and draws its arrow in `ink`. */
function LineButton({ onPress, label, badge, ink, fill }: { onPress: () => void; label: string; badge?: { kind: 'check' | 'x'; color: string }; ink: string; fill: string }) {
  const c = useTheme();
  const [held, setHeld] = useState(false);
  return (
    <Tappable
      onPress={onPress}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.9}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.m, backgroundColor: held ? fill : 'transparent', ...smooth }}
    >
      <UndoIcon color={held ? ink : c.textSecondary} cutout={held ? flatten(fill, c.bg) : c.bg} badge={badge} />
    </Tappable>
  );
}

/**
 * Put at the top of Review's footer. A change to the rating the answer already has isn't offered:
 * no check after Good, no X after Again, so each label below is always true.
 */
export function LastAnswerLine({ last, notice, onUndo, onChange }: { last: LastAnswer | null; notice: AnswerNotice | null; onUndo: () => void; onChange: (to: RatingValue) => void }) {
  const c = useTheme();
  const name = last ? NAMES[last.rating] : '';
  const said = notice === 'good' ? { text: 'Changed to Good', color: c.goodInk, fill: c.goodFill, badge: { kind: 'check', color: c.goodInk } as const }
    : notice === 'again' ? { text: 'Changed to Again', color: c.danger, fill: c.dangerFill, badge: { kind: 'x', color: c.danger } as const }
    : notice === 'undone' ? { text: 'Answer undone', color: c.text, fill: c.fill, badge: undefined }
    : null;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
      {said ? (
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row' }}>
          <Reveal key={notice} rise={0} duration={150} style={{ flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingLeft: 8, paddingRight: 12, borderRadius: radius.pill, backgroundColor: said.fill, ...smooth }}>
            <Pop from={0.6} bounciness={10}><UndoIcon color={said.color} cutout={flatten(said.fill, c.bg)} badge={said.badge} /></Pop>
            <Text numberOfLines={1} style={{ flexShrink: 1, ...type.footnote, fontWeight: '600', color: said.color }}>{said.text}</Text>
          </Reveal>
        </View>
      ) : last ? (
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, ...type.footnote, color: c.textSecondary }}>
          Last answer: <Text style={{ fontWeight: '600', color: c.text }}>{[last.word, name, last.interval].filter(Boolean).join(' · ')}</Text>
        </Text>
      ) : null}
      {last ? (
        <>
          <LineButton onPress={onUndo} label="Undo the last answer" ink={c.text} fill={c.fill} />
          {last.rating !== 3 ? (
            <LineButton onPress={() => onChange(3)} label={`Change ${name} to Good`} ink={c.goodInk} fill={c.goodFill} badge={{ kind: 'check', color: c.goodInk }} />
          ) : null}
          {last.rating !== 1 ? (
            <LineButton onPress={() => onChange(1)} label={`Change ${name} to Again`} ink={c.danger} fill={c.dangerFill} badge={{ kind: 'x', color: c.danger }} />
          ) : null}
        </>
      ) : null}
    </View>
  );
}
