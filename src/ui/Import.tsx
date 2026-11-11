import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Repo } from '../db/repo';
import type { BackupStore } from '../db/sqliteRepo';
import { importAnkiJson, type AnkiExport } from '../import/ankiJson';
import { fileUriToPath } from '../db/backup';
import { reconcileIds } from '../import/reconcile';
import { importTsv, type ImportResult } from '../import/tsv';
import { useTheme } from './theme';

/** Warnings listed per import. Past this the rest are counted, never dropped silently. */
const MAX_WARNINGS = 20;

/** SQLite files: the exporter's bundle (.sqlite), or a backup picked here by mistake (.db). */
const SQLITE = /\.(sqlite|db)$/i;

export function Import({ repo, onDone }: { repo: Repo & BackupStore; onDone: () => void }) {
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
        `Couldn't import ${asset.name}. Anki package files can't be read here. Run scripts/export-anki.mjs on your computer and import the file it makes.`,
        ...l,
      ]);
      return;
    }
    setBusy(true);
    try {
      let result: ImportResult;
      let media = 0;
      if (SQLITE.test(name)) {
        // Told apart by what's inside, not the extension: a backup renamed .sqlite is still a backup.
        const path = fileUriToPath(asset.uri);
        const kind = await repo.sqliteFileKind(path);
        if (kind === 'backup') throw new Error('It looks like a backup from this app. Restore it from the Backup screen instead.');
        if (kind === 'other') throw new Error("It isn't an export from scripts/export-anki.mjs.");
        const bundle = await repo.readExportBundle(path);
        media = bundle.media;
        result = importAnkiJson(JSON.parse(bundle.json) as AnkiExport);
      } else {
        const text = await new File(asset.uri).text();
        result = name.endsWith('.json')
          ? importAnkiJson(JSON.parse(text) as AnkiExport)
          : importTsv(text, { noteTypes: await repo.listNoteTypes() });
      }
      result = reconcileIds(result, await repo.listNotes());
      // Note types first: a card whose template is missing falls back to plain text.
      if (result.noteTypes?.length) await repo.saveNoteTypes(result.noteTypes);
      await repo.upsertNotesAndCards(result.notes, result.cards);
      if (result.deckParams?.size) await repo.saveDeckParams(result.deckParams);
      const shown = result.warnings.slice(0, MAX_WARNINGS);
      const hidden = result.warnings.length - shown.length;
      setLog((l) => [
        `${asset.name}: ${result.notes.length} notes, ${result.cards.length} cards` +
          (result.noteTypes?.length ? `, ${result.noteTypes.length} note types` : '') +
          (result.deckParams?.size ? `, settings for ${result.deckParams.size} decks` : '') +
          (media ? `, ${media} images and sounds` : ''),
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
        Pick the anki-export.sqlite file made by scripts/export-anki.mjs on your computer. It keeps Anki's scheduling, each deck's limits, how each note type's cards look, and their images and sounds. An Anki plain-text export (.txt/.tsv) also works, but starts every card as new. Re-importing never resets cards you've already reviewed, and finds notes you already have even if their deck changed.
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
