import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Repo } from '../db/repo';
import { importAnkiJson, type AnkiExport } from '../import/ankiJson';
import { importTsv, type ImportResult } from '../import/tsv';
import { useTheme } from './theme';

export function Import({ repo, onDone }: { repo: Repo; onDone: () => void }) {
  const t = useTheme();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    setBusy(true);
    try {
      const text = await new File(asset.uri).text();
      let result: ImportResult;
      if (asset.name.toLowerCase().endsWith('.json')) {
        result = importAnkiJson(JSON.parse(text) as AnkiExport);
      } else {
        result = importTsv(text);
      }
      await repo.upsertNotesAndCards(result.notes, result.cards);
      setLog((l) => [`${asset.name}: ${result.notes.length} notes, ${result.cards.length} cards`, ...result.warnings.slice(0, 20), ...l]);
    } catch (e: any) {
      setLog((l) => [`${asset.name}: failed — ${e?.message ?? e}`, ...l]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 56 }}>
      <Pressable onPress={onDone} style={{ paddingHorizontal: 20 }}><Text style={{ color: t.accent, fontSize: 16 }}>‹ Decks</Text></Pressable>
      <Text style={{ color: t.text, fontSize: 28, fontWeight: '700', padding: 20 }}>Import</Text>
      <Text style={{ color: t.sub, paddingHorizontal: 20 }}>
        Pick an Anki plain-text TSV export (.txt/.tsv) or a JSON export of notes and cards. Re-importing never resets cards you've already reviewed.
      </Text>
      <Pressable onPress={pick} disabled={busy} style={{ margin: 20, backgroundColor: t.accent, borderRadius: 14, padding: 16, alignItems: 'center', opacity: busy ? 0.5 : 1 }}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{busy ? 'Importing…' : 'Choose file'}</Text>
      </Pressable>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}>
        {log.map((l, i) => <Text key={i} style={{ color: t.sub }}>{l}</Text>)}
      </ScrollView>
    </View>
  );
}
