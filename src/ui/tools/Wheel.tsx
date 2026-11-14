import React, { useEffect, useRef } from 'react';
import { ScrollView, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { haptic } from '../haptics';
import { space, type, useTheme } from '../theme';

/** A wheel's row height: 40 points at the standard text size, growing with it up to twice that. */
export function useWheelRow(): number {
  const { fontScale } = useWindowDimensions();
  return Math.ceil(40 * wheelScale(fontScale));
}

/** How much a wheel grows with the system text size: not below normal, at most double. */
export const wheelScale = (fontScale: number) => Math.min(Math.max(fontScale, 1), 2);

/**
 * A picker wheel, the way iOS's own time picker scrolls: rows snap to the middle, the one there is
 * the value, and each row crossing the middle ticks. VoiceOver adjusts it a step at a time.
 * Rows have a fixed height, which snapping needs, so it's sized from the system text size and
 * the digits stop growing at twice their size.
 */
export function Wheel({ count, value, onChange, label, format = (i) => String(i).padStart(2, '0'), width = 64 }: {
  /** Values 0 to count - 1. */
  count: number;
  value: number;
  onChange: (value: number) => void;
  label: string;
  format?: (value: number) => string;
  width?: number;
}) {
  const c = useTheme();
  const row = useWheelRow();
  const scroll = useRef<ScrollViewInstance>(null);
  /** The value under the middle as last scrolled to, so a change from outside scrolls and one from here doesn't. */
  const shown = useRef(value);
  const ticked = useRef(value);
  /** Under the finger, or coasting from it: only then does a row tick, not while Another one scrolls it. */
  const dragging = useRef(false);

  useEffect(() => {
    // No guard for a drag in progress: a drag only changes `value` once it settles (which sets
    // `shown` first), so a differing value here always came from outside and the wheel must follow it.
    // Guarding on `dragging` left the wheel between rows when a drag's end event never arrived.
    if (value === shown.current) return;
    shown.current = value;
    ticked.current = value;
    scroll.current?.scrollTo({ y: value * row, animated: true });
  }, [value, row]);

  const at = (e: NativeSyntheticEvent<NativeScrollEvent>) => Math.min(count - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / row)));
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    dragging.current = false;
    const i = at(e);
    // Resting between rows (a snap that didn't land) reads as the wrong value: pull it onto the row.
    if (e.nativeEvent.contentOffset.y !== i * row) scroll.current?.scrollTo({ y: i * row, animated: true });
    if (i === shown.current) return;
    shown.current = i;
    onChange(i);
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange((value + (e.nativeEvent.actionName === 'increment' ? 1 : count - 1)) % count)}
      style={{ width, height: row * 3 }}
    >
      <ScrollView
        ref={scroll}
        showsVerticalScrollIndicator={false}
        snapToInterval={row}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: value * row }}
        contentContainerStyle={{ paddingVertical: row }}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => { dragging.current = true; }}
        onScroll={(e) => { const i = at(e); if (dragging.current && i !== ticked.current) { ticked.current = i; haptic.select(); } }}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={(e) => { if (!e.nativeEvent.velocity?.y) settle(e); }}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={{ height: row, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs }}>
            <Text
              maxFontSizeMultiplier={2}
              style={{ ...type.title, fontSize: 28, fontVariant: ['tabular-nums'], color: i === value ? c.text : c.textTertiary }}
            >
              {format(i)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** The band behind a row of wheels' middle row, where the chosen values sit. */
export function WheelBand({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  const row = useWheelRow();
  return (
    <View style={{ justifyContent: 'center' }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, height: row, borderRadius: 10, backgroundColor: c.fill }} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>{children}</View>
    </View>
  );
}
