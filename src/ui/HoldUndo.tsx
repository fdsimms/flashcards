import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { Icon, Tappable } from './kit';
import { useReduceMotion } from './motion';
import { lift, radius, smooth, space, type, useTheme } from './theme';

/**
 * After Review's menu buries or suspends cards, the card moves on and a strip floats over the next
 * one for a few seconds with Undo, so a wrong tap doesn't mean opening the note editor. Set Due Date
 * and Forget show it too. Undo takes the action back (Review's `undoAction`), which the header's Undo
 * also does once the strip has gone.
 */

const OFFER_MS = 5000;

export interface HoldOffer {
  /** A new number each time, so a second action replaces the strip and restarts its countdown. */
  id: number;
  /** What was done, as the strip says it ("Buried this note until tomorrow"). */
  label: string;
}

/** The strip's state and its own timeout. `show(null)` takes it away. */
export function useHoldOffer() {
  const [offer, setOffer] = useState<HoldOffer | null>(null);
  const next = useRef(0);
  const show = useCallback((o: Omit<HoldOffer, 'id'> | null) => setOffer(o ? { ...o, id: ++next.current } : null), []);
  useEffect(() => {
    if (!offer) return;
    const id = setTimeout(() => setOffer((o) => (o && o.id === offer.id ? null : o)), OFFER_MS);
    return () => clearTimeout(id);
  }, [offer?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { offer, show };
}

/** Passed to Screen's `floating`: over the card's lower edge, above the footer. */
export function HoldStrip({ offer, onUndo }: { offer: HoldOffer; onUndo: () => void }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: reduce ? 0 : 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [offer.id, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        marginHorizontal: space.l + space.m + 2, marginBottom: space.s,
        opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row', alignItems: 'center', gap: space.m,
          backgroundColor: c.raised, borderRadius: radius.l, ...smooth, borderWidth: 1, borderColor: c.raisedEdge,
          paddingLeft: space.m + 2, paddingRight: space.s, paddingVertical: space.s, minHeight: 56, ...lift(c, 'high'),
        }}
      >
        <Text style={{ ...type.subhead, fontWeight: '600', color: c.text, flex: 1, minWidth: 0 }}>{offer.label}</Text>
        <Tappable
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel={`Undo: ${offer.label}`}
          scaleTo={0.95}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: space.m, borderRadius: radius.m, ...smooth }}
        >
          <Icon name="arrow.uturn.backward" size={15} color={c.textSecondary} weight="semibold" />
          <Text style={{ ...type.subhead, fontWeight: '600', color: c.textSecondary }}>Undo</Text>
        </Tappable>
      </View>
    </Animated.View>
  );
}
