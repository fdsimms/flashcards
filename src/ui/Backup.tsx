import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { dayKeyOf } from '../core/day';
import { backupFileName, fileUriToPath, NotABackupError } from '../db/backup';
import type { BackupStore } from '../db/sqliteRepo';
import { useTheme } from './theme';

export function Backup({ store, onDone }: { store: BackupStore; onDone: () => void }) {
  const t = useTheme();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // A second tap while a backup or restore is running would start another one over the first.
  const running = useRef(false);
  const say = (line: string) => setLog((l) => [line, ...l]);

  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const backUp = () => run(async () => {
    const name = backupFileName(dayKeyOf(new Date()));
    const file = new File(Paths.cache, name);
    try {
      if (file.exists) file.delete();
      await store.backupTo(fileUriToPath(file.uri));
      if (!(await Sharing.isAvailableAsync())) {
        say(`Couldn't open the share sheet on this device, so ${name} wasn't saved anywhere.`);
        return;
      }
      await Sharing.shareAsync(file.uri, { UTI: 'public.database', mimeType: 'application/x-sqlite3', dialogTitle: 'Save backup' });
      say(`Made ${name}. Choose "Save to Files" to keep it in iCloud Drive or on this iPhone.`);
    } catch (e: any) {
      say(`Couldn't make a backup. ${e?.message ?? e}`);
    }
  });

  const restore = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    Alert.alert(
      'Replace everything with this backup?',
      `Your decks, cards and review history on this iPhone will be replaced by the ones in ${asset.name}. This can't be undone, so back up first if you want to keep them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => run(async () => {
            try {
              const { notes, cards } = await store.restoreFrom(fileUriToPath(asset.uri));
              say(`Restored ${asset.name}: ${notes} notes, ${cards} cards.`);
            } catch (e: any) {
              const reason = e instanceof NotABackupError ? e.message : `${e?.message ?? e}`;
              say(`Couldn't restore ${asset.name}. ${reason}`);
            }
          }),
        },
      ],
    );
  };

  const button = { margin: 20, marginBottom: 0, backgroundColor: t.accent, borderRadius: 14, padding: 16, alignItems: 'center' as const, opacity: busy ? 0.5 : 1 };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 56 }}>
      <Pressable onPress={onDone} style={{ paddingHorizontal: 20 }}><Text style={{ color: t.accent, fontSize: 16 }}>‹ Decks</Text></Pressable>
      <Text style={{ color: t.text, fontSize: 28, fontWeight: '700', padding: 20 }}>Backup</Text>
      <Text style={{ color: t.sub, paddingHorizontal: 20 }}>
        Everything is stored only on this iPhone. A backup is one file with your decks, cards and review history. Save it to Files or iCloud Drive, and restore it here if you reinstall the app or move to a new phone.
      </Text>
      <Pressable onPress={backUp} disabled={busy} style={button}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{busy ? 'Working…' : 'Back up now'}</Text>
      </Pressable>
      <Pressable onPress={restore} disabled={busy} style={{ ...button, backgroundColor: t.card, borderColor: t.border, borderWidth: 1 }}>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Restore from a backup</Text>
      </Pressable>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 6 }}>
        {log.map((l, i) => <Text key={i} style={{ color: t.sub }}>{l}</Text>)}
      </ScrollView>
    </View>
  );
}
