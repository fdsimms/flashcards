import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import type { DeckRow } from '../core/deckTree';
import { DeckTotalsCard } from './DeckCounts';
import { Button, Card, Group, NavRow } from './kit';
import { SidePanel } from './SidePanel';
import { space, type, useTheme } from './theme';

/**
 * The deck picked on the Decks tab, beside the list on a wide screen (SidePanel.tsx): what's due
 * and new today, Study (the review a tap on the row starts on a phone), its cards and notes by
 * state as Deck counts shows them, and Browse cards and Deck options. Everything is the deck
 * list's own row, so the panel and the list never disagree. The rest of a deck's menu stays on
 * the row's long press and its menu button.
 */
export function DeckPanel({ row, onOptions }: { /** The deck picked; none, and the panel says what it's for. */ row: DeckRow | undefined; onOptions: (deck: string) => void }) {
  const c = useTheme();
  const router = useRouter();
  if (!row) return <SidePanel label="Deck" empty="Tap a deck to see it here." />;
  const figure = (value: number, label: string, color: string) => (
    <View style={{ flex: 1, gap: 2, alignItems: 'center' }}>
      <Text style={{ ...type.title, color: value ? color : c.textDim, fontVariant: ['tabular-nums'] }}>{value.toLocaleString()}</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{label}</Text>
    </View>
  );
  return (
    <SidePanel
      label="Deck"
      empty=""
      footer={<Button label="Study" accessibilityLabel={`Study ${row.name}`} onPress={() => router.push({ pathname: '/review', params: { deck: row.deck } })} />}
    >
      <Text selectable style={{ ...type.cardBack, color: c.text }}>{row.name}</Text>
      <Card>
        <View accessible accessibilityLabel={`${row.due} due today, ${row.fresh} new today`} style={{ flexDirection: 'row', gap: space.m }}>
          {figure(row.due, 'due today', c.countDue)}
          {figure(row.fresh, 'new today', c.countNew)}
        </View>
      </Card>
      {row.totals ? <DeckTotalsCard totals={row.totals} compact /> : null}
      <Group>
        <NavRow first label="Browse cards" onPress={() => router.push({ pathname: '/browse', params: { deck: row.deck } })} />
        <NavRow label="Deck options" onPress={() => onOptions(row.deck)} />
      </Group>
    </SidePanel>
  );
}
