import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { recordNote } from '../anki/recordService';
import { failureText } from '../core/failure';
import { sendHeld } from '../core/held';
import type { HeldWords } from '../reader/heldNotes';
import { useApp } from './AppContext';
import { connection, useBackOnline } from './connection';
import type { HeldReaderAction } from '../reader/downloads';
import { heldReader, heldRecordings, heldWords } from './held';
import { queueWords } from './useNoteQueue';
import { useRecorder } from './useRecorder';

/**
 * Sends what was held while offline (src/core/held.ts): Read & Listen's language switches, readings,
 * listens and story choices (in order, so a choice goes before its reading), words to the note queue for Claude, and
 * new notes' recordings. It runs at launch and each time the connection comes back. Drawn once,
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

  const send = useCallback(async () => {
    if (sending.current || connection.cantReachHome()) return;
    sending.current = true;
    try {
      await Promise.all([heldWords.load(), heldRecordings.load(), heldReader.load()]);

      // Straight to the server, not through the offline answers, which would hold them again.
      const actions = heldReader.get();
      if (server && actions.length) {
        const result = await sendHeld(actions, (a: HeldReaderAction) => (
          a.kind === 'reading' ? server.logReading(a.textId, a.log) : a.kind === 'listen' ? server.logListen(a.textId)
            : a.kind === 'choice' ? server.chooseNext(a.textId, a.choice) : server.updateSettings({ language: a.language }).then(() => undefined)
        ));
        // One the server refuses has nothing left to do: the text was deleted (404), or its episode
        // was read before the choice arrived (409). Held while this ran are kept as they are.
        await heldReader.update((list) => [...list.filter((a) => !actions.includes(a)), ...result.left]);
      }

      const words = heldWords.get();
      if (api && words.length) {
        const result = await sendHeld(words, (g: HeldWords) => queueWords(api, g.language, g.deck, g.entries));
        const refused = result.refused.map(({ item, error }) => ({ ...item, problem: failureText(error, { next: 'Try again later, or remove them.' }) }));
        // Words held while this ran are kept as they are.
        await heldWords.update((list) => [...list.filter((g) => !words.includes(g)), ...result.left, ...refused]);
      }

      const recordings = heldRecordings.get();
      if (recorder && recordings.length) {
        const result = await sendHeld(recordings, async (r) => { await recordNote(recorder, r.noteId, r.voice); });
        await heldRecordings.update((list) => [...list.filter((r) => !recordings.includes(r)), ...result.left]);
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
    }
  }, [api, server, recorder]);

  useEffect(() => { void send(); }, [send]);
  useBackOnline(() => { void send(); });
  return null;
}
