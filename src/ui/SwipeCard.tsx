import React, { useEffect, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { SWIPE_DISTANCE, swipeRating } from '../core/session';
import type { RatingValue } from '../core/scheduler';
import { haptic } from './haptics';
import { useReduceMotion } from './motion';
import { hairline, lift, radius, smooth, space, type, useTheme } from './theme';

/** The card itself: a raised sheet that fills the space between the header and the buttons. */
export function CardSurface({ children, overlay }: { children: React.ReactNode; overlay?: React.ReactNode }) {
  const c = useTheme();
  return (
    <View
      style={{
        flex: 1, marginHorizontal: space.l, marginTop: space.xxl, marginBottom: space.xs, borderRadius: radius.xl, ...smooth,
        backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border, ...lift(c),
      }}
    >
      {/* Clipped inside the shadow's box: a view that clips can't also cast one. */}
      <View style={{ flex: 1, borderRadius: radius.xl, ...smooth, overflow: 'hidden' }}>{children}</View>
      {/* Drawn over the card's lower edge, outside the clip. */}
      {overlay}
    </View>
  );
}

/** What Review asks of the card's motion: fly back in after an undo. */
export type CardMotion = {
  /** The next card to show is an undone one: it comes back in from the side it left. */
  enterFrom: (dir: -1 | 1) => void;
};

/** How the card settles: back to the middle after a short drag, or in from the side after an undo. */
const BACK_SPRING = { damping: 16, stiffness: 240, mass: 1 } as const;
const ENTER_SPRING = { damping: 18, stiffness: 170, mass: 1 } as const;

/**
 * The card sheet, draggable sideways once it's revealed when swiping is on: it follows the finger,
 * tints toward the answer it would give (right Good, left Again), and answers when let go past
 * the line. The card doesn't fly off: the next card replaces it at once. Only a rating the answer buttons show can be given
 * (`swipeRating`).
 *
 * The drag and the tint run on the UI thread (Reanimated), so they keep up with
 * the finger even while the screen is busy rendering the next card; only the decision to answer
 * and the haptic hop back to JS.
 */
export function SwipeCard({ enabled, shown, motion, onRate, children }: {
  enabled: boolean;
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
  // The gesture's callbacks reach JS through these, so they read the latest props from here.
  const latest = useRef({ enabled, shown, onRate, width, reduce });
  latest.current = { enabled, shown, onRate, width, reduce };
  useEffect(() => {
    rightOk.value = shown.includes(3);
    leftOk.value = shown.includes(1);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const entryDir = useRef<-1 | 1 | null>(null);
  const back = (velocity = 0) => { x.value = withSpring(0, { ...BACK_SPRING, velocity }); };
  motion.current = { enterFrom: (dir) => { entryDir.current = dir; } };
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
    x.value = 0;
    void latest.current.onRate(rating);
  };
  const tick = () => haptic.select();
  const pan = usePanGesture({
    enabled,
    // Claim only a clearly horizontal drag, so the card's own text still scrolls vertically.
    activeOffsetX: [-12, 12],
    failOffsetY: [-18, 18],
    onUpdate: (e) => {
      x.value = e.translationX;
      const past = (e.translationX >= SWIPE_DISTANCE && rightOk.value) || (e.translationX <= -SWIPE_DISTANCE && leftOk.value);
      if (past !== crossed.value) {
        crossed.value = past;
        if (past) scheduleOnRN(tick);
      }
    },
    onDeactivate: (e) => {
      crossed.value = false;
      if (e.canceled) { x.value = withSpring(0, BACK_SPRING); return; }
      scheduleOnRN(release, e.translationX, e.velocityX);
    },
  });
  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { rotate: `${interpolate(x.value, [-300, 0, 300], [-5, 0, 5], Extrapolation.CLAMP)}deg` },
    ],
  }));
  // Tints and words that ramp in as the card is dragged, the answer it gives.
  const rightTint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, SWIPE_DISTANCE], [0, 0.22], Extrapolation.CLAMP) }));
  const leftTint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-SWIPE_DISTANCE, 0], [0.22, 0], Extrapolation.CLAMP) }));
  const rightWord = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, SWIPE_DISTANCE * 0.22], [0, 1], Extrapolation.CLAMP) }));
  const leftWord = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-SWIPE_DISTANCE * 0.22, 0], [1, 0], Extrapolation.CLAMP) }));
  const fill = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;
  return (
    <View style={{ flex: 1 }}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1 }, cardStyle]}>
          <CardSurface>
            {children}
            <Animated.View pointerEvents="none" style={[fill, { backgroundColor: c.good }, rightTint]} />
            <Animated.View pointerEvents="none" style={[fill, { backgroundColor: c.again }, leftTint]} />
            <Animated.Text pointerEvents="none" style={[{ ...type.title, position: 'absolute', top: space.l, left: space.xl, color: c.good }, rightWord]}>Good</Animated.Text>
            <Animated.Text pointerEvents="none" style={[{ ...type.title, position: 'absolute', top: space.l, right: space.xl, color: c.again }, leftWord]}>Again</Animated.Text>
          </CardSurface>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
