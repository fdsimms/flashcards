import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import type { Calendar, CalendarDay } from '../core/stats';
import { Card as Box, Help } from './kit';
import { haptic } from './haptics';
import { type, space, useTheme } from './theme';

/** A day's square and the gap between squares, in points. Squares hold no text, so they don't grow with the text size. */
const CELL = 14;
const GAP = 3;

const answersText = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'answer' : 'answers'}`;
const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Answers per study day over the last year, as Anki's Calendar shows them: a column per week,
 * Sunday at the top, a darker square for more answers. Wider than the screen, so it scrolls
 * sideways and opens at today. Tap a square (or move VoiceOver to it) to read its day.
 */
export function AnswerCalendar({ calendar }: { calendar: Calendar }) {
  const c = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const onPick = useCallback((key: string) => { haptic.select(); setPicked((p) => (p === key ? null : key)); }, []);

  // A label over the week each month starts in, dropped where the month is too narrow to fit it.
  const months = useMemo(() => {
    const out: { weeks: number; label: string }[] = [];
    calendar.weeks.forEach((week, i) => {
      const first = week.find((d) => d?.start.getDate() === 1);
      if (i === 0 || first) out.push({ weeks: 0, label: (first ?? week.find((d) => d))!.start.toLocaleDateString(undefined, { month: 'short' }) });
      out[out.length - 1].weeks++;
    });
    return out.map((m) => (m.weeks < 2 ? { ...m, label: '' } : m));
  }, [calendar]);

  const days = calendar.weeks.flat();
  const pickedDay = picked === null ? undefined : days.find((d) => d?.key === picked);
  const { busiest } = calendar;
  const caption = pickedDay ? `${dayLabel(pickedDay.start)}: ${answersText(pickedDay.answers)}`
    : busiest ? `Busiest day: ${dayLabel(busiest.start)} (${answersText(busiest.answers)})` : 'Nothing yet.';

  return (
    <Box>
      <Text style={{ ...type.headline, color: c.text }}>Answers in the last year</Text>
      <View style={{ gap: space.xs }}>
        <ScrollView
          ref={scroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          <View style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              {months.map((m, i) => (
                <Text key={i} numberOfLines={1} style={{ ...type.caption, color: c.textSecondary, width: m.weeks * (CELL + GAP) }}>{m.label}</Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: GAP }}>
              {calendar.weeks.map((week, i) => (
                <Week key={i} week={week} picked={week.some((d) => d?.key === picked) ? picked : null} onPick={onPick} />
              ))}
            </View>
          </View>
        </ScrollView>
        <View
          accessible
          accessibilityLabel="Shades run from fewest answers to most"
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: GAP }}
        >
          <Text style={{ ...type.caption, color: c.textSecondary, marginRight: space.xs }}>Fewer</Text>
          {[c.fill, ...c.heat].map((color) => (
            <View key={color} style={{ width: CELL, height: CELL, borderRadius: 3, backgroundColor: color }} />
          ))}
          <Text style={{ ...type.caption, color: c.textSecondary, marginLeft: space.xs }}>More</Text>
        </View>
        <Text style={{ ...type.subhead, color: c.text }}>{caption}</Text>
      </View>
      <Help>
        {calendar.total
          ? `Studied on ${calendar.studied.toLocaleString()} of ${calendar.days.toLocaleString()} days: ${answersText(calendar.total)}, `
            + `${Math.round(calendar.total / calendar.studied).toLocaleString()} a day on the days studied.`
          : 'Nothing answered in this time.'}
      </Help>
    </Box>
  );
}

/** One week's column. Memoized, so tapping a day redraws only the weeks it changes. */
const Week = memo(function Week({ week, picked, onPick }: {
  week: (CalendarDay | null)[];
  /** The picked day's key, when it's in this week. */
  picked: string | null;
  onPick: (key: string) => void;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: GAP }}>
      {week.map((d, i) => (d === null ? <View key={i} style={{ width: CELL, height: CELL }} /> : (
        <Pressable
          key={d.key}
          onPress={() => onPick(d.key)}
          hitSlop={GAP / 2}
          accessibilityRole="button"
          accessibilityState={{ selected: picked === d.key }}
          accessibilityLabel={`${dayLabel(d.start)}: ${answersText(d.answers)}`}
          style={{
            width: CELL, height: CELL, borderRadius: 3,
            backgroundColor: d.level ? c.heat[d.level - 1] : c.fill,
            borderWidth: picked === d.key ? 2 : 0, borderColor: c.text,
          }}
        />
      )))}
    </View>
  );
});
