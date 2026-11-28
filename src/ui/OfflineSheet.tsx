import React from 'react';
import { ScrollView } from 'react-native';
import { Group, Help, Screen, ValueRow } from './kit';
import { readable, space, useTheme } from './theme';

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
            {lines.map((line, i) => <ValueRow key={line} first={i === 0} label={line} icon={{ name: 'clock', color: c.textSecondary }} />)}
          </Group>
        ) : (
          <Help>Nothing is waiting to be sent.</Help>
        )}
      </ScrollView>
    </Screen>
  );
}
