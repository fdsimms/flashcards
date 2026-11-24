import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { useOutputWake } from './useOutputWake';
import { Alert } from 'react-native';
import { makeRecording, recordNote, sendRecording, type RecordDeps, type Recording } from '../anki/recordService';
import { isOmnilanguage, speechLangFor } from '../core/cards';
import { failureText } from '../core/failure';
import { holdRecording, isOffline } from '../core/held';
import { needsRecording, recordingRequest, recordingVoice } from '../core/recording';
import type { Note } from '../core/types';
import { azureVoiceName, languageKey, languageName, type VoiceSettings } from '../core/voices';
import type { Repo } from '../db/repo';
import { mediaFileUri } from '../media/mediaFiles';
import { connection, useConnectionProblem } from './connection';
import { heldRecordings, useHeldRecordings } from './held';
import { Button, ErrorNote, Help } from './kit';

/**
 * The note editor's recording (src/core/recording.ts): Record audio puts a recording of the Entry
 * in the draft's Audio field, and a new note is recorded once it's saved. The editor holds the
 * recording until it's saved, so one made and then canceled is never sent anywhere.
 */

/** The voices chosen for each language (Settings > Voices), loaded when the editor opens. */
export function useVoiceSettings(repo: Repo): VoiceSettings {
  const [settings, setSettings] = useState<VoiceSettings>({});
  useEffect(() => { repo.voiceSettings().then(setSettings, () => undefined); }, [repo]);
  return settings;
}

/**
 * After a save: a recording made here goes on the list the next sync sends, if the saved note
 * still has it; a new note without one is recorded now, in the background, with an alert if that
 * fails (the note is saved either way). Offline it's held instead, and recorded when the connection
 * comes back (HeldWork.tsx).
 */
export function afterSave(
  recorder: RecordDeps | null,
  saved: Note,
  /** `onFailure` takes a failed recording in place of the alert, for a caller saving many notes that says so once. */
  opts: { added: boolean; recording?: Recording; settings: VoiceSettings; onFailure?: (e: unknown) => void },
): Promise<void> {
  if (!recorder) return Promise.resolve();
  const r = opts.recording;
  if (r && saved.fields.Audio?.includes(`[sound:${r.name}]`)) sendRecording(recorder, r).catch(() => undefined);
  const voice = recordingVoice(saved, opts.settings);
  if (opts.added && voice && needsRecording(saved)) {
    const hold = () => { void heldRecordings.update((list) => holdRecording(list, { noteId: saved.id, voice })); };
    if (connection.cantReachHome()) { hold(); return Promise.resolve(); }
    return recordNote(recorder, saved.id, voice).then(() => undefined, (e) => {
      if (isOffline(e)) { hold(); return; }
      if (opts.onFailure) opts.onFailure(e);
      else Alert.alert('Saved without a recording', failureText(e, { next: "Record it later with Record audio in the note editor, or from the deck's options." }));
    });
  }
  return Promise.resolve();
}

/** Record audio, under the fields of an Omnilanguage note with no recording. */
export function RecordAudio({ recorder, note, settings, onRecorded }: {
  recorder: RecordDeps | null;
  note: Note;
  settings: VoiceSettings;
  /** The recording made, to add to the draft's Audio field. */
  onRecorded: (recording: Recording) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const held = useHeldRecordings();
  const problem = useConnectionProblem();
  const player = useRef<AudioPlayer | null>(null);
  useEffect(() => () => { player.current?.remove(); player.current = null; }, []);
  const wake = useOutputWake();

  if (!isOmnilanguage(note) || !needsRecording(note)) return null;
  const lang = languageName(languageKey(speechLangFor(note)!));
  if (!recorder) return <Help>{`To record this note's audio with an Azure voice, turn on Read & Listen (Settings, Read & Listen).`}</Help>;
  const voice = recordingVoice(note, settings);
  if (!voice) return <Help>{`To record this note's audio, choose a ${lang} voice for recordings in Settings, Voices.`}</Help>;

  const record = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await makeRecording(recorder, recordingRequest(note), voice);
      onRecorded(r);
      const uri = mediaFileUri(r.name);
      if (uri) {
        // Bluetooth headphones that have been quiet lose the start of the next sound (useOutputWake).
        await wake();
        player.current ??= createAudioPlayer();
        player.current.replace({ uri });
        player.current.play();
      }
    } catch (e) {
      setError(failureText(e, { what: "Couldn't record it.", next: 'Try again.' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button label={`Record audio with ${azureVoiceName(voice)}`} variant="secondary" onPress={record} busy={busy} />
      {error ? <ErrorNote message={error} onRetry={record} /> : null}
      {!error && held.some((h) => h.noteId === note.id) ? <Help>{problem === 'server' ? `Couldn't reach your server. This note will be recorded with ${azureVoiceName(voice)} once it answers.` : `You're offline. This note will be recorded with ${azureVoiceName(voice)} when you're back online.`}</Help> : null}
    </>
  );
}
