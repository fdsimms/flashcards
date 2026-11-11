import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { DeckRow } from '../core/deckTree';
import { useTheme } from './theme';

export function DeckList(props: {
  decks: DeckRow[];
  /** When the last backup was made, and whether another is due (`backupStatus`). */
  backup?: { text: string; overdue: boolean };
  onOpen: (deck: string) => void;
  onImport: () => void;
  onBackup: () => void;
  onOptions: (deck: string) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 64 }}>
      <Text style={{ color: t.text, fontSize: 28, fontWeight: '700', paddingHorizontal: 20, marginBottom: 12 }}>Decks</Text>
      <FlatList
        data={props.decks}
        keyExtractor={(d) => d.deck}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 16 }}
        ListEmptyComponent={
          <Text style={{ color: t.sub, padding: 20, fontSize: 16 }}>No cards yet. Tap Import to add your Anki export.</Text>
        }
        renderItem={({ item }) => (
          // A deck sits under its parent, indented; opening a parent studies its subdecks too.
          <Pressable
            onPress={() => props.onOpen(item.deck)}
            style={{
              marginLeft: item.depth * 16, backgroundColor: t.card, borderColor: t.border, borderWidth: 1,
              borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ color: t.text, fontSize: item.depth === 0 ? 18 : 16, fontWeight: '600', flex: 1 }}>{item.name}</Text>
              <Pressable onPress={() => props.onOptions(item.deck)} hitSlop={10} accessibilityLabel={`Options for ${item.name}`}>
                <Text style={{ color: t.accent }}>Options</Text>
              </Pressable>
            </View>
            <Text style={{ color: t.sub, marginTop: 4 }}>
              {item.due} due · {item.fresh} new · {item.total} total
            </Text>
            {item.gate ? (
              // Under the cap, new cards come in; at it, they wait until cards are a week out.
              <Text style={{ color: item.gate.inProgress >= item.gate.cap ? t.hard : t.sub, marginTop: 2 }}>
                {item.gate.inProgress} of {item.gate.cap} in progress
              </Text>
            ) : null}
          </Pressable>
        )}
      />
      {props.backup ? (
        <Pressable onPress={props.onBackup} style={{ paddingHorizontal: 20 }}>
          <Text style={{ color: props.backup.overdue ? t.again : t.sub }}>
            {props.backup.text}{props.backup.overdue ? '. Tap to back up now.' : ''}
          </Text>
        </Pressable>
      ) : null}
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
