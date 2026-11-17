import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import type { StageChange } from '../wanikani/srs';
import { Icon } from './kit';
import { useReduceMotion } from './motion';
import { hairline, radius, smooth, space, type, useTheme } from './theme';

/** How long the pill stays up: Burned ends an item for good, so it stays a little longer. */
export function stagePopupMs(change: StageChange): number {
  return change.burned ? 2200 : 1400;
}

/** How long it takes to lift away at the end of `stagePopupMs`. */
const EXIT_MS = 260;
/** The ring that pulses outward on arrival: how far it grows across and down, as a multiple of the pill. Kept small so it stays a ripple, not a splash. */
const PULSE_SCALE_X = 1.2;
const PULSE_SCALE_Y = 1.5;
/** Where each of the four sparks flies to from the pill's center, in points. */
const SPARKS = [{ x: -64, y: -30 }, { x: 60, y: -34 }, { x: -34, y: 30 }, { x: 40, y: 28 }] as const;

/**
 * The pill just above the card's question band when an answer moves an item into another stage group
 * (Apprentice, Guru, Master, Enlightened, Burned). Put it in a view that wraps the band: it hangs off
 * that view's top edge. A rise swoops in from the upper left on an arc, overshoots, and settles; the
 * arrow hops, a ring pulses outward and sparks fly off. Each group takes a tint from the theme, and a
 * white ring lifts it off any card color. A drop is a quiet neutral pill with a down arrow that
 * only fades up, so a miss shows without an alarm color or a fanfare. The parent removes it after
 * `stagePopupMs`; it lifts itself away just before. Key it to the answer so each one replays. With
 * Reduce Motion on, or the animation turned off in WaniKani's settings, it only fades.
 */
export function StagePopup({ change, animate }: { change: StageChange; /** WaniKani's own setting (Settings, WaniKani, Animate level ups); Reduce Motion turns the motion off too. */ animate: boolean }) {
  const c = useTheme();
  // Either the system's Reduce Motion or the setting stills it.
  const reduce = useReduceMotion() || !animate;
  const enter = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const ms = stagePopupMs(change);

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
    const extras = change.up
      ? Animated.parallel([
          Animated.timing(hop, { toValue: 1, duration: 420, delay: 300, easing: Easing.out(Easing.back(3)), useNativeDriver: true }),
          Animated.timing(burst, { toValue: 1, duration: 650, delay: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ])
      : null;
    enterRun.start();
    extras?.start();
    exitRun.start();
    return () => { enterRun.stop(); extras?.stop(); exitRun.stop(); };
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const tint: Record<string, string> = { Apprentice: c.rose, Guru: c.violet, Master: c.indigo, Enlightened: c.teal, Burned: c.textSecondary };
  const fill = change.up ? tint[change.group] ?? c.accent : c.surface;
  // Burned's fill is the secondary text color, so its text is the page's background.
  const ink = !change.up ? c.text : change.burned ? c.bg : c.onRating;

  // A rise comes in along an arc; the spring runs past 1, which is the overshoot. A drop only rises a few points.
  const fadeIn = enter.interpolate({ inputRange: [0, 0.3], outputRange: [0, 1], extrapolate: 'clamp' });
  const fadeOut = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const swoop = change.up && !reduce
    ? [
        { translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [-120, 0] }) },
        { translateY: Animated.add(enter.interpolate({ inputRange: [0, 1], outputRange: [-80, 0] }), exit.interpolate({ inputRange: [0, 1], outputRange: [0, -14] })) },
        { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) },
        { rotate: enter.interpolate({ inputRange: [0, 1], outputRange: ['-16deg', '0deg'] }) },
      ]
    : [{ translateY: Animated.add(enter.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }), exit.interpolate({ inputRange: [0, 1], outputRange: [0, -14] })) }];

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', paddingBottom: space.l, alignItems: 'center', zIndex: 10, elevation: 10 }}>
      <Animated.View
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`${change.up ? 'Moved up to' : 'Dropped back to'} ${change.group}`}
        style={{ opacity: Animated.multiply(fadeIn, fadeOut), transform: swoop }}
      >
        {change.up && !reduce ? <Burst burst={burst} ringColor={c.onRating} /> : null}
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s,
            borderRadius: radius.pill, ...smooth, backgroundColor: fill,
            borderWidth: change.up ? 3 : hairline, borderColor: change.up ? c.onRating : c.border,
            ...(change.up ? { shadowColor: c.shadow, shadowOpacity: 0.5, shadowRadius: 9, shadowOffset: { width: 0, height: 6 } } : null),
          }}
        >
          <Animated.View style={{ transform: [{ translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }}>
            <Icon name={change.up ? 'arrow.up' : 'arrow.down'} size={16} color={ink} weight="bold" />
          </Animated.View>
          <Text style={{ ...type.headline, color: ink }}>{change.group}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * What goes on behind a rise's pill on arrival: a ring that pulses outward and fades, and four
 * sparks. Both are sized from the pill, so they sit under it and grow out from its edge.
 */
function Burst({ burst, ringColor }: { burst: Animated.Value; ringColor: string }) {
  const fade = burst.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });
  const fill = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.pill } as const;
  return (
    <>
      <Animated.View
        style={{
          ...fill, borderWidth: 3, borderColor: ringColor, opacity: fade,
          transform: [{ scaleX: burst.interpolate({ inputRange: [0, 1], outputRange: [1, PULSE_SCALE_X] }) }, { scaleY: burst.interpolate({ inputRange: [0, 1], outputRange: [1, PULSE_SCALE_Y] }) }],
        }}
      />
      {SPARKS.map((s, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', left: '50%', top: '50%', width: 7, height: 7, marginLeft: -3.5, marginTop: -3.5, borderRadius: 4, backgroundColor: ringColor,
            opacity: burst.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.6, 0] }),
            transform: [
              { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, s.x] }) },
              { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, s.y] }) },
              { scale: burst.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) },
            ],
          }}
        />
      ))}
    </>
  );
}
