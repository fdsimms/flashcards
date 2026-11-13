import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { buildPackageForAnki, importCollectionPackage } from '../anki/transfer';
import { failureText } from '../core/failure';
import type { AnkiLink, AnkiStatus } from '../db/ankiLink';
import { fileUriToPath } from '../db/backup';
import type { Repo } from '../db/repo';
import type { BackupStore } from '../db/sqliteRepo';
import { importTsv } from '../import/tsv';
import { reconcileIds } from '../import/reconcile';
import { Button, Card, Help, MessageList, Screen } from './kit';
import { space, type, useTheme } from './theme';

/** Warnings listed per import. Past this the rest are counted, never dropped silently. */
const MAX_WARNINGS = 20;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Moving the collection between AnkiMobile and Franki: by sync with an Anki server (set up on
 * SyncSettings), or by file: bring it in (a .colpkg from AnkiMobile's Export), and send it back
 * with Franki's answers written into it. With sync on, sending a file back is hidden: it would
 * replace AnkiMobile's collection behind the server's back.
 */
export function AnkiTransfer({ repo, syncOn, onSyncSettings }: {
  repo: Repo & BackupStore & AnkiLink;
  syncOn: boolean;
  onSyncSettings: () => void;
}) {
  const c = useTheme();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<'import' | 'send' | null>(null);
  const [status, setStatus] = useState<AnkiStatus>();
  // A second tap while an import or a send is running would start another over the first.
  const running = useRef(false);
  const say = (line: string) => setLog((l) => [line, ...l]);

  const refresh = useCallback(async () => setStatus(await repo.ankiStatus()), [repo]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (which: 'import' | 'send', work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(which);
    try {
      await work();
    } finally {
      running.current = false;
      setBusy(null);
      await refresh();
    }
  };

  const importPackage = (picked: File, name: string) => run('import', async () => {
    try {
      // Holding the kept collection, so neither a sync nor an answer writes it mid-import.
      const r = await repo.lockAnki(() => importCollectionPackage(repo, picked));
      const shown = r.warnings.slice(0, MAX_WARNINGS);
      setLog((l) => [
        `Imported ${name}: ${plural(r.notes, 'note', 'notes')}, ${plural(r.cards, 'card', 'cards')}, ${plural(r.media, 'image or sound', 'images and sounds')}.`,
        ...shown,
        ...(r.warnings.length > shown.length ? [`and ${r.warnings.length - shown.length} more warnings`] : []),
        ...l,
      ]);
    } catch (e: any) {
      say(failureText(e, { what: `Couldn't import ${name}.`, next: 'Try again.' }));
    }
  });

  const importTsvFile = (picked: File, name: string) => run('import', async () => {
    try {
      const notes = await repo.listNotes();
      // Anki's decks with their ids, and Franki's own by name, for a deck column that gives a deck's id.
      const decks = [...await repo.ankiDecks(), ...[...new Set(notes.map((n) => n.deck))].map((name) => ({ name }))];
      const result = reconcileIds(importTsv(await picked.text(), { noteTypes: await repo.listNoteTypes(), decks }), notes);
      await repo.upsertNotesAndCards(result.notes, result.cards);
      say(`Imported ${name}: ${plural(result.notes.length, 'note', 'notes')}. These cards aren't in Anki, so they stay in Franki only.`);
    } catch (e: any) {
      say(failureText(e, { what: `Couldn't import ${name}.`, next: 'Try again.' }));
    }
  });

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    const name = asset.name;
    const lower = name.toLowerCase();
    const picked = new File(asset.uri);

    if (lower.endsWith('.apkg')) {
      say(`Couldn't import ${name}. A deck package holds only some decks, and answers given here couldn't go back into Anki from it. In AnkiMobile, export your whole collection (.colpkg) instead.`);
      return;
    }
    if (lower.endsWith('.db') || lower.endsWith('.sqlite')) {
      const kind = await repo.sqliteFileKind(fileUriToPath(asset.uri)).catch(() => 'other' as const);
      say(kind === 'backup'
        ? `Couldn't import ${name}. It's a backup from Franki. Restore it from the Backup screen instead.`
        : `Couldn't import ${name}. Franki imports a collection exported from AnkiMobile (.colpkg).`);
      return;
    }
    if (lower.endsWith('.txt') || lower.endsWith('.tsv')) {
      importTsvFile(picked, name);
      return;
    }

    // Anything else is read as a collection package; a file that isn't one is refused with why.
    const current = await repo.ankiStatus();
    if (current.unsent > 0) {
      Alert.alert(
        'Import over answers not in Anki?',
        `Franki has ${plural(current.unsent, 'answer', 'answers')} that aren't in Anki yet. Importing replaces Franki's collection with this one, and they'll be lost. Send to Anki first to keep them.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Import anyway', style: 'destructive', onPress: () => importPackage(picked, name) },
        ],
      );
      return;
    }
    importPackage(picked, name);
  };

  const send = () => run('send', async () => {
    try {
      // Under the lock, so a sync can't commit to the collection while it's being packed.
      const out = await repo.lockAnki(() => buildPackageForAnki(repo));
      if (!(await Sharing.isAvailableAsync())) {
        say(`Couldn't open the share sheet on this device, so ${out.name} wasn't sent anywhere.`);
        return;
      }
      await Sharing.shareAsync(out.uri, { mimeType: 'application/octet-stream', dialogTitle: 'Send to Anki' });
      // Franki can't see whether AnkiMobile took the file in, so it asks rather than guess.
      Alert.alert(
        'Did it open in Anki?',
        'Once AnkiMobile has imported it, Anki has every answer given here, and Franki counts them as sent.',
        [
          { text: 'Not yet', style: 'cancel' },
          { text: "Yes, it's in Anki", onPress: async () => { await repo.markSentToAnki(); await refresh(); say('Sent to Anki.'); } },
        ],
      );
    } catch (e: any) {
      say(failureText(e, { what: "Couldn't make the file for Anki.", next: 'Try again.' }));
    }
  });

  const sentLine = status?.lastSentAt ? ` Last sent ${new Date(status.lastSentAt).toLocaleDateString()}.` : '';
  return (
    <Screen title="Anki">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Sync with your Anki server</Text>
          <Help>
            {syncOn
              ? 'Sync is on. Answers given here go to your Anki server, and changes made in Anki come back, with no files to move.'
              : 'Instead of moving files, Franki can sync with an Anki sync server you run, the way Anki on your other devices does.'}
          </Help>
          <Button label={syncOn ? 'Sync settings' : 'Set up sync'} variant="secondary" onPress={onSyncSettings} />
        </Card>
        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Bring your collection in</Text>
          <Help>
            In AnkiMobile, tap the button at the bottom left of the deck list, choose Export, and pick Collection with media
            included. Save it to Files, then choose it here. It replaces what Franki has, and keeps all of Anki's history.
            {syncOn ? " The next sync then asks whether to keep this collection or the server's." : ''}
          </Help>
          <Button label="Choose file" onPress={pick} busy={busy === 'import'} disabled={busy === 'send'} />
        </Card>
        {status?.linked && !syncOn ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>Send your answers to Anki</Text>
            <Text style={{ ...type.body, color: status.unsent ? c.warning : c.textSecondary }}>
              {status.unsent
                ? `${plural(status.unsent, 'answer', 'answers')} aren't in Anki yet.${sentLine}`
                : `Everything studied here is in Anki.${sentLine}`}
            </Text>
            <Help>
              Makes a collection file with every answer given here. Open it in AnkiMobile, which replaces its collection with
              this one, then sync Anki as usual. Don't study in AnkiMobile in between, or what you do there is replaced.
            </Help>
            <Button label="Send to Anki" variant="secondary" onPress={send} busy={busy === 'send'} disabled={busy === 'import'} />
          </Card>
        ) : null}
        <MessageList lines={log} />
      </ScrollView>
    </Screen>
  );
}
