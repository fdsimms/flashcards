import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { daysInMonth, shiftMonth, weekdayOf, type CalendarDate } from '../../tools/date';
import { haptic } from '../haptics';
import { Icon, Tappable } from '../kit';
import { MIN_TAP, radius, space, type, useTheme } from '../theme';
import type { SFSymbol } from 'expo-symbols';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Thursday, November 12, 2026": what VoiceOver reads for a day. */
export function dateLabel(d: CalendarDate): string {
  return `${WEEKDAYS[weekdayOf(d)]}, ${MONTHS[d.month - 1]} ${d.day}, ${d.year}`;
}

/**
 * A month as a calendar: tap a day to choose it, the arrows go back or forward a month, the double
 * arrows a year. The week starts on `weekStartsOn` (0 Sunday, 1 Monday), as calendars do where the
 * language is spoken.
 */
export function CalendarMonth({ date, onChange, weekStartsOn }: { date: CalendarDate; onChange: (d: CalendarDate) => void; weekStartsOn: 0 | 1 }) {
  const c = useTheme();
  const lead = (weekdayOf({ ...date, day: 1 }) - weekStartsOn + 7) % 7;
  const days = daysInMonth(date.year, date.month);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const arrow = (icon: SFSymbol, label: string, by: number) => (
    <Tappable onPress={() => { haptic.select(); onChange(shiftMonth(date, by)); }} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={{ minWidth: 36, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={16} color={c.accent} weight="semibold" />
    </Tappable>
  );
  return (
    <View style={{ gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {arrow('chevron.left.2', 'Previous year', -12)}
        {arrow('chevron.left', 'Previous month', -1)}
        <Text accessibilityRole="header" style={{ ...type.headline, color: c.text, flex: 1, textAlign: 'center' }}>{MONTHS[date.month - 1]} {date.year}</Text>
        {arrow('chevron.right', 'Next month', 1)}
        {arrow('chevron.right.2', 'Next year', 12)}
      </View>
      <View style={{ flexDirection: 'row' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {Array.from({ length: 7 }, (_, i) => (
          <Text key={i} style={{ ...type.caption, fontWeight: '600', color: c.textTertiary, flex: 1, textAlign: 'center' }}>{WEEKDAYS[(i + weekStartsOn) % 7][0]}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((day, i) => {
          if (day === null) return <View key={`blank${i}`} style={{ width: `${100 / 7}%` }} />;
          const selected = day === date.day;
          const d = { ...date, day };
          return (
            <Pressable
              key={day}
              onPress={() => { if (!selected) { haptic.select(); onChange(d); } }}
              accessibilityRole="button"
              accessibilityLabel={dateLabel(d)}
              accessibilityState={{ selected }}
              style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 }}
            >
              <View style={{ minWidth: 38, minHeight: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.accent : 'transparent' }}>
                <Text style={{ ...type.callout, fontVariant: ['tabular-nums'], fontWeight: selected ? '700' : '400', color: selected ? c.onAccent : c.text }}>{day}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
