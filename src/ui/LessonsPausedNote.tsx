import React from 'react';
import { Text, View } from 'react-native';
import { Card, Icon } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';

/**
 * Said under "Reviews done" when the Apprentice limit is holding lessons back: how many items are
 * at Apprentice against the limit. The count can be above the
 * limit (a missed item drops back to Apprentice), so the bar runs to the larger of the two and
 * marks the limit on it, with what's past the limit in a darker segment.
 */
export function LessonsPausedNote({ apprentice, limit }: { apprentice: number; limit: number }) {
  const c = useTheme();
  const total = Math.max(apprentice, limit, 1);
  const withinLimit = `${(Math.min(apprentice, limit) / total) * 100}%` as const;
  const limitAt = `${(limit / total) * 100}%` as const;
  const over = apprentice > limit;
  return (
    <Card style={{ alignSelf: 'stretch', marginTop: space.l }}>
      <View
        accessible
        accessibilityLabel={`Lessons paused. ${apprentice} at Apprentice, limit ${limit}.`}
        style={{ gap: space.m }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <View style={{ width: 36, height: 36, borderRadius: radius.s + 2, ...smooth, alignItems: 'center', justifyContent: 'center', backgroundColor: c.warningFill }}>
            <Icon name="pause.fill" size={16} color={c.warningInk} weight="semibold" />
          </View>
          <Text style={{ ...type.headline, color: c.text }}>Lessons paused</Text>
        </View>
        <View style={{ gap: space.s }}>
          <Text style={{ ...type.headline, color: c.text }}>
            <Text style={{ color: c.warningInk, fontVariant: ['tabular-nums'] }}>{apprentice}</Text> at Apprentice
          </Text>
          <View style={{ height: 10, justifyContent: 'center' }}>
            <View style={{ height: 10, borderRadius: radius.pill, ...smooth, overflow: 'hidden', flexDirection: 'row', backgroundColor: c.fill }}>
              <View style={{ width: withinLimit, backgroundColor: c.warning }} />
              {over ? <View style={{ flex: 1, backgroundColor: c.warningInk }} /> : null}
            </View>
            <View style={{ position: 'absolute', left: limitAt, marginLeft: -1, top: -4, bottom: -4, width: 2, borderRadius: 1, backgroundColor: c.text }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>0</Text>
            <Text style={{ ...type.footnote, fontWeight: '600', color: c.text, fontVariant: ['tabular-nums'] }}>{`Limit ${limit}`}</Text>
          </View>
        </View>
      </View>
    </Card>
  );
}
