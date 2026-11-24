import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { haptic } from './haptics';
import { Grow } from './motion';
import { hairline, space, type, useTheme } from './theme';

/** Under a chart: the bar tapped, or else the highest one. */
function caption(picked: number | null, peakValue: number, [when, what]: [string, string], peak: string): string {
  if (picked !== null) return `${when}: ${what}`;
  return peakValue === 0 ? 'Nothing yet.' : `${peak}: ${when} (${what})`;
}

const CHART_HEIGHT = 120;

/**
 * One value per day (or per group) as columns from a shared baseline. Tap a column (or move
 * VoiceOver to it) to read its day and value; until then the line under the chart reads the peak.
 * A column can stack an `expected` part, lighter, above its `value`, and carry a `before` mark: a
 * short line at the height the day's total had before a what-if change (the forecast's).
 */
export function Bars<T extends { value: number; expected?: number; before?: number }>({ bars, describe, first, last, peak: peakLabel = 'Busiest day' }: {
  bars: T[];
  /** The day (or group), and what it holds. */
  describe: (d: T, index: number, count: number) => [when: string, what: string];
  first: string;
  last: string;
  /** What the line under the chart calls the highest column. */
  peak?: string;
}) {
  const c = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const totalOf = (d: T) => d.value + (d.expected ?? 0);
  const max = Math.max(1, ...bars.map((d) => Math.max(totalOf(d), d.before ?? 0)));
  const peak = bars.reduce((best, d, i) => (totalOf(d) > totalOf(bars[best]) ? i : best), 0);
  const shown = picked ?? peak;
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{max.toLocaleString()}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 2, borderBottomWidth: hairline, borderColor: c.border }}>
        {bars.map((d, i) => (
          <Pressable
            key={i}
            onPress={() => { haptic.select(); setPicked(i === picked ? null : i); }}
            accessibilityRole="button"
            accessibilityState={{ selected: picked === i }}
            accessibilityLabel={describe(d, i, bars.length).join(': ')}
            style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}
          >
            {totalOf(d) > 0 ? (
              <Grow
                // Grows from the baseline, left to right, the first time the chart is drawn.
                delay={Math.min(i, 30) * 12}
                style={{
                  width: '100%', maxWidth: 24, height: Math.max(2, (totalOf(d) / max) * CHART_HEIGHT),
                  opacity: picked === null || picked === i ? 1 : 0.35,
                }}
              >
                {d.expected ? <View style={{ flex: d.expected, backgroundColor: c.chart, opacity: 0.4, borderTopLeftRadius: 5, borderTopRightRadius: 5 }} /> : null}
                {d.value > 0 ? <View style={{ flex: d.value, backgroundColor: c.chart, ...(d.expected ? null : { borderTopLeftRadius: 5, borderTopRightRadius: 5 }) }} /> : null}
              </Grow>
            ) : null}
            {d.before !== undefined && d.before > 0 ? (
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: (d.before / max) * CHART_HEIGHT - 1, alignItems: 'center' }}>
                <View style={{ width: '100%', maxWidth: 24, height: 2, backgroundColor: c.text }} />
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ ...type.caption, color: c.textSecondary }}>{first}</Text>
        <Text style={{ ...type.caption, color: c.textSecondary }}>{last}</Text>
      </View>
      <Text style={{ ...type.subhead, color: c.text }}>{caption(picked, totalOf(bars[peak]), describe(bars[shown], shown, bars.length), peakLabel)}</Text>
    </View>
  );
}
