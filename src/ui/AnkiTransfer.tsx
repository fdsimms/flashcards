import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { deckPackagePreviewText, deckPackageResultLines } from '../anki/apkgMerge';
import { buildPackageForAnki, importCollectionPackage, openDeckPackage, type OpenedDeckPackage } from '../anki/transfer';
import { failureText } from '../core/failure';
import { reviewWrites } from '../core/writeQueue';
import type { AnkiLink, AnkiStatus } from '../db/ankiLink';
import { fileUriToPath } from '../db/backup';
import type { Repo } from '../db/repo';
import type { BackupStore } from '../db/sqliteRepo';
import { importTsv } from '../import/tsv';
import { leaveAnkiNotes, reconcileIds } from '../import/reconcile';
import { Button, Card, Help, MessageList, Screen } from './kit';
import { space, type, useTheme, readable } from './theme';

/** Warnings listed per import. Past this the rest are counted, never dropped silently. */
const MAX_WARNINGS = 20;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Moving the collection between AnkiMobile and Franki: by sync with an Anki server (set up on
 * SyncSettings), or by file: bring it in (a .colpkg from AnkiMobile's Export), and send it back
 * with Franki's answers written into it. A deck package (.apkg) is merged into the collection.
 * With sync on, sending a file back is hidden: it would replace AnkiMobile's collection behind
 * the server's back.
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

  // After Review's pending answers are written, so the unsent count includes them.
  const refresh = useCallback(async () => { await reviewWrites.idle(); setStatus(await repo.ankiStatus()); }, [repo]);
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
      // Holding the kept collection, so neither a sync nor an answer writes it mid-import. Answers
      // Review is still writing go first (outside the lock, which they wait on), or one would land
      // after the import and over the scheduling it brought in.
      await reviewWrites.idle();
      const r = await repo.lockAnki(() => importCollectionPackage(repo, picked));
      const shown = r.warnings.slice(0, MAX_WARNINGS);
      setLog((l) => [
        `Imported ${name}: ${plural(r.notes, 'note', 'notes')}, ${plural(r.cards, 'card', 'cards')}, ${plural(r.media, 'image or sound', 'images and sounds')}.`,
        ...shown,
        ...(r.warnings.length > shown.length ? [`and ${plural(r.warnings.length - shown.length, 'more warning', 'more warnings')}`] : []),
        ...l,
      ]);
    } catch (e: any) {
      say(failureText(e, { what: `Couldn't import ${name}.`, next: 'Try again.' }));
    }
  });

  // A deck package is merged into the collection, not swapped for it: look it over first, then
  // ask, then merge. Nothing is written until Import is tapped.
  const importDeckPackage = (picked: File, name: string) => run('import', async () => {
    let opened: OpenedDeckPackage;
    try {
      await reviewWrites.idle();
      opened = await repo.lockAnki(() => openDeckPackage(repo, picked));
    } catch (e: any) {
      say(failureText(e, { what: `Couldn't import ${name}.`, next: 'Try again.' }));
      return;
    }
    if (!opened.plan.newNotes && !opened.media.add) {
      opened.discard();
      setLog((l) => [...deckPackageResultLines(name, opened.plan, 0, opened.media.kept), ...l]);
      return;
    }
    Alert.alert(`Import ${name}?`, deckPackagePreviewText(opened.plan, opened.media.add, syncOn), [
      { text: 'Cancel', style: 'cancel', onPress: () => opened.discard() },
      { text: 'Import', onPress: () => mergeDeckPackage(opened, name) },
    ]);
  });

  const mergeDeckPackage = (opened: OpenedDeckPackage, name: string) => {
    if (running.current) { opened.discard(); return; }
    run('import', async () => {
      try {
        // Answers Review is still writing go first: the refresh after the merge reads every card's scheduling from Anki's copy.
        await reviewWrites.idle();
        const r = await repo.lockAnki(() => opened.merge());
        setLog((l) => [...deckPackageResultLines(name, r.plan, r.media, r.kept), ...l]);
      } catch (e: any) {
        say(failureText(e, { what: `Couldn't import ${name}.`, next: 'Try again.' }));
      }
    });
  };

  const importTsvFile = (picked: File, name: string) => run('import', async () => {
    try {
      const notes = await repo.listNotes();
      // Anki's decks with their ids, and Franki's own by name, for a deck column that gives a deck's id.
      const decks = [...await repo.ankiDecks(), ...[...new Set(notes.map((n) => n.deck))].map((name) => ({ name }))];
      // A row matching a note from Anki is left alone: this import can't change Anki's copy.
      const cards = await repo.listCards();
      const ankiNotes = new Set(cards.filter((c) => c.ankiId).map((c) => c.noteId));
      // New rows come in after every card there, in file order; a card already here keeps its place.
      const had = new Map(cards.map((c) => [c.id, c.position]));
      const firstPosition = cards.reduce((n, c) => Math.max(n, (c.position ?? -1) + 1), 0);
      const separator = name.toLowerCase().endsWith('.csv') ? ',' : undefined;
      const imported = leaveAnkiNotes(reconcileIds(importTsv(await picked.text(), { noteTypes: await repo.listNoteTypes(), decks, separator, firstPosition }), notes, cards), ankiNotes);
      const result = { ...imported, cards: imported.cards.map((c) => (had.has(c.id) ? { ...c, position: had.get(c.id) } : c)) };
      await repo.upsertNotesAndCards(result.notes, result.cards);
      const shown = result.warnings.slice(0, MAX_WARNINGS);
      setLog((l) => [
        `Imported ${name}: ${plural(result.notes.length, 'note', 'notes')}. These cards aren't in Anki, so they stay in Franki only.`,
        ...shown,
        ...(result.warnings.length > shown.length ? [`and ${plural(result.warnings.length - shown.length, 'more warning', 'more warnings')}`] : []),
        ...l,
      ]);
    } catch (e: any) {
      say(failureText(e, { what: `Couldn't import ${name}.`, next: 'Try again.' }));
    }
  });

  // A failure before an import starts (the picker, reading the collection's state) is said too.
  const pick = () => choose().catch((e) => say(failureText(e, { what: "Couldn't open that file.", next: 'Try again.' })));
  const choose = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    const name = asset.name;
    const lower = name.toLowerCase();
    const picked = new File(asset.uri);

    if (lower.endsWith('.apkg')) {
      importDeckPackage(picked, name);
      return;
    }
    if (lower.endsWith('.db') || lower.endsWith('.sqlite')) {
      const kind = await repo.sqliteFileKind(fileUriToPath(asset.uri)).catch(() => 'other' as const);
      say(kind === 'backup'
        ? `Couldn't import ${name}. It's a backup from Franki. Restore it from the Backup screen instead.`
        : `Couldn't import ${name}. Franki imports a collection (.colpkg) or a deck package (.apkg) exported from Anki.`);
      return;
    }
    // The three extensions Anki's own text import takes (rslib's CSV importer reads them all alike).
    if (lower.endsWith('.txt') || lower.endsWith('.tsv') || lower.endsWith('.csv')) {
      importTsvFile(picked, name);
      return;
    }

    // Anything else is read as a collection package; a file that isn't one is refused with why.
    const current = await repo.ankiStatus();
    if (current.unsent > 0) {
      Alert.alert(
        "Replace answers that aren't in Anki?",
        `Franki has ${plural(current.unsent, 'answer', 'answers')} that ${current.unsent === 1 ? "isn't" : "aren't"} in Anki yet. Importing replaces Franki's collection with this one, and ${current.unsent === 1 ? "it'll be lost. Send to Anki first to keep it." : "they'll be lost. Send to Anki first to keep them."}`,
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
      // Under the lock, so a sync can't commit to the collection while it's being packed. Answers
      // Review is still writing go in first (outside the lock, which they wait on).
      await reviewWrites.idle();
      const out = await repo.lockAnki(() => buildPackageForAnki(repo));
      if (!(await Sharing.isAvailableAsync())) {
        say(`Couldn't open the share sheet on this device, so ${out.name} wasn't sent anywhere.`);
        return;
      }
      await Sharing.shareAsync(out.uri, { mimeType: 'application/octet-stream', dialogTitle: 'Send to Anki' });
      // Franki can't see whether AnkiMobile took the file in, so it asks rather than guess.
      Alert.alert(
        'Did it open in Anki?',
        'Tap Yes once AnkiMobile has imported the file. Franki then marks these answers as sent.',
        [
          { text: 'Not yet', style: 'cancel' },
          {
            text: "Yes, it's in Anki",
            onPress: async () => {
              try {
                await repo.markSentToAnki();
                await refresh();
                say('Sent to Anki.');
              } catch (e) {
                say(failureText(e, { what: "Couldn't mark the answers as sent.", next: 'Send to Anki again, then tap Yes.' }));
              }
            },
          },
        ],
      );
    } catch (e: any) {
      say(failureText(e, { what: "Couldn't make the file for Anki.", next: 'Try again.' }));
    }
  });

  const sentLine = status?.lastSentAt ? ` Last sent ${new Date(status.lastSentAt).toLocaleDateString()}.` : '';
  return (
    <Screen title="Anki">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Sync with your Anki server</Text>
          <Help>
            {syncOn
              ? 'Sync is on. Answers given here go to your Anki server, and changes made in Anki come back.'
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
            {' '}A deck package (.apkg) is added to what Franki has instead, and notes already here keep their progress.
          </Help>
          <Button label="Choose file" onPress={pick} busy={busy === 'import'} disabled={busy === 'send'} />
        </Card>
        {status?.linked && !syncOn ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>Send your answers to Anki</Text>
            <Text style={{ ...type.body, color: status.unsent ? c.warning : c.textSecondary }}>
              {status.unsent
                ? `${plural(status.unsent, 'answer', 'answers')} ${status.unsent === 1 ? "isn't" : "aren't"} in Anki yet.${sentLine}`
                : `Everything studied here is in Anki.${sentLine}`}
            </Text>
            <Help>
              Makes a collection file with every answer given here. Open it in AnkiMobile, which replaces its collection with
              this one, then sync Anki. Don't study in AnkiMobile in between, or what you do there is replaced.
            </Help>
            <Button label="Send to Anki" variant="secondary" onPress={send} busy={busy === 'send'} disabled={busy === 'import'} />
          </Card>
        ) : null}
        <MessageList lines={log} />
      </ScrollView>
    </Screen>
  );
}
