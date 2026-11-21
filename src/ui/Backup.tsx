import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { dayKeyOf } from '../core/day';
import { failureText } from '../core/failure';
import { backupCardText, backupFileName, backupProgress, BACKUP_REMINDER_DAYS, fileUriToPath, type BackupInfo } from '../db/backup';
import type { Repo } from '../db/repo';
import type { BackupStore } from '../db/sqliteRepo';
import { autoBackupPath, makeAutoBackup } from './autoBackup';
import { AutoBackups } from './AutoBackups';
import { saveBackupReminder, useBackupReminderOn } from './backupReminder';
import { haptic } from './haptics';
import { Button, Card, Group, Help, Icon, MessageList, ProgressBar, Screen, SwitchRow } from './kit';
import { notificationsAllowed } from './studyReminder';
import { radius, readable, smooth, space, type, useTheme } from './theme';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Backup({ store, syncOn, onBackedUp }: {
  store: BackupStore & Pick<Repo, 'collectionSettings'>;
  /** Sync is on, so the Anki server also holds the collection. */
  syncOn: boolean;
  /** A backup was made: the deck list's backup line and the reminders are worked out again. */
  onBackedUp: () => Promise<void>;
}) {
  const c = useTheme();
  const reminderOn = useBackupReminderOn();
  const [info, setInfo] = useState<BackupInfo | null>();
  const [dayStartsAtHour, setDayStartsAtHour] = useState<number>();
  const [progress, setProgress] = useState<{ fraction: number; text: string }>();
  const loadInfo = async () => {
    const [i, collection] = await Promise.all([store.lastBackupInfo(), store.collectionSettings()]);
    setInfo(i);
    setDayStartsAtHour(collection.dayStartsAtHour);
  };
  useEffect(() => { loadInfo().catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
      setProgress(backupProgress({ phase: 'database', done: 0, total: 1 }));
      const { media } = await store.backupTo(fileUriToPath(file.uri), (p) => setProgress(backupProgress(p)));
      setProgress(undefined);
      haptic.success();
      await loadInfo().catch(() => undefined);
      onBackedUp().catch(() => undefined);
      if (!(await Sharing.isAvailableAsync())) {
        say(`Couldn't open the share sheet on this device, so ${name} wasn't saved anywhere.`);
        return;
      }
      const made = `${name}${media ? `, with ${plural(media, 'image or sound', 'images and sounds')}` : ''}`;
      // The instruction has to come before the share sheet: once it's open, the screen behind it can't be read.
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Backup ready',
          `Made ${made}. On the next screen, choose "Save to Files" to keep it in iCloud Drive or on this iPhone.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!proceed) {
        say(`Made ${name}, but it wasn't saved anywhere.`);
        return;
      }
      await Sharing.shareAsync(file.uri, { UTI: 'public.database', mimeType: 'application/x-sqlite3', dialogTitle: 'Save backup' });
      say(`Made ${made}.`);
    } catch (e: any) {
      say(failureText(e, { what: "Couldn't make a backup.", next: 'Try again.' }));
    } finally {
      setProgress(undefined);
    }
  });

  const turnReminder = async (on: boolean) => {
    if (on && !(await notificationsAllowed(true).catch(() => false))) {
      Alert.alert(
        'Notifications are off for Franki',
        'To get a backup reminder, allow notifications for Franki in the Settings app, then turn this on again.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => undefined); } }],
      );
      return;
    }
    try {
      await saveBackupReminder(on);
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };

  const last = info !== undefined && dayStartsAtHour !== undefined ? backupCardText(info, new Date(), dayStartsAtHour) : undefined;

  const restore = async () => {
    let res: Awaited<ReturnType<typeof DocumentPicker.getDocumentAsync>>;
    try {
      res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    } catch (e: any) {
      say(failureText(e, { what: "Couldn't open that file.", next: 'Try again.' }));
      return;
    }
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

  // A copy of what's here now is made first (never pruned by this restore, so the one picked
  // stays), which makes the restore something that can be gone back on from the same list.
  const restoreAutomatic = (name: string, label: string) => {
    Alert.alert(
      `Restore the backup from ${label}?`,
      "Your decks, cards and review history on this iPhone will be replaced by the ones in this backup. Images and sounds stay as they are. A backup of what's here now is made first, so you can go back to it.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: () => run('restore', async () => {
            try {
              await makeAutoBackup(store, {});
              const { notes, cards } = await store.restoreFrom(autoBackupPath(name));
              say(`Restored the backup from ${label}: ${plural(notes, 'note', 'notes')}, ${plural(cards, 'card', 'cards')}.`);
            } catch (e: any) {
              say(failureText(e, { what: `Couldn't restore the backup from ${label}.`, next: 'Try again.' }));
            }
          }),
        },
      ],
    );
  };

  return (
    <Screen title="Backup">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Back up</Text>
          {progress ? (
            <View style={{ gap: space.s }}>
              <ProgressBar value={progress.fraction} label="Progress of the backup" />
              <Text style={{ ...type.body, color: c.textSecondary }}>{progress.text}</Text>
            </View>
          ) : last && (
            <View style={{ flexDirection: 'row', gap: space.m, alignItems: 'flex-start' }}>
              <View style={{ width: 36, height: 36, borderRadius: radius.s + 2, ...smooth, alignItems: 'center', justifyContent: 'center', backgroundColor: last.overdue ? c.warningFill : c.goodFill }}>
                <Icon name={last.overdue ? 'exclamationmark.triangle.fill' : 'checkmark.circle.fill'} color={last.overdue ? c.warningInk : c.goodInk} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.headline, color: last.overdue ? c.warningInk : c.text }}>{last.title}</Text>
                {last.detail ? <Text style={{ ...type.body, color: c.textSecondary }}>{last.detail}</Text> : null}
              </View>
            </View>
          )}
          <Help>
            {syncOn ? '' : 'Everything is stored only on this iPhone. '}A backup is one file with your decks, cards, review history,
            and the images and sounds imported from Anki. Choose "Save to Files" to keep it in iCloud Drive.
          </Help>
          <Button label={busy === 'backup' ? 'Backing up…' : 'Back up now'} onPress={backUp} disabled={busy !== null} />
        </Card>
        <Group>
          <SwitchRow
            first
            label="Remind me to back up"
            hint={reminderOn ? `An evening notification when the last backup is ${BACKUP_REMINDER_DAYS} days old.` : `A notification in the evening once the last backup is ${BACKUP_REMINDER_DAYS} days old.`}
            value={!!reminderOn}
            onValueChange={turnReminder}
          />
        </Group>
        <AutoBackups dayStartsAtHour={dayStartsAtHour} onRestore={restoreAutomatic} disabled={busy !== null} />
        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Restore</Text>
          <Help>Replace everything on this iPhone with a backup, e.g. after reinstalling the app or on a new phone.</Help>
          <Button label="Restore from a backup" variant="secondary" onPress={restore} busy={busy === 'restore'} disabled={busy === 'backup'} />
        </Card>
        <MessageList lines={log} />
      </ScrollView>
    </Screen>
  );
}
