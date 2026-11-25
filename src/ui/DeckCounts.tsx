import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { TOTALS_LABELS } from '../core/deckTotals';
import type { DeckRow } from '../core/deckTree';
import { Card, Help, Screen } from './kit';
import { readable, space, type, useTheme } from './theme';

/**
 * A deck's cards and notes by state (Deck counts, on the deck's menu): new and not suspended first,
 * then learning, young, mature, suspended and buried, for the deck and its subdecks. Read from the
 * deck list's own row (`deckRows`), so it agrees with the line under the deck's name.
 */
export function DeckCounts({ row }: { row?: DeckRow }) {
  const c = useTheme();
  const t = row?.totals;
  return (
    <Screen title={row?.name ?? 'Deck counts'}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {!t ? <Help>This deck isn't in the deck list. Go back and open it again.</Help> : (
          <>
            <Card>
              <View style={{ flexDirection: 'row', gap: space.m }}>
                <Text style={{ ...type.footnote, color: c.textSecondary, flex: 1 }}>With its subdecks</Text>
                <Text style={{ ...type.footnote, color: c.textSecondary, width: 64, textAlign: 'right' }}>Notes</Text>
                <Text style={{ ...type.footnote, color: c.textSecondary, width: 64, textAlign: 'right' }}>Cards</Text>
              </View>
              {TOTALS_LABELS.map(({ key, label, hint }) => (
                <View key={key} accessible accessibilityLabel={`${label}: ${t[key].notes} notes, ${t[key].cards} cards`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.body, color: c.text }}>{label}</Text>
                    {hint ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text> : null}
                  </View>
                  <Text style={{ ...type.body, color: c.text, width: 64, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{t[key].notes.toLocaleString()}</Text>
                  <Text style={{ ...type.body, color: c.text, width: 64, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{t[key].cards.toLocaleString()}</Text>
                </View>
              ))}
            </Card>
            <Help>A note is counted in every state one of its cards is in, so a deck's notes can add up to more than it has.</Help>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
