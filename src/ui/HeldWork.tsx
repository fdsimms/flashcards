import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { recordNote } from '../anki/recordService';
import { failureText } from '../core/failure';
import { sendHeld } from '../core/held';
import type { HeldWords } from '../reader/heldNotes';
import { noteQueueStore } from '../reader/noteQueueStore';
import { useApp } from './AppContext';
import { connection, useBackOnline } from './connection';
import { heldRecordings, heldWords } from './held';
import { useRecorder } from './useRecorder';

/**
 * Sends what was held while offline (src/core/held.ts): words to the note queue for Claude, and
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
  const recorder = useRecorder();
  const sending = useRef(false);

  const send = useCallback(async () => {
    if (sending.current || connection.cantReachHome()) return;
    sending.current = true;
    try {
      await Promise.all([heldWords.load(), heldRecordings.load()]);

      const words = heldWords.get();
      if (api && words.length) {
        const result = await sendHeld(words, async (g: HeldWords) => {
          noteQueueStore.set({ queue: await api.queueNotes(g.language, g.deck, g.entries), error: null });
        });
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
  }, [api, recorder]);

  useEffect(() => { void send(); }, [send]);
  useBackOnline(() => { void send(); });
  return null;
}
