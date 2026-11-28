import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { keepLineClip } from '../anki/recordService';
import { failureText } from '../core/failure';
import { hasClip, withHeard, type Heard } from '../reader/heardLine';
import { useApp } from './AppContext';
import { useRecorder } from './useRecorder';

/**
 * The clip of the line a word was heard in (src/reader/heardLine.ts), for every way a word heard in a
 * text is saved: Add to deck, a queued word opened from the queue, and Approve all. `note` puts Source
 * and the tag on a new note, saying under Source when its note type can't keep the clip; `keep` fetches
 * the clip once the note is saved, in the background, so nothing is fetched for a word that isn't, and
 * one alert says so when it can't be had (the line itself is already in Source).
 */
export function useLineClip() {
  const { repo, reader } = useApp();
  const api = reader.api;
  const recorder = useRecorder();

  const note = useCallback(async <T extends { model: string; fields: Record<string, string>; tags?: string[]; fieldNotes?: Record<string, string> }>(target: T, heard: Heard | null | undefined): Promise<T> => {
    if (!heard) return target;
    const fields = await repo.listNoteTypes().then((types) => types.get(target.model)?.fields ?? null, () => null);
    return withHeard(target, heard, fields);
  }, [repo]);

  const keep = useCallback((saved: { id: string; fields: Record<string, string> }, heard: Heard | null | undefined) => {
    if (!api || !recorder || !hasClip(heard)) return;
    const word = saved.fields.Entry || 'the word';
    void (async () => {
      try {
        await keepLineClip(recorder, saved.id, await api.lineClip(heard.text_id, heard.line));
      } catch (e) {
        Alert.alert(`Saved ${word} without the line's clip`, failureText(e, { what: "Couldn't fetch the clip from your server.", next: 'The line is still in the note.' }));
      }
    })();
  }, [api, recorder]);

  return useMemo(() => ({ note, keep }), [note, keep]);
}
