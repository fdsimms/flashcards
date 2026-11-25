import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Api, InputTime } from '../../reader/api';
import { inputRowLabel, inputRows } from '../../reader/inputTime';
import { Card } from '../kit';
import { Reveal } from '../motion';
import { radius, space, type, useTheme } from '../theme';

/**
 * The home's This week card: how long each language was read and listened to over the last 7 days
 * (reader/inputTime.ts), one bar a language split into reading and listening, with when a language
 * that had none was last read. It reports only and sets no goal. Asked each time the home comes
 * into view; a server that can't be reached, or an older one with no such route, shows no card,
 * and so does a learner with one language, who has nothing to compare.
 */
export function ReadInputTime({ api }: { api: Api }) {
  const c = useTheme();
  const [time, setTime] = useState<InputTime | null>(null);

  useFocusEffect(useCallback(() => {
    let live = true;
    api.inputTime().then((t) => { if (live) setTime(t); }, () => { if (live) setTime(null); });
    return () => { live = false; };
  }, [api]));

  const rows = time ? inputRows(time, new Date()) : [];
  if (!time || rows.length < 2) return null;
  return (
    <Reveal>
      <Card style={{ gap: space.m }}>
        <View style={{ gap: space.xs }}>
          <Text accessibilityRole="header" style={{ ...type.headline, color: c.text }}>This week</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{`Time reading and listening, last ${time.days} days`}</Text>
        </View>
        {rows.map((row, i) => (
          <View key={row.language} accessible accessibilityLabel={inputRowLabel(row, time.languages[i])} style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
              <Text style={{ ...type.subhead, color: c.text, flexShrink: 1 }}>{row.name}</Text>
              <Text style={{ ...type.subhead, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{row.total}</Text>
            </View>
            <View style={{ flexDirection: 'row', height: 8, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
              <View style={{ width: `${row.reading * 100}%`, backgroundColor: c.accent }} />
              <View style={{ width: `${row.listening * 100}%`, backgroundColor: c.countDue }} />
            </View>
            {row.note ? <Text style={{ ...type.caption, color: c.textSecondary }}>{row.note}</Text> : null}
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: space.l }}>
          {([['Reading', c.accent], ['Listening', c.countDue]] as const).map(([label, color]) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color }} />
              <Text style={{ ...type.caption, color: c.textSecondary }}>{label}</Text>
            </View>
          ))}
        </View>
      </Card>
    </Reveal>
  );
}
