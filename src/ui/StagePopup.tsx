import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import type { StageChange } from '../wanikani/srs';
import type { Side, Slot } from '../wanikani/stagePopups';
import { Icon } from './kit';
import { useReduceMotion } from './motion';
import { hairline, radius, smooth, space, type, useTheme } from './theme';

/** How long the pill stays up: Burned ends an item for good, so it stays a little longer. */
export function stagePopupMs(change: StageChange): number {
  return change.burned ? 2200 : 1400;
}

/** How long it takes to lift away at the end of `stagePopupMs`, and to fade out when a newer popup pushes it off the stack. */
export const STAGE_POPUP_EXIT_MS = 260;
const EXIT_MS = STAGE_POPUP_EXIT_MS;

/**
 * The pill just above the card's question band when an answer moves an item into another stage group
 * (Apprentice, Guru, Master, Enlightened, Burned). Put it in a view that wraps the band: it hangs off
 * that view's top edge. A rise swoops in from the upper left on an arc, overshoots, and settles; the
 * arrow hops. Each group takes a tint from the theme, and a white ring lifts it off any card color. A drop is a quiet neutral pill with a down arrow that
 * only fades up, so a miss shows without an alarm color or a fanfare. The parent removes it after
 * `stagePopupMs`; it lifts itself away just before. Key it to the answer so each one replays. Several
 * can show at once (stagePopups.ts): `side` is the side it swoops in from, and `slot` where it rests,
 * which moves as newer ones push it up and away. With Reduce Motion on, or the animation turned off
 * in WaniKani's settings, it only fades.
 */
export function StagePopup({ change, side, slot, animate, hold }: {
  change: StageChange;
  /** The side a rise swoops in from: -1 the left, 1 the right. A drop has none. */
  side: Side;
  /** Where it rests now: the newest at 0, older ones pushed up and aside, a pushed-off one faded out. */
  slot: Slot;
  /** WaniKani's own setting (Settings, WaniKani, Animate level ups); Reduce Motion turns the motion off too. */
  animate: boolean;
  /** How far the keyboard has pushed the card's foot up (the screen's bottom padding). The pill hangs off the card, so it cancels the change since it appeared and stays where it showed. */
  hold: number;
}) {
  const c = useTheme();
  // The keyboard moves the card the pill hangs off (up by the increase in `hold`); this moves the pill back by the same amount, over the keyboard's own duration.
  const holdBase = useRef(hold).current;
  const shift = useRef(new Animated.Value(0)).current;
  // Either the system's Reduce Motion or the setting stills it.
  const reduce = useReduceMotion() || !animate;
  const enter = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  // Where newer popups have pushed it: starts at its slot, so the newest doesn't move until one comes.
  const px = useRef(new Animated.Value(slot.x)).current;
  const py = useRef(new Animated.Value(slot.y)).current;
  const pTilt = useRef(new Animated.Value(slot.tilt)).current;
  const pScale = useRef(new Animated.Value(slot.scale)).current;
  const pOpacity = useRef(new Animated.Value(slot.opacity)).current;
  const ms = stagePopupMs(change);

  useEffect(() => {
    const to = [[px, slot.x], [py, slot.y], [pTilt, slot.tilt], [pScale, slot.scale], [pOpacity, slot.opacity]] as const;
    if (reduce) {
      to.forEach(([v, n]) => v.setValue(n));
      return undefined;
    }
    const run = Animated.parallel(to.map(([v, n]) => Animated.spring(v, { toValue: n, speed: 14, bounciness: 8, useNativeDriver: true })));
    run.start();
    return () => run.stop();
  }, [slot.x, slot.y, slot.tilt, slot.scale, slot.opacity, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (reduce) {
      shift.setValue(hold - holdBase);
      return undefined;
    }
    const run = Animated.timing(shift, { toValue: hold - holdBase, duration: 250, easing: Easing.bezier(0.17, 0.59, 0.4, 0.77), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [hold, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const exitRun = Animated.timing(exit, { toValue: 1, duration: reduce ? 0 : EXIT_MS, delay: ms - (reduce ? 0 : EXIT_MS), easing: Easing.in(Easing.cubic), useNativeDriver: true });
    if (reduce) {
      enter.setValue(1);
      exitRun.start();
      return () => exitRun.stop();
    }
    const enterRun = change.up
      ? Animated.spring(enter, { toValue: 1, speed: 14, bounciness: 11, useNativeDriver: true })
      : Animated.timing(enter, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    const hopRun = change.up ? Animated.timing(hop, { toValue: 1, duration: 420, delay: 300, easing: Easing.out(Easing.back(3)), useNativeDriver: true }) : null;
    enterRun.start();
    hopRun?.start();
    exitRun.start();
    return () => { enterRun.stop(); hopRun?.stop(); exitRun.stop(); };
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const tint: Record<string, string> = { Apprentice: c.rose, Guru: c.violet, Master: c.indigo, Enlightened: c.teal, Burned: c.textSecondary };
  const fill = change.up ? tint[change.group] ?? c.accent : c.surface;
  // Burned's fill is the secondary text color, so its text is the page's background.
  const ink = !change.up ? c.text : change.burned ? c.bg : c.onRating;

  // A rise comes in along an arc from its side; the spring runs past 1, which is the overshoot. A drop only rises a few points.
  const swoops = change.up && !reduce;
  const fadeIn = enter.interpolate({ inputRange: [0, 0.3], outputRange: [0, 1], extrapolate: 'clamp' });
  const fadeOut = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const enterX = enter.interpolate({ inputRange: [0, 1], outputRange: [swoops ? side * 120 : 0, 0] });
  const enterY = enter.interpolate({ inputRange: [0, 1], outputRange: [swoops ? -80 : 6, 0] });
  const enterTilt = enter.interpolate({ inputRange: [0, 1], outputRange: [swoops ? side * 16 : 0, 0] });
  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [swoops ? 0.55 : 1, 1] });
  const lift = exit.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });
  const transform = [
    { translateX: Animated.add(enterX, px) },
    { translateY: Animated.add(Animated.add(Animated.add(enterY, lift), py), shift) },
    { scale: Animated.multiply(enterScale, pScale) },
    { rotate: Animated.add(enterTilt, pTilt).interpolate({ inputRange: [-180, 180], outputRange: ['-180deg', '180deg'] }) },
  ];

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', paddingBottom: space.l, alignItems: 'center', zIndex: 10, elevation: 10 }}>
      <Animated.View
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`${change.up ? 'Moved up to' : 'Dropped back to'} ${change.group}`}
        style={{ opacity: Animated.multiply(Animated.multiply(fadeIn, fadeOut), pOpacity), transform }}
      >
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s,
            borderRadius: radius.pill, ...smooth, backgroundColor: fill,
            borderWidth: change.up ? 3 : hairline, borderColor: change.up ? c.onRating : c.border,
            ...(change.up ? { shadowColor: c.shadow, shadowOpacity: 0.5, shadowRadius: 9, shadowOffset: { width: 0, height: 6 } } : null),
          }}
        >
          <Animated.View style={{ transform: [{ translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [5, -1] }) }] }}>
            <Icon name={change.up ? 'arrow.up' : 'arrow.down'} size={16} color={ink} weight="bold" />
          </Animated.View>
          <Text style={{ ...type.headline, color: ink }}>{change.group}</Text>
        </View>
      </Animated.View>
    </View>
  );
}
