import React, { useCallback, useEffect, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { SWIPE_DISTANCE, swipeRating } from '../core/session';
import type { RatingValue } from '../core/scheduler';
import { haptic } from './haptics';
import { useReduceMotion } from './motion';
import { hairline, lift, radius, smooth, space, type, useTheme } from './theme';

/** The card itself: a raised sheet that fills the space between the header and the buttons. */
export function CardSurface({ children, overlay, color }: { children: React.ReactNode; overlay?: React.ReactNode; /** Fills the card instead of the theme's surface (WaniKani's subject colors). */ color?: string }) {
  const c = useTheme();
  return (
    <View
      style={{
        flex: 1, marginHorizontal: space.l, marginTop: space.xxl, marginBottom: space.xs, borderRadius: radius.xl, ...smooth,
        backgroundColor: color ?? c.surface, borderWidth: hairline, borderColor: color ? 'transparent' : c.border, ...lift(c),
        // A popup hangs below the card: the row after it must not paint over it.
        ...(overlay ? { zIndex: 10 } : null),
      }}
    >
      {/* Clipped inside the shadow's box: a view that clips can't also cast one. */}
      <View style={{ flex: 1, borderRadius: radius.xl, ...smooth, overflow: 'hidden' }}>{children}</View>
      {/* Drawn over the card's lower edge, outside the clip. */}
      {overlay}
    </View>
  );
}

/** What Review asks of the card's motion: fly back in after an undo, and flash an answer's color. */
export type CardMotion = {
  /** The next card to show is an undone one: it comes back in from the side it left. */
  enterFrom: (dir: -1 | 1) => void;
  /** An answer was given: the card washes over in its button's color and fades back, over the next card. */
  flash: (rating: RatingValue) => void;
};

/** How strong an answer's flash starts (the swipe tint's own peak), and how long it takes to fade. It washes over the next card, so a long fade reads as that card being slow to arrive. */
const FLASH_PEAK = 0.22;
const FLASH_MS = 180;
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

/** How the card settles: back to the middle after a short drag, or in from the side after an undo. */
const BACK_SPRING = { damping: 16, stiffness: 240, mass: 1 } as const;
const ENTER_SPRING = { damping: 18, stiffness: 170, mass: 1 } as const;
/** The card leaving after an answering swipe: as fast as the flick that threw it, within these bounds (ms). */
const EXIT_MIN_MS = 120;
const EXIT_MAX_MS = 240;
/** The next card arriving: it grows in from this share of its size while fading up (ms). */
const ARRIVE_FROM = 0.94;
const ARRIVE_MS = 260;

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
export function SwipeCard({ enabled, cardKey, shown, motion, onRate, children }: {
  enabled: boolean;
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
  const entryDir = useRef<-1 | 1 | null>(null);
  const back = (velocity = 0) => { x.value = withSpring(0, { ...BACK_SPRING, velocity }); };
  const answerFlash = useAnswerFlash();
  motion.current = { enterFrom: (dir) => { entryDir.current = dir; }, flash: answerFlash.flash };
  // An undone card comes back in from the side it left.
  useEffect(() => {
    const from = entryDir.current;
    entryDir.current = null;
    if (!from) return;
    if (latest.current.reduce) { x.value = 0; return; }
    x.value = from * latest.current.width * 1.2;
    x.value = withSpring(0, ENTER_SPRING);
  });
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
    <View style={{ flex: 1 }}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1 }, cardStyle]}>
          <CardSurface>
            {children}
            <Animated.View pointerEvents="none" style={[fill, { backgroundColor: c.good }, rightTint]} />
            <Animated.View pointerEvents="none" style={[fill, { backgroundColor: c.again }, leftTint]} />
            {answerFlash.overlay}
            <Animated.Text pointerEvents="none" style={[{ ...type.title, position: 'absolute', top: space.l, left: space.xl, color: c.good }, rightWord]}>Good</Animated.Text>
            <Animated.Text pointerEvents="none" style={[{ ...type.title, position: 'absolute', top: space.l, right: space.xl, color: c.again }, leftWord]}>Again</Animated.Text>
          </CardSurface>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
