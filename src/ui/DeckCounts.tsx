import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { TOTALS_LABELS, type DeckTotals } from '../core/deckTotals';
import { waitingForWord } from '../core/reverseHold';
import type { Repo } from '../db/repo';
import type { DeckRow } from '../core/deckTree';
import { Card, Help, Screen } from './kit';
import { readable, space, type, useTheme } from './theme';

/**
 * A deck's cards and notes by state, one row each: Deck counts' table, and the Decks tab's panel
 * on a wide screen (DeckPanel.tsx), where `compact` leaves out each state's explanation and
 * narrows the columns to fit.
 */
export function DeckTotalsCard({ totals: t, compact = false, waiting }: {
  totals: DeckTotals;
  compact?: boolean;
  /** New cards waiting for their word (`waitingForWord`), shown under New when there are any. */
  waiting?: { notes: number; cards: number };
}) {
  const c = useTheme();
  const column = compact ? 52 : 64;
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: space.m }}>
        <Text style={{ ...type.footnote, color: c.textSecondary, flex: 1 }}>With its subdecks</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary, width: column, textAlign: 'right' }}>Notes</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary, width: column, textAlign: 'right' }}>Cards</Text>
      </View>
      {TOTALS_LABELS.map(({ key, label, hint }) => (
        <View key={key} accessible accessibilityLabel={`${label}: ${t[key].notes} notes, ${t[key].cards} cards`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.body, color: c.text }}>{label}</Text>
            {hint && !compact ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text> : null}
          </View>
          <Text style={{ ...type.body, color: c.text, width: column, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{t[key].notes.toLocaleString()}</Text>
          <Text style={{ ...type.body, color: c.text, width: column, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{t[key].cards.toLocaleString()}</Text>
        </View>
      )).flatMap((rowNode, i) => (TOTALS_LABELS[i].key === 'new' && waiting?.cards ? [rowNode, (
        <View key="waiting" accessible accessibilityLabel={`Waiting for their word: ${waiting.notes} notes, ${waiting.cards} cards`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.body, color: c.text }}>Waiting for their word</Text>
            {compact ? null : <Text style={{ ...type.footnote, color: c.textSecondary }}>Of the new cards, held back for now. AnkiMobile and Anki show them.</Text>}
          </View>
          <Text style={{ ...type.body, color: c.text, width: column, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{waiting.notes.toLocaleString()}</Text>
          <Text style={{ ...type.body, color: c.text, width: column, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{waiting.cards.toLocaleString()}</Text>
        </View>
      )] : [rowNode]))}
    </Card>
  );
}

/**
 * A deck's cards and notes by state (Deck counts, on the deck's menu): new and not suspended first,
 * then learning, young, mature, suspended and buried, for the deck and its subdecks. Read from the
 * deck list's own row (`deckRows`), so it agrees with the line under the deck's name.
 */
export function DeckCounts({ row, repo }: { row?: DeckRow; repo: Pick<Repo, 'listCards' | 'listNotes'> }) {
  const c = useTheme();
  const t = row?.totals;
  // New reverse and listening cards held until their word is recognized: the deck's own count leaves them out.
  const [waiting, setWaiting] = useState<{ deck: string; notes: number; cards: number }>();
  const deck = row?.deck;
  useEffect(() => {
    if (!deck) return;
    let live = true;
    Promise.all([repo.listCards(), repo.listNotes()]).then(([cards, notes]) => {
      if (live) setWaiting({ deck, ...waitingForWord(deck, cards, notes) });
    }, () => undefined);
    return () => { live = false; };
  }, [repo, deck]);
  return (
    <Screen title={row?.name ?? 'Deck counts'}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {!t ? <Help>This deck isn't in the deck list. Go back and open it again.</Help> : (
          <>
            <DeckTotalsCard totals={t} waiting={waiting?.deck === deck ? waiting : undefined} />
            {waiting && waiting.deck === deck && waiting.cards ? <Help>{"New reverse and listening cards wait until their word's own card is recognized, then come in as new cards."}</Help> : null}
            <Help>A note is counted in every state one of its cards is in, so a deck's notes can add up to more than it has.</Help>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
