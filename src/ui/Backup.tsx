import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useRef, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { dayKeyOf } from '../core/day';
import { failureText } from '../core/failure';
import { backupFileName, fileUriToPath } from '../db/backup';
import type { BackupStore } from '../db/sqliteRepo';
import { Button, Card, Help, MessageList, Screen } from './kit';
import { space, type, useTheme } from './theme';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Backup({ store, syncOn }: {
  store: BackupStore;
  /** Sync is on, so the Anki server also holds the collection. */
  syncOn: boolean;
}) {
  const c = useTheme();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  // A second tap while a backup or restore is running would start another one over the first.
  const running = useRef(false);
  const say = (line: string) => setLog((l) => [line, ...l]);

  const run = async (which: 'backup' | 'restore', work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(which);
    try {
      await work();
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  const backUp = () => run('backup', async () => {
    const name = backupFileName(dayKeyOf(new Date()));
    const file = new File(Paths.cache, name);
    try {
      if (file.exists) file.delete();
      const { media } = await store.backupTo(fileUriToPath(file.uri));
      if (!(await Sharing.isAvailableAsync())) {
        say(`Couldn't open the share sheet on this device, so ${name} wasn't saved anywhere.`);
        return;
      }
      await Sharing.shareAsync(file.uri, { UTI: 'public.database', mimeType: 'application/x-sqlite3', dialogTitle: 'Save backup' });
      say(`Made ${name}${media ? `, with ${plural(media, 'image or sound', 'images and sounds')}` : ''}. Choose "Save to Files" to keep it in iCloud Drive or on this iPhone.`);
    } catch (e: any) {
      say(failureText(e, { what: "Couldn't make a backup.", next: 'Try again.' }));
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
          onPress: () => run('restore', async () => {
            try {
              const { notes, cards, media } = await store.restoreFrom(fileUriToPath(asset.uri));
              say(`Restored ${asset.name}: ${plural(notes, 'note', 'notes')}, ${plural(cards, 'card', 'cards')}${media ? `, ${plural(media, 'image or sound', 'images and sounds')}` : ''}.`);
            } catch (e: any) {
              say(failureText(e, { what: `Couldn't restore ${asset.name}.`, next: 'Try again.' }));
            }
          }),
        },
      ],
    );
  };

  return (
    <Screen title="Backup">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Back up</Text>
          <Help>
            {syncOn ? '' : 'Everything is stored only on this iPhone. '}A backup is one file with your decks, cards, review history,
            and the images and sounds imported from Anki. Choose "Save to Files" to keep it in iCloud Drive.
          </Help>
          <Button label="Back up now" onPress={backUp} busy={busy === 'backup'} disabled={busy === 'restore'} />
        </Card>
        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Restore</Text>
          <Help>Replace everything on this iPhone with a backup, for example after reinstalling the app or on a new phone.</Help>
          <Button label="Restore from a backup" variant="secondary" onPress={restore} busy={busy === 'restore'} disabled={busy === 'backup'} />
        </Card>
        <MessageList lines={log} />
      </ScrollView>
    </Screen>
  );
}
