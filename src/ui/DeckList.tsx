import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { DeckSummary } from '../db/repo';
import { useTheme } from './theme';

export function DeckList(props: {
  decks: DeckSummary[];
  onOpen: (deck: string) => void;
  onImport: () => void;
  onBackup: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 64 }}>
      <Text style={{ color: t.text, fontSize: 28, fontWeight: '700', paddingHorizontal: 20, marginBottom: 12 }}>Decks</Text>
      <FlatList
        data={props.decks}
        keyExtractor={(d) => d.deck}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
        ListEmptyComponent={
          <Text style={{ color: t.sub, padding: 20, fontSize: 16 }}>No cards yet. Tap Import to add a TSV or Anki JSON export.</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => props.onOpen(item.deck)}
            style={{ backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 16 }}
          >
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '600' }}>{item.deck}</Text>
            <Text style={{ color: t.sub, marginTop: 6 }}>
              {item.due} due · {item.fresh} new · {item.total} total
            </Text>
          </Pressable>
        )}
      />
      <View style={{ flexDirection: 'row', gap: 10, margin: 16, marginBottom: 36 }}>
        <Pressable
          onPress={props.onImport}
          style={{ flex: 1, backgroundColor: t.accent, borderRadius: 14, padding: 16, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Import</Text>
        </Pressable>
        <Pressable
          onPress={props.onBackup}
          style={{ flex: 1, backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 16, alignItems: 'center' }}
        >
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Backup</Text>
        </Pressable>
      </View>
    </View>
  );
}
