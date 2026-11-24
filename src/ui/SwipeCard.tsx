import React, { useCallback, useEffect, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { SWIPE_DISTANCE, swipeRating } from '../core/session';
import type { RatingValue } from '../core/scheduler';
import { haptic } from './haptics';
import { useReduceMotion } from './motion';
import { LanguagePill, type CardLanguage } from './LanguagePill';
import { hairline, lift, radius, smooth, space, type, useTheme } from './theme';

/** The card itself: a raised sheet that fills the space between the header and the buttons. */
export function CardSurface({ children, color, language, top = space.xxl }: {
  children: React.ReactNode;
  /** The gap above the card (under a progress bar, say). */
  top?: number;
  /** Fills the card instead of the theme's surface (WaniKani's subject colors). */
  color?: string;
  /** The language a card in a mixed deck belongs to: a wash of its deck's tint behind the card's content, and its name at the top. */
  language?: CardLanguage;
}) {
  const c = useTheme();
  return (
    <View
      style={{
        flex: 1, marginHorizontal: space.l, marginTop: top, marginBottom: space.xs, borderRadius: radius.xl, ...smooth,
        backgroundColor: color ? undefined : c.surface, borderWidth: hairline, borderColor: color ? 'transparent' : c.border, ...lift(c),
      }}
    >
      {/* Clipped inside the shadow's box: a view that clips can't also cast one. A subject color fills this clipped view, not the outer one: under it, the color showed as a thin outline around a band of another color at the card's foot. */}
      <View style={{ flex: 1, borderRadius: radius.xl, ...smooth, overflow: 'hidden', backgroundColor: color }}>
        {language ? <View pointerEvents="none" style={[FILL, { backgroundColor: language.wash }]} /> : null}
        {children}
        {language ? <LanguagePill language={language} /> : null}
      </View>
    </View>
  );
}

/** What Review asks of the card's motion: flash an answer's color. An undone card just appears, with no motion of its own. */
export type CardMotion = {
  /** An answer was given: the card washes over in its button's color and fades back, over the next card. */
  flash: (rating: RatingValue) => void;
};
/** How strong an answer's flash starts, and how long it takes to fade. It washes over the next card so the color can be registered after the tap; much longer than this and that card reads as slow to arrive. */
/** How strong an answer's flash starts (the swipe tint's own peak), and how long it takes to fade. It washes over the next card, so a long fade reads as that card being slow to arrive. */
const FLASH_PEAK = 0.35;
const FLASH_MS = 350;
const FILL = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

/**
 * A card that washes over in an answer's color (1 Again to 4 Easy, the buttons' colors) and fades
 * back: put `overlay` last inside the card's surface and call `flash` as the answer is given. It
 * runs on the UI thread, so it starts with the answer, not after the next card has rendered.
 */
export function useAnswerFlash() {
  const c = useTheme();
  const amount = useSharedValue(0);
  const rating = useSharedValue<number>(3);
  const colors = [c.again, c.hard, c.good, c.easy];
  const style = useAnimatedStyle(() => ({ opacity: amount.value, backgroundColor: colors[rating.value - 1] }));
  const flash = useCallback((r: RatingValue) => {
    rating.value = r;
    amount.value = FLASH_PEAK;
    amount.value = withTiming(0, { duration: FLASH_MS, easing: Easing.out(Easing.quad) });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { flash, overlay: <Animated.View pointerEvents="none" style={[FILL, style]} /> };
}

/** How the card settles back to the middle after a short drag. */
const BACK_SPRING = { damping: 16, stiffness: 240, mass: 1 } as const;
/** The card leaving after an answering swipe: as fast as the flick that threw it, within these bounds (ms). */
const EXIT_MIN_MS = 100;
const EXIT_MAX_MS = 180;
/** The next card arriving: it grows in from this share of its size while fading up (ms). */
const ARRIVE_FROM = 0.94;
const ARRIVE_MS = 160;

/**
 * The card sheet, draggable sideways once it's revealed when swiping is on: it follows the finger,
 * tints toward the answer it would give (right Good, left Again), and answers when let go past
 * the line. The card then flies off the side it was thrown to, and the answer is given as it leaves, so the
 * next card arrives (fading and growing in) on a clear screen instead of the old card snapping back to the
 * middle. Only a rating the answer buttons show can be given (`swipeRating`).
 *
 * The drag and the tint run on the UI thread (Reanimated), so they keep up with
 * the finger even while the screen is busy rendering the next card; only the decision to answer
 * and the haptic hop back to JS.
 */
export function SwipeCard({ enabled, cardKey, shown, motion, onRate, language, words, offstage = false, children }: {
  enabled: boolean;
  /**
   * Laid out out of sight, taking no space, taps or VoiceOver: Review's card ahead, loading while a
   * native card is on screen. The same element shown later keeps what it loaded (only the style changes).
   */
  offstage?: boolean;
  /** What the tint says at each edge: Review's answers by default; Practice's Missed it and Got it. */
  words?: { right: string; left: string };
  /** Present when the deck mixes languages (`studiedSubdecks`). */
  language?: CardLanguage;
  /** Names the card on screen and how many answers there are: a swipe that lands after this changed (an answer button, an undo) is dropped. */
  cardKey: string;
  shown: RatingValue[];
  motion: React.MutableRefObject<CardMotion | null>;
  onRate: (r: RatingValue) => Promise<void>;
  children: React.ReactNode;
}) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  // Which directions give an answer, for the haptic at the line (the same rule as `swipeRating`).
  const rightOk = useSharedValue(shown.includes(3));
  const leftOk = useSharedValue(shown.includes(1));
  const crossed = useSharedValue(false);
  // True from the moment an answering swipe is let go until the next card has arrived: the drag is ignored meanwhile.
  const leaving = useSharedValue(false);
  // 0 to 1 as the next card arrives after a swipe.
  const arrive = useSharedValue(1);
  // The gesture's callbacks reach JS through these, so they read the latest props from here.
  const latest = useRef({ enabled, cardKey, shown, onRate, width, reduce });
  latest.current = { enabled, cardKey, shown, onRate, width, reduce };
  useEffect(() => {
    rightOk.value = shown.includes(3);
    leftOk.value = shown.includes(1);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = (velocity = 0) => { x.value = withSpring(0, { ...BACK_SPRING, velocity }); };
  const answerFlash = useAnswerFlash();
  motion.current = { flash: answerFlash.flash };
  // Back on JS once the finger is up: whether the drag answers (the rule is core's, with points per millisecond).
  const release = (dx: number, vx: number) => {
    const rating = swipeRating(dx, vx / 1000, latest.current.shown);
    if (!rating) { back(vx); return; }
    const { cardKey: thrown, width: w, reduce: still } = latest.current;
    // The answer is given once the card has gone, unless it was answered or undone from a button meanwhile.
    const land = () => {
      if (latest.current.cardKey === thrown) void latest.current.onRate(rating);
      // Back at the middle for the next card, hidden until it's there and then grown in.
      arrive.value = still ? 1 : 0;
      x.value = 0;
      if (!still) arrive.value = withTiming(1, { duration: ARRIVE_MS, easing: Easing.out(Easing.cubic) });
      leaving.value = false;
    };
    leaving.value = true;
    if (still) { land(); return; }
    const dir = dx > 0 ? 1 : -1;
    const target = dir * w * 1.15;
    const speed = Math.max(Math.abs(vx) / 1000, 0.01);
    const ms = Math.min(EXIT_MAX_MS, Math.max(EXIT_MIN_MS, Math.abs(target - dx) / speed));
    x.value = withTiming(target, { duration: ms, easing: Easing.in(Easing.quad) }, (done) => {
      if (done) scheduleOnRN(land);
    });
  };
  const tick = () => haptic.select();
  const pan = usePanGesture({
    enabled,
    // Claim only a clearly horizontal drag, so the card's own text still scrolls vertically.
    activeOffsetX: [-12, 12],
    failOffsetY: [-18, 18],
    onUpdate: (e) => {
      if (leaving.value) return;
      x.value = e.translationX;
      const past = (e.translationX >= SWIPE_DISTANCE && rightOk.value) || (e.translationX <= -SWIPE_DISTANCE && leftOk.value);
      if (past !== crossed.value) {
        crossed.value = past;
        if (past) scheduleOnRN(tick);
      }
    },
    onDeactivate: (e) => {
      crossed.value = false;
      if (leaving.value) return;
      if (e.canceled) { x.value = withSpring(0, BACK_SPRING); return; }
      scheduleOnRN(release, e.translationX, e.velocityX);
    },
  });
  const cardStyle = useAnimatedStyle(() => ({
    opacity: arrive.value,
    transform: [
      { translateX: x.value },
      { rotate: `${interpolate(x.value, [-300, 0, 300], [-5, 0, 5], Extrapolation.CLAMP)}deg` },
      { scale: interpolate(arrive.value, [0, 1], [ARRIVE_FROM, 1]) },
    ],
  }));
  // Tints and words that ramp in as the card is dragged, the answer it gives.
  const rightTint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, SWIPE_DISTANCE], [0, 0.22], Extrapolation.CLAMP) }));
  const leftTint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-SWIPE_DISTANCE, 0], [0.22, 0], Extrapolation.CLAMP) }));
  const rightWord = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, SWIPE_DISTANCE * 0.22], [0, 1], Extrapolation.CLAMP) }));
  const leftWord = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-SWIPE_DISTANCE * 0.22, 0], [1, 0], Extrapolation.CLAMP) }));
  const fill = FILL;
  return (
    <View
      style={offstage ? [FILL, { opacity: 0 }] : { flex: 1 }}
      pointerEvents={offstage ? 'none' : 'auto'}
      accessibilityElementsHidden={offstage}
      importantForAccessibility={offstage ? 'no-hide-descendants' : 'auto'}
    >
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1 }, cardStyle]}>
          <CardSurface language={language}>
            {children}
            <Animated.View pointerEvents="none" style={[fill, { backgroundColor: c.good }, rightTint]} />
            <Animated.View pointerEvents="none" style={[fill, { backgroundColor: c.again }, leftTint]} />
            {answerFlash.overlay}
            <Animated.Text pointerEvents="none" style={[{ ...type.title, position: 'absolute', top: space.l, left: space.xl, color: c.good }, rightWord]}>{words?.right ?? 'Good'}</Animated.Text>
            <Animated.Text pointerEvents="none" style={[{ ...type.title, position: 'absolute', top: space.l, right: space.xl, color: c.again }, leftWord]}>{words?.left ?? 'Again'}</Animated.Text>
          </CardSurface>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
