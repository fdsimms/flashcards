import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Group, Help, Icon, Screen } from './kit';
import { hairline, MIN_TAP, readable, space, type, useTheme } from './theme';

/**
 * What the header's Offline button (no Wi-Fi, or a cloud with a warning) opens (Screen in kit.tsx): what's waiting for the connection,
 * one line each (`waitingLines`), all of it sent by itself when the connection comes back.
 */
export function OfflineSheet({ problem, lines }: { problem: 'offline' | 'server' | null; lines: string[] }) {
  const c = useTheme();
  return (
    <Screen title={problem === 'server' ? "Can't reach your server" : 'Offline'} largeTitle={false} offlineButton={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        <Help>
          {problem === 'offline'
            ? "You can keep studying, and Franki sends what's waiting when you're back online."
            : problem === 'server'
              ? "Your server may be down, or its address may have changed (Settings, Anki). You can keep studying, and Franki sends what's waiting when your server answers again."
              : "You're back online. Franki is sending what was waiting."}
        </Help>
        {lines.length ? (
          <Group accessibilityRole="list">
            {lines.map((line, i) => (
              <View key={line} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP, paddingVertical: space.m, paddingHorizontal: space.l, borderTopWidth: i ? hairline : 0, borderTopColor: c.border }}>
                <Icon name="clock" size={18} color={c.textSecondary} />
                <Text style={{ ...type.body, color: c.text, flex: 1 }}>{line}</Text>
              </View>
            ))}
          </Group>
        ) : (
          <Help>Nothing is waiting to be sent.</Help>
        )}
      </ScrollView>
    </Screen>
  );
}
