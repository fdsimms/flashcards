import { useCallback } from 'react';
import { Alert } from 'react-native';
import { saveNote } from '../anki/noteService';
import { keepLineClip } from '../anki/recordService';
import { runningCramTags } from '../core/cram';
import { failureText } from '../core/failure';
import { readerLanguageOf } from '../core/leechHint';
import type { Note } from '../core/types';
import type { QueuedNote } from '../reader/api';
import { hasClip, type Heard } from '../reader/heardLine';
import { approvalDraft, queuedFieldNames } from '../reader/noteQueue';
import { useApp } from './AppContext';
import { afterSave, useVoiceSettings } from './RecordAudio';
import { cramsNow, loadCrams } from './useCrams';
import { useRecorder } from './useRecorder';

/** How an approval went: the notes saved, the ones the deck refused (still queued, with why), and the ones saved but not taken off the queue. */
export type Approval = { saved: number; refused: { id: number; entry: string; reason: string }[]; stuck: string[] };

/**
 * "Approve all" on the queued notes: saves each ready note as the note editor would save it untouched
 * (`approvalDraft`), then takes it off the queue. The caller asks first, in an alert naming how many
 * notes will be added, and that tap is the approval (the way `useAddMinedWord` links an aspect pair).
 * `onProgress` hears after each note is dealt with, so the screen can show how far along it is.
 * A note the deck refuses (a duplicate) stays queued with its reason, and the rest are still saved.
 * New notes are recorded afterward one at a time, in the background, with one alert if any fail, and a
 * word heard in a text then gets its line's clip the same way (src/reader/heardLine.ts).
 */
export function useApproveQueued(remove: (id: number) => Promise<void>): (notes: QueuedNote[], onProgress?: (done: number, id: number, saved: boolean) => void) => Promise<Approval> {
  const { repo, reader } = useApp();
  const api = reader.api;
  const recorder = useRecorder();
  const settings = useVoiceSettings(repo);

  return useCallback(async (notes, onProgress) => {
    const noteTypes = await repo.listNoteTypes();
    const { dayStartsAtHour } = await repo.collectionSettings();
    const allCrams = await loadCrams(repo).catch(() => cramsNow());
    // Only crams in each note's own language take it (runningCramTags): a batch is often several languages.
    const allNotes = allCrams.length ? await repo.listNotes() : [];
    const result: Approval = { saved: 0, refused: [], stuck: [] };
    const savedNotes: Note[] = [];
    const heardNotes: { saved: Note; heard: Heard & { text_id: number; line: number } }[] = [];
    let done = 0;
    for (const note of notes) {
      const names = queuedFieldNames(note, noteTypes);
      try {
        const draft = approvalDraft(note, names, []);
        const crams = runningCramTags(allCrams, allNotes, readerLanguageOf({ id: '', ...draft }), new Date(), dayStartsAtHour);
        const saved = await saveNote(repo, approvalDraft(note, names, crams));
        savedNotes.push(saved);
        if (hasClip(note.heard)) heardNotes.push({ saved, heard: note.heard });
        result.saved++;
      } catch (e) {
        result.refused.push({ id: note.id, entry: note.entry, reason: failureText(e, { next: 'Open it from the list to try again.' }) });
        onProgress?.(++done, note.id, false);
        continue;
      }
      try {
        await remove(note.id);
      } catch {
        result.stuck.push(note.entry);
      }
      onProgress?.(++done, note.id, true);
    }
    // Recording is slow and not part of approving: one at a time, so a long list isn't 50 requests at once.
    void (async () => {
      let failed = 0;
      for (const saved of savedNotes) await afterSave(recorder, saved, { added: true, settings, onFailure: () => { failed++; } });
      if (failed) {
        Alert.alert(
          failed === 1 ? 'Saved 1 note without a recording' : `Saved ${failed} notes without a recording`,
          "Record them later with Record audio in the note editor, or from the deck's options.",
        );
      }
      if (!api || !recorder) return;
      let noClip = 0;
      for (const { saved, heard } of heardNotes) {
        try {
          await keepLineClip(recorder, saved.id, await api.lineClip(heard.text_id, heard.line));
        } catch {
          noClip++;
        }
      }
      if (noClip) {
        Alert.alert(
          noClip === 1 ? "Saved 1 note without its line's clip" : `Saved ${noClip} notes without their line's clip`,
          "Couldn't fetch the clips from your server. The lines are still in the notes.",
        );
      }
    })();
    return result;
  }, [repo, recorder, settings, remove, api]);
}
