import React from 'react';
import { Text, View } from 'react-native';
import { daysInMonth, shiftMonth, weekdayOf, type CalendarDate } from '../../tools/date';
import { sameDate } from '../../tools/dateQuiz';
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
 *
 * The quiz that has you tap the date drives it differently: `selected` is the day tapped (null for
 * none, where it defaults to `date`'s own), `onNavigate` takes the arrows so a tap and a move are
 * told apart, `right` and `wrong` color the answer, and `locked` stops taps once it's answered.
 */
export function CalendarMonth({ date, onChange, weekStartsOn, selected, onNavigate, right, wrong, locked }: {
  date: CalendarDate;
  onChange: (d: CalendarDate) => void;
  weekStartsOn: 0 | 1;
  selected?: CalendarDate | null;
  onNavigate?: (d: CalendarDate) => void;
  right?: CalendarDate;
  wrong?: CalendarDate;
  locked?: boolean;
}) {
  const c = useTheme();
  const chosen = selected === undefined ? date : selected;
  const is = (d: CalendarDate | null | undefined, day: number) => !!d && sameDate(d, { ...date, day });
  const lead = (weekdayOf({ ...date, day: 1 }) - weekStartsOn + 7) % 7;
  const days = daysInMonth(date.year, date.month);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  // Rows of seven, not one wrapping row of cells each 1/7 wide: seven of those can add up to a hair over the width and wrap after six, putting every day under the wrong weekday.
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const arrow = (icon: SFSymbol, label: string, by: number) => (
    <Tappable onPress={() => { haptic.select(); (onNavigate ?? onChange)(shiftMonth(date, by)); }} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
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
          <Text key={i} maxFontSizeMultiplier={2} style={{ ...type.caption, fontWeight: '600', color: c.textSecondary, flex: 1, textAlign: 'center' }}>{WEEKDAYS[(i + weekStartsOn) % 7][0]}</Text>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={w} style={{ flexDirection: 'row' }}>
          {week.map((day, i) => {
            if (day === null) return <View key={`blank${i}`} style={{ flex: 1 }} />;
            const d = { ...date, day };
            const isChosen = is(chosen, day);
            const isRight = is(right, day);
            const isWrong = is(wrong, day);
            const filled = isRight || isWrong || isChosen;
            return (
              <Tappable
                key={day}
                onPress={() => { if (!locked && !isChosen) { haptic.select(); onChange(d); } }}
                disabled={!!locked}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityLabel={`${dateLabel(d)}${isRight ? ', the right date' : isWrong ? ', the date you tapped' : ''}`}
                accessibilityState={{ selected: isChosen, disabled: !!locked }}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TAP, paddingVertical: 2 }}
              >
                <View style={{ minWidth: 38, minHeight: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: isRight ? c.good : isWrong ? c.again : isChosen ? c.accent : 'transparent' }}>
                  <Text maxFontSizeMultiplier={2} style={{ ...type.callout, fontVariant: ['tabular-nums'], fontWeight: filled ? '700' : '400', color: isRight || isWrong ? c.onRating : isChosen ? c.onAccent : c.text }}>{day}</Text>
                </View>
              </Tappable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
