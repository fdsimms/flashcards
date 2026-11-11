import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Repo } from '../db/repo';
import { importAnkiJson, type AnkiExport } from '../import/ankiJson';
import { importTsv, type ImportResult } from '../import/tsv';
import { useTheme } from './theme';

/** Warnings listed per import. Past this the rest are counted, never dropped silently. */
const MAX_WARNINGS = 20;

export function Import({ repo, onDone }: { repo: Repo; onDone: () => void }) {
  const t = useTheme();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    const name = asset.name.toLowerCase();
    // A package is a zip, so read as text it would fail the TSV parser with a message about
    // headers. Say what the file is and what to export instead.
    if (name.endsWith('.apkg') || name.endsWith('.colpkg')) {
      setLog((l) => [
        `Couldn't import ${asset.name}. Anki package files can't be read yet. In Anki, export as "Notes in Plain Text" or use a JSON export instead.`,
        ...l,
      ]);
      return;
    }
    setBusy(true);
    try {
      const text = await new File(asset.uri).text();
      let result: ImportResult;
      if (name.endsWith('.json')) {
        result = importAnkiJson(JSON.parse(text) as AnkiExport);
      } else {
        result = importTsv(text);
      }
      await repo.upsertNotesAndCards(result.notes, result.cards);
      const shown = result.warnings.slice(0, MAX_WARNINGS);
      const hidden = result.warnings.length - shown.length;
      setLog((l) => [
        `${asset.name}: ${result.notes.length} notes, ${result.cards.length} cards`,
        ...shown,
        ...(hidden > 0 ? [`and ${hidden} more warnings`] : []),
        ...l,
      ]);
    } catch (e: any) {
      setLog((l) => [`Couldn't import ${asset.name}. ${e?.message ?? e}`, ...l]);
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
