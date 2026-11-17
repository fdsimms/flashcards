import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import type { RatingValue } from '../core/scheduler';
import { Icon, Tappable } from './kit';
import { useReduceMotion } from './motion';
import { lift, radius, smooth, space, type, useTheme } from './theme';

/**
 * Change a rating you gave too fast: after Hard, Good or Easy, a strip floats over the next card
 * for a few seconds, and one tap replaces that answer with Again (Review undoes it and answers
 * again in one step), or takes it back with Undo (the toolbar's undo, a thumb's reach away). It
 * never reaches the scheduler itself; it only offers the taps.
 */

/** How long the strip stays, and how long its "Changed to Again" confirmation does. */
const OFFER_MS = 5000;
const CHANGED_MS = 2000;

export interface RatingOffer {
  /** A new number each time, so a second answer replaces the strip and restarts its countdown. */
  id: number;
  cardId: string;
  rating: RatingValue;
  /** The interval the answer gave, as the button showed it ("4d"). */
  interval?: string;
  /** The card's word, when its note type has one. */
  word?: string;
  /** Set after the tap, for the short confirmation. */
  changed?: boolean;
}

const NAMES: Record<number, string> = { 2: 'Hard', 3: 'Good', 4: 'Easy' };

/** The strip's state, and its own timeout. `show(null)` takes it away. */
export function useRatingOffer() {
  const [offer, setOffer] = useState<RatingOffer | null>(null);
  const next = useRef(0);
  const show = useCallback((o: Omit<RatingOffer, 'id'> | null) => setOffer(o ? { ...o, id: ++next.current } : null), []);
  useEffect(() => {
    if (!offer) return;
    const id = setTimeout(() => setOffer((o) => (o && o.id === offer.id ? null : o)), offer.changed ? CHANGED_MS : OFFER_MS);
    return () => clearTimeout(id);
  }, [offer?.id, offer?.changed]); // eslint-disable-line react-hooks/exhaustive-deps
  return { offer, show };
}

/**
 * Passed to Screen's `floating`: it sits on the content's bottom edge, just above the footer, over the card's lower edge.
 * It's inset from the card's sides and drawn in `raised`, so it reads as something over the card rather than part of it.
 */
export function ChangeRatingStrip({ offer, onChange, onUndo }: { offer: RatingOffer; onChange: () => void; onUndo: () => void }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const color = offer.changed ? c.again : offer.rating === 2 ? c.hard : offer.rating === 4 ? c.easy : c.good;
  // The line along the bottom drains over the strip's life; with Reduce Motion it just stays.
  const left = useRef(new Animated.Value(1)).current;
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    left.setValue(1);
    if (reduce || offer.changed) return;
    Animated.timing(left, { toValue: 0, duration: OFFER_MS, easing: Easing.linear, useNativeDriver: false }).start();
  }, [offer.id, offer.changed, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: reduce ? 0 : 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [offer.id, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = offer.changed ? 'Changed to Again' : `${NAMES[offer.rating]}${offer.interval ? ` · ${offer.interval}` : ''}`;
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
          flexDirection: 'row', alignItems: 'center', gap: space.m, overflow: 'hidden',
          backgroundColor: c.raised, borderRadius: radius.l, ...smooth, borderWidth: 1, borderColor: c.raisedEdge,
          paddingLeft: space.m + 2, paddingRight: space.s, paddingVertical: space.s, minHeight: 56, ...lift(c, 'high'),
        }}
      >
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={offer.changed ? 'xmark' : offer.rating === 2 ? 'minus' : 'checkmark'} size={13} color={c.onRating} weight="bold" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{title}</Text>
          {offer.word ? <Text numberOfLines={1} style={{ ...type.caption, color: c.textSecondary }}>{offer.word}</Text> : null}
        </View>
        {offer.changed ? null : (
          <Tappable
            onPress={onUndo}
            accessibilityRole="button"
            accessibilityLabel="Undo the last answer"
            scaleTo={0.95}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: space.m, borderRadius: radius.m, ...smooth }}
          >
            <Icon name="arrow.uturn.backward" size={15} color={c.textSecondary} weight="semibold" />
            <Text style={{ ...type.subhead, fontWeight: '600', color: c.textSecondary }}>Undo</Text>
          </Tappable>
        )}
        {offer.changed ? null : (
          <Tappable
            onPress={onChange}
            accessibilityRole="button"
            accessibilityLabel={`Change ${NAMES[offer.rating]} to Again`}
            scaleTo={0.95}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: space.m + 2, borderRadius: radius.m, ...smooth, backgroundColor: c.dangerFill }}
          >
            <Text style={{ ...type.subhead, fontWeight: '600', color: c.danger }}>Again</Text>
          </Tappable>
        )}
        {offer.changed ? null : (
          <Animated.View
            style={{ position: 'absolute', left: 0, bottom: 0, height: 3, backgroundColor: color, opacity: 0.85, width: reduce ? '60%' : left.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }}
          />
        )}
      </View>
    </Animated.View>
  );
}
