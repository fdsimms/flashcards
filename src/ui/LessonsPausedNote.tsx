import React from 'react';
import { Text, View } from 'react-native';
import { Card, Icon } from './kit';
import { smooth, space, type, useTheme } from './theme';

/**
 * Said under "Reviews done" when the Apprentice limit is holding lessons back: how many items are
 * at Apprentice against the limit, and what makes lessons start again. The count can be above the
 * limit (a missed item drops back to Apprentice), so it's shown as a number, not a full bar.
 */
export function LessonsPausedNote({ apprentice, limit }: { apprentice: number; limit: number }) {
  const c = useTheme();
  return (
    <Card style={{ alignSelf: 'stretch', marginTop: space.l }}>
      <View
        accessible
        accessibilityLabel={`Lessons paused. ${apprentice} at Apprentice, limit ${limit}. Lessons resume once some of these move up to Guru.`}
        style={{ gap: space.m }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, ...smooth, alignItems: 'center', justifyContent: 'center', backgroundColor: c.warningFill }}>
            <Icon name="pause.fill" size={16} color={c.warningInk} weight="semibold" />
          </View>
          <Text style={{ ...type.headline, color: c.text }}>Lessons paused</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <Text style={{ fontSize: 48, lineHeight: 52, fontWeight: '700', color: c.warningInk, fontVariant: ['tabular-nums'] }}>{apprentice}</Text>
          <View>
            <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>at Apprentice</Text>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>{`limit ${limit}`}</Text>
          </View>
        </View>
        <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21 }}>Lessons resume once some of these move up to Guru.</Text>
      </View>
    </Card>
  );
}
