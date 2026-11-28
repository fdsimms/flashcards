import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { recordNote } from '../anki/recordService';
import { failureText } from '../core/failure';
import { afterSend, sendHeld } from '../core/held';
import { afterWordsSent, type HeldWords } from '../reader/heldNotes';
import { useApp } from './AppContext';
import { connection, useBackOnline } from './connection';
import type { HeldReaderAction } from '../reader/downloads';
import { heldJournal, heldReader, heldRecordings, heldWords } from './held';
import { afterEntriesSent, type HeldEntry } from '../reader/journal';
import { markCaseMistakes } from './journal/journalWork';
import { queueWords } from './useNoteQueue';
import { useRecorder } from './useRecorder';

/**
 * Sends what was held while offline (src/core/held.ts): Read & Listen's language switches, readings,
 * listens and story choices (in order, so a choice goes before its reading), words to the note queue for Claude,
 * journal entries to be checked, and new notes' recordings. It runs at launch and each time the connection comes back. Drawn once,
 * under AppProvider (src/app/_layout.tsx), and draws nothing.
 *
 * Words the server refuses stay on the queue screen with its reason, and are tried again next
 * time. A recording the server refuses is dropped with an alert saying so and how to record it by
 * hand, as a failed recording at save always was.
 */
export function HeldWork() {
  const { reader } = useApp();
  const api = reader.api;
  const server = reader.serverApi;
  const recorder = useRecorder();
  const sending = useRef(false);
  // Asked for while a send was running (the connection dropped and came back during it, or the
  // servers' APIs became ready): run once more when it ends, or what it left waits for the next launch.
  const again = useRef(false);
  const latest = useRef<() => Promise<void>>(async () => {});

  const send = useCallback(async () => {
    if (sending.current) {
      again.current = true;
      return;
    }
    if (connection.cantReachHome()) return;
    sending.current = true;
    try {
      await Promise.all([heldWords.load(), heldRecordings.load(), heldReader.load(), heldJournal.load()]);

      // Straight to the server, not through the offline answers, which would hold them again.
      const actions = heldReader.get();
      if (server && actions.length) {
        const result = await sendHeld(actions, (a: HeldReaderAction) => (
          a.kind === 'reading' ? server.logReading(a.textId, a.log) : a.kind === 'listen' ? server.logListen(a.textId, a.seconds, a.key)
            : a.kind === 'choice' ? server.chooseNext(a.textId, a.choice) : a.kind === 'lessonHeard' ? server.lessonHeard(a.lessonId) : server.updateSettings({ language: a.language }).then(() => undefined)
        ));
        // One the server refuses has nothing left to do: the text was deleted (404), or its episode
        // was read before the choice arrived (409). Held while this ran are kept as they are.
        await heldReader.update((list) => afterSend(list, actions, result.left));
      }

      const words = heldWords.get();
      if (api && words.length) {
        const result = await sendHeld(words, (g: HeldWords) => queueWords(api, g.language, g.deck, g.entries));
        const refused = result.refused.map(({ item, error }) => ({ item, problem: failureText(error, { next: 'Try again later, or remove them.' }) }));
        // Words held while this ran are kept as they are.
        await heldWords.update((list) => afterWordsSent(list, words, result.left, refused));
      }

      // Each entry is checked by Claude as it arrives; its `key` keeps one sent twice from being checked twice.
      // One the server refused waits in the journal for a tap: checking it again costs a call.
      const entries = heldJournal.get().filter((h) => !h.problem);
      if (server && entries.length) {
        const result = await sendHeld(entries, async (h: HeldEntry) => {
          const entry = await server.checkJournal({ language: h.language, text: h.text, prompt: h.prompt, entry_id: h.entryId ?? null, key: h.entryId ? null : h.key });
          markCaseMistakes(entry);
        });
        const refused = result.refused.map(({ item, error }) => ({ item, problem: failureText(error, { next: 'Open the journal to check it again.' }) }));
        await heldJournal.update((list) => afterEntriesSent(list, entries, result.left, refused));
      }

      const recordings = heldRecordings.get();
      if (recorder && recordings.length) {
        const result = await sendHeld(recordings, async (r) => { await recordNote(recorder, r.noteId, r.voice); });
        await heldRecordings.update((list) => afterSend(list, recordings, result.left));
        if (result.refused.length) {
          const n = result.refused.length;
          Alert.alert(
            n === 1 ? "Couldn't record a new note" : `Couldn't record ${n} new notes`,
            failureText(result.refused[0].error, { next: "Record them with Record audio in the note editor, or from the deck's options." }),
          );
        }
      }
    } finally {
      sending.current = false;
      if (again.current) {
        again.current = false;
        void latest.current();
      }
    }
  }, [api, server, recorder]);
  latest.current = send;

  useEffect(() => { void send(); }, [send]);
  useBackOnline(() => { void send(); });
  return null;
}
