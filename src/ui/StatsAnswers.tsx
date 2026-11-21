import React from 'react';
import { Text, View } from 'react-native';
import { MATURE_DAYS, percent, type AnswerButtons, type ButtonCounts, type HourAnswers, type Rate, type RetentionRow } from '../core/stats';
import { Card as Box, Help } from './kit';
import { Bars } from './StatsBars';
import { hairline, space, type, useTheme } from './theme';

const BUTTONS = ['Again', 'Hard', 'Good', 'Easy'] as const;

/** An hour on the clock as people say it: "7 AM", "12 PM". */
function hourText(hour: number): string {
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * How often each answer button was pressed over the range chosen, as Anki's Answer Buttons graph
 * splits them (`answerButtons`, src/core/stats.ts): a bar per group in the buttons' own colors,
 * each button's count under it.
 */
export function AnswerButtonsBox({ buttons, range }: { buttons: AnswerButtons; range: string }) {
  const c = useTheme();
  const fills = [c.again, c.hard, c.good, c.easy];
  const groups: [string, ButtonCounts][] = [['Learning', buttons.learning], ['Young', buttons.young], ['Mature', buttons.mature]];
  return (
    <Box>
      <Text style={{ ...type.headline, color: c.text }}>Answer buttons</Text>
      {groups.map(([label, g]) => {
        const p = percent({ passed: g.passed, total: g.total });
        return (
          <View
            key={label}
            accessible
            accessibilityLabel={`${label}: ${g.total ? BUTTONS.map((b, i) => `${b} ${g.pressed[i].toLocaleString()}`).join(', ') : 'no answers'}`}
            style={{ gap: space.xs }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
              <Text style={{ ...type.body, color: c.text, flex: 1 }}>{label}</Text>
              <Text style={{ ...type.body, color: c.text, fontVariant: ['tabular-nums'] }}>{p === null ? 'No answers' : `${p}% not Again`}</Text>
              {p === null ? null : <Text style={{ ...type.footnote, color: c.textSecondary }}>of {g.total.toLocaleString()}</Text>}
            </View>
            <View style={{ flexDirection: 'row', height: 14, gap: g.total ? 1 : 0, borderRadius: 4, overflow: 'hidden', backgroundColor: c.fill }}>
              {g.pressed.map((n, i) => (n ? <View key={i} style={{ flex: n, backgroundColor: fills[i] }} /> : null))}
            </View>
            <Text style={{ ...type.caption, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>
              {BUTTONS.map((b, i) => `${b} ${g.pressed[i].toLocaleString()}`).join(' · ')}
            </Text>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.m }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {BUTTONS.map((b, i) => (
          <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: fills[i] }} />
            <Text style={{ ...type.caption, color: c.textSecondary }}>{b}</Text>
          </View>
        ))}
      </View>
      <Help>
        How often each button was pressed in the last {range}. Young and mature are reviews of cards whose interval
        before the answer was under or over {MATURE_DAYS} days.
      </Help>
    </Box>
  );
}

/** Answers by the hour of the day over the range chosen (`answersByHour`), the study day's first hour on the left. */
export function HoursBox({ hours, range }: { hours: HourAnswers[]; range: string }) {
  const c = useTheme();
  const what = (h: HourAnswers) => {
    const p = percent(h);
    return `${h.total.toLocaleString()} ${h.total === 1 ? 'answer' : 'answers'}${p === null ? '' : `, ${p}% not Again`}`;
  };
  return (
    <Box>
      <Text style={{ ...type.headline, color: c.text }}>By hour of the day</Text>
      <Bars
        bars={hours.map((h) => ({ ...h, value: h.total }))}
        describe={(h) => [hourText(h.hour), what(h)]}
        first={hourText(hours[0].hour)} last={hourText(hours[hours.length - 1].hour)} peak="Busiest hour"
      />
      <Help>
        Answers in the last {range} by the hour they were given. The day runs from {hourText(hours[0].hour)}, when the study day starts.
      </Help>
    </Box>
  );
}

/**
 * Anki's True Retention table (`trueRetention`): reviews not answered Again by period, young and
 * mature apart. WaniKani's items have no intervals, so for it only the All column shows.
 */
export function RetentionTable({ rows, splitByAge }: { rows: RetentionRow[]; splitByAge: boolean }) {
  const c = useTheme();
  const columns: [string, (r: RetentionRow) => Rate][] = splitByAge
    ? [['Young', (r) => r.young], ['Mature', (r) => r.mature], ['All', (r) => r.all]]
    : [['All', (r) => r.all]];
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingBottom: space.xs }}>
        <View style={{ flex: 1.4 }} />
        {columns.map(([label]) => (
          <Text key={label} style={{ ...type.footnote, color: c.textSecondary, flex: 1, textAlign: 'right' }}>{label}</Text>
        ))}
      </View>
      {rows.map((r) => (
        <View
          key={r.label}
          accessible
          accessibilityLabel={`${r.label}: ${columns.map(([label, rate]) => `${label} ${rateText(rate(r))}`).join(', ')}`}
          style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.s - 2, borderTopWidth: hairline, borderColor: c.border }}
        >
          <Text style={{ ...type.body, color: c.text, flex: 1.4 }}>{r.label}</Text>
          {columns.map(([label, rate]) => {
            const v = rate(r);
            const p = percent(v);
            return (
              <View key={label} style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={{ ...type.body, color: p === null ? c.textSecondary : c.text, fontVariant: ['tabular-nums'] }}>{p === null ? '–' : `${p}%`}</Text>
                {p === null ? null : <Text style={{ ...type.caption, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>of {v.total.toLocaleString()}</Text>}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function rateText(r: Rate): string {
  const p = percent(r);
  return p === null ? 'no reviews' : `${p}% of ${r.total.toLocaleString()}`;
}
