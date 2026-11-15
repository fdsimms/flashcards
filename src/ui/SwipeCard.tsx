import React, { useEffect, useRef, useState } from 'react';
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

/** What Review asks of the card's motion: fly off for a rating, fly back in after an undo. */
export type CardMotion = {
  /** Flies the card off toward its rating (Again left, the others right); resolves once it's gone. */
  exit: (rating: RatingValue) => Promise<void>;
  /** The next card to show is an undone one: it comes back in from the side it left. */
  enterFrom: (dir: -1 | 1) => void;
  /** After an answer: brings the card back if no new card arrived (the write failed). */
  settleSoon: () => void;
};

/** The card's word for a rating given to the right of the card (Good, or Hard and Easy from the buttons). */
const RIGHT_WORD = { 2: 'Hard', 3: 'Good', 4: 'Easy' } as const;

/** How the card settles: back to the middle after a short drag, or in from the side after an undo. */
const BACK_SPRING = { damping: 16, stiffness: 240, mass: 1 } as const;
const ENTER_SPRING = { damping: 18, stiffness: 170, mass: 1 } as const;
const RISE_SPRING = { damping: 17, stiffness: 190, mass: 1 } as const;

/**
 * The card sheet, draggable sideways once it's revealed when swiping is on: it follows the finger,
 * tints toward the answer it would give (right Good, left Again), and flies off when let go past
 * the line, carrying the speed it was let go at. Only a rating the answer buttons show can be given
 * (`swipeRating`).
 *
 * The drag, the tint and the fly-off all run on the UI thread (Reanimated), so they keep up with
 * the finger even while the screen is busy rendering the next card; only the decision to answer
 * and the haptic hop back to JS.
 */
export function SwipeCard({ enabled, shown, showing, motion, onRate, children }: {
  enabled: boolean;
  shown: RatingValue[];
  /** Changes with each card shown (and each card shown again): the next one rises in from under this one. */
  showing: string | undefined;
  motion: React.MutableRefObject<CardMotion | null>;
  onRate: (r: RatingValue) => Promise<void>;
  children: React.ReactNode;
}) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  // 1 at rest; 0 as the next card starts under the one that left, and it grows to full size.
  const rise = useSharedValue(1);
  // How much of the card underneath shows: while one card is leaving and the next arriving.
  const veil = useSharedValue(0);
  // Which directions give an answer, for the haptic at the line (the same rule as `swipeRating`).
  const rightOk = useSharedValue(shown.includes(3));
  const leftOk = useSharedValue(shown.includes(1));
  const crossed = useSharedValue(false);
  const [rightRating, setRightRating] = useState<2 | 3 | 4>(3);
  // The gesture's callbacks reach JS through these, so they read the latest props from here.
  const latest = useRef({ enabled, shown, onRate, width, reduce });
  latest.current = { enabled, shown, onRate, width, reduce };
  useEffect(() => {
    rightOk.value = shown.includes(3);
    leftOk.value = shown.includes(1);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  // Off screen after an answer, until the next card is shown.
  const leaving = useRef(false);
  const entryDir = useRef<-1 | 1 | null>(null);
  const back = (velocity = 0) => { x.value = withSpring(0, { ...BACK_SPRING, velocity }); };
  const fly = (rating: RatingValue, velocity = 0) => new Promise<void>((resolve) => {
    const dir = rating === 1 ? -1 : 1;
    if (rating !== 1) setRightRating(rating === 2 || rating === 4 ? rating : 3);
    leaving.current = true;
    const target = dir * latest.current.width * 1.2;
    // Let go at speed: carry it, so the card doesn't slow to a fixed 220 ms. From rest (a button), ease in.
    const along = velocity * dir;
    const duration = along > 0 ? Math.min(240, Math.max(110, (Math.abs(target - x.value) / along) * 1000)) : 220;
    const done = () => resolve();
    veil.value = withTiming(1, { duration: 120 });
    x.value = withTiming(target, { duration, easing: along > 0 ? Easing.linear : Easing.in(Easing.quad) }, () => { scheduleOnRN(done); });
  });
  const settleSoon = () => {
    setTimeout(() => {
      if (!leaving.current) return;
      leaving.current = false;
      setRightRating(3);
      veil.value = withTiming(0, { duration: 200 });
      back();
    }, 400);
  };
  motion.current = {
    exit: (rating) => (latest.current.reduce ? Promise.resolve() : fly(rating)),
    enterFrom: (dir) => { entryDir.current = dir; },
    settleSoon,
  };
  // A new card: from under the one that left, or, after an undo, from the side the old one went.
  useEffect(() => {
    const from = entryDir.current;
    entryDir.current = null;
    if (latest.current.reduce) { x.value = 0; veil.value = 0; rise.value = 1; leaving.current = false; return; }
    if (from) {
      leaving.current = false;
      setRightRating(3);
      x.value = from * latest.current.width * 1.2;
      x.value = withSpring(0, ENTER_SPRING);
      return;
    }
    if (!leaving.current) return;
    leaving.current = false;
    setRightRating(3);
    x.value = 0;
    rise.value = 0;
    rise.value = withSpring(1, RISE_SPRING);
    veil.value = withTiming(0, { duration: 260 });
  }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back on JS once the finger is up: whether the drag answers (the rule is core's, with points per millisecond).
  const release = (dx: number, vx: number) => {
    const rating = swipeRating(dx, vx / 1000, latest.current.shown);
    if (!rating) { back(vx); return; }
    void fly(rating, vx).then(async () => {
      await latest.current.onRate(rating);
      settleSoon();
    });
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
      { translateY: interpolate(rise.value, [0, 1], [14, 0]) },
      { scale: interpolate(rise.value, [0, 1], [0.94, 1]) },
      { rotate: `${interpolate(x.value, [-300, 0, 300], [-5, 0, 5], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const underStyle = useAnimatedStyle(() => ({ opacity: veil.value, transform: [{ translateY: 14 }, { scale: 0.94 }] }));
  // Tints and words that ramp in as the card is dragged, or sent off by a button: the answer it gives.
  const rightTint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, SWIPE_DISTANCE], [0, 0.22], Extrapolation.CLAMP) }));
  const leftTint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-SWIPE_DISTANCE, 0], [0.22, 0], Extrapolation.CLAMP) }));
  const rightWord = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, SWIPE_DISTANCE * 0.22], [0, 1], Extrapolation.CLAMP) }));
  const leftWord = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-SWIPE_DISTANCE * 0.22, 0], [1, 0], Extrapolation.CLAMP) }));
  const rightColor = rightRating === 2 ? c.hard : rightRating === 4 ? c.easy : c.good;
  const fill = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;
  return (
    <View style={{ flex: 1 }}>
      {/* The card underneath, seen only while one card leaves and the next arrives. */}
      <Animated.View pointerEvents="none" style={[fill, underStyle]}>
        <CardSurface><View /></CardSurface>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1 }, cardStyle]}>
          <CardSurface>
            {children}
            <Animated.View pointerEvents="none" style={[fill, { backgroundColor: rightColor }, rightTint]} />
            <Animated.View pointerEvents="none" style={[fill, { backgroundColor: c.again }, leftTint]} />
            <Animated.Text pointerEvents="none" style={[{ ...type.title, position: 'absolute', top: space.l, left: space.xl, color: rightColor }, rightWord]}>{RIGHT_WORD[rightRating]}</Animated.Text>
            <Animated.Text pointerEvents="none" style={[{ ...type.title, position: 'absolute', top: space.l, right: space.xl, color: c.again }, leftWord]}>Again</Animated.Text>
          </CardSurface>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
