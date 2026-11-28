import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { RatingValue } from '../../core/scheduler';
import type { Repo } from '../../db/repo';
import type { Phrase } from '../../tools/phrase';
import { haptic } from '../haptics';
import { Button, Tappable } from '../kit';
import { Reveal } from '../motion';
import { PLAY_BUTTON_CLEARANCE, PlayButton, playButtonScrollInsets } from '../PlayButton';
import { PlayCircle } from '../PlayCircle';
import { SwipeCard, type CardMotion } from '../SwipeCard';
import { hairline, radius, smooth, space, type, useTheme } from '../theme';
import { useSoundingButton } from '../useSoundingButton';
import { AnswerContent, Status, type Answer } from './ToolScreen';
import { READABLE_WIDTH } from '../../core/wide';

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
            scrollIndicatorInsets={playButtonScrollInsets(!!onPlay)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: space.xl, paddingBottom: onPlay ? PLAY_BUTTON_CLEARANCE : space.xl, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: READABLE_WIDTH, alignSelf: 'center' }}
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

/** Whether swiping marks a question: the swipe setting Review's cards follow, read once. */
export function useSwipeSetting(repo: Repo): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => { repo.swipeToRate().then(setOn, () => setOn(false)); }, [repo]);
  return on;
}

/** The footer of a tool you answer by saying it: Show answer, then Missed it and Got it, or Next after a miss that keeps its rule up. */
export function SayFooter({ shown, missed, onShow, onNext, onMark }: { shown: boolean; missed: boolean; onShow: () => void; onNext: () => void; onMark: (right: boolean) => void }) {
  if (!shown) return <Button label="Show answer" onPress={onShow} />;
  if (missed) return <Button label="Next" onPress={onNext} />;
  return <MarkButtons onMark={onMark} />;
}

/** A listening question: a large play button to hear it again, what to do, and the tool's answer field under them. */
export function ListenPrompt({ label, hint, onPlay, wave, children }: { label: string; hint: string; onPlay: () => void; /** A sound wave over the button, for a word heard rather than a time or an amount. */ wave?: boolean; children?: React.ReactNode }) {
  const c = useTheme();
  const button = useSoundingButton();
  return (
    <View style={{ gap: space.l }}>
      <View style={{ alignItems: 'center', gap: space.m }}>
        {wave ? <SoundWave /> : null}
        <PlayCircle playing={button.playing} onPress={() => button.tap(onPlay)} accessibilityLabel={button.playing ? 'Pause' : label} />
        <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{hint}</Text>
      </View>
      {children}
    </View>
  );
}

/** What a listening check came to, under the card's divider: right, or what it was; then how it's said, with the rule after a miss. */
export function ListenBack({ right, wrong, answer, rule, onPlay }: { right: boolean; wrong: string; answer: Answer; rule: string | undefined; onPlay: (p: Phrase) => void }) {
  return (
    <View style={{ gap: space.m }}>
      <View style={{ alignItems: 'center' }}>{right ? <Status tone="good">Right.</Status> : <Status tone="bad">{wrong}</Status>}</View>
      <AnswerContent centered answer={answer} rule={right ? undefined : rule} onPlay={onPlay} />
    </View>
  );
}

/** The footer of a listening tool: Check, then Next, with Try again beside it after a miss. */
export function ListenFooter({ verdict, canCheck, onCheck, onRetry, onNext }: { verdict: { right: boolean } | null; canCheck: boolean; onCheck: () => void; onRetry: () => void; onNext: () => void }) {
  if (!verdict) return <Button label="Check" onPress={onCheck} disabled={!canCheck} />;
  if (verdict.right) return <Button label="Next" onPress={onNext} />;
  return (
    <View style={{ flexDirection: 'row', gap: space.s }}>
      <Button variant="secondary" label="Try again" style={{ flex: 1 }} onPress={onRetry} />
      <Button label="Next" style={{ flex: 1 }} onPress={onNext} />
    </View>
  );
}

/** A still sound wave: bars of uneven height in the accent, over a play button. Decorative. */
const WAVE = [14, 26, 38, 20, 46, 30, 18, 40, 52, 34, 22, 44, 28, 16, 36, 48, 24, 42, 30, 18, 38, 26, 14];
function SoundWave() {
  const c = useTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 54 }}>
      {WAVE.map((h, i) => <View key={i} style={{ width: 4, height: h, borderRadius: 2, backgroundColor: c.accent, opacity: 0.8 }} />)}
    </View>
  );
}
