import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { RatingValue } from '../../core/scheduler';
import { haptic } from '../haptics';
import { Tappable } from '../kit';
import { Reveal } from '../motion';
import { PLAY_BUTTON_CLEARANCE, PlayButton } from '../PlayButton';
import { SwipeCard, type CardMotion } from '../SwipeCard';
import { hairline, radius, smooth, space, type, useTheme } from '../theme';

/**
 * A Practice tool built like Review's card: one sheet that fills the space between the header and
 * the buttons, the question in the middle, tapped to show the answer, which opens under it past a
 * divider. The footer is the tool's own (`MarkButtons` once the answer shows). Missed it and Got
 * it are swiped like Again and Good (SwipeCard), but a mark is never a rating: nothing here
 * reaches FSRS (tests/tools/noGrading.test.ts).
 */

/** SwipeCard's two directions: Again (left) and Good (right), read here as Missed it and Got it. */
const MARKS: RatingValue[] = [1, 3];

export function PracticeCard({ questionKey, cardKey, swipe, motion, onMark, onTap, onPlay, speech, front, back }: {
  /** Names the question: each new one fades in. */
  questionKey: string;
  /** Names what a swipe would mark: it changes when the card's state does, so a swipe landing late is dropped. */
  cardKey: string;
  /** Whether a sideways drag marks the question (the swipe setting, with the answer showing). */
  swipe: boolean;
  /** Set by the card; call `motion.current?.flash(...)` when a button marks, as Review does. */
  motion: React.MutableRefObject<CardMotion | null>;
  onMark: (right: boolean) => void;
  /** A tap anywhere on the card shows the answer; none once it's showing. */
  onTap?: () => void;
  /** The corner's play button, present once there is an answer to hear. */
  onPlay?: () => void;
  /** The language's voice, for the gear beside the play button. */
  speech?: string;
  front: React.ReactNode;
  /** The answer, under a divider; none until it's shown. */
  back?: React.ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <SwipeCard enabled={swipe} cardKey={cardKey} shown={MARKS} motion={motion} onRate={async (r) => onMark(r === 3)} words={{ right: 'Got it', left: 'Missed it' }}>
        {/* Not an accessibility element itself: the card's text stays readable, and Show answer is the control VoiceOver uses. */}
        <Pressable accessible={false} disabled={!onTap} onPress={() => { haptic.select(); onTap?.(); }} style={{ flex: 1 }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: space.xl, paddingBottom: onPlay ? PLAY_BUTTON_CLEARANCE : space.xl, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}
          >
            <Reveal key={questionKey} rise={6} duration={140}>{front}</Reveal>
            {back ? (
              <Reveal rise={14} style={{ gap: space.xl }}>
                {/* Not `border`: the card takes a tint while it's swiped, and `border` is too close to a dark tinted card to show. */}
                <View style={{ height: hairline, backgroundColor: c.textTertiary, opacity: 0.6 }} />
                {back}
              </Reveal>
            ) : null}
          </ScrollView>
        </Pressable>
      </SwipeCard>
      {onPlay ? <PlayButton onPlay={onPlay} speech={speech} /> : null}
    </View>
  );
}

/** The footer once the answer shows: Missed it and Got it, the shape and press of Review's Again and Good. */
export function MarkButtons({ onMark }: { onMark: (right: boolean) => void }) {
  const c = useTheme();
  const buttons = [{ right: false, label: 'Missed it', color: c.again }, { right: true, label: 'Got it', color: c.good }];
  return (
    <Reveal rise={6} style={{ flexDirection: 'row', gap: space.s }}>
      {buttons.map((b) => (
        <Tappable
          key={b.label}
          onPress={() => onMark(b.right)}
          accessibilityRole="button"
          accessibilityLabel={b.label}
          scaleTo={0.95}
          dimTo={0.85}
          style={{ flex: 1, minHeight: 60, borderRadius: radius.m + 2, ...smooth, alignItems: 'center', justifyContent: 'center', backgroundColor: b.color }}
        >
          <Text style={{ ...type.headline, color: c.onRating }}>{b.label}</Text>
        </Tappable>
      ))}
    </Reveal>
  );
}
