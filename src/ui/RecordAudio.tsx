import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { makeRecording, recordNote, sendRecording, type RecordDeps, type Recording } from '../anki/recordService';
import { isOmnilanguage, speechLangFor } from '../core/cards';
import { failureText } from '../core/failure';
import { needsRecording, recordingText, recordingVoice } from '../core/recording';
import type { Note } from '../core/types';
import { azureVoiceName, languageKey, languageName, type VoiceSettings } from '../core/voices';
import type { Repo } from '../db/repo';
import { mediaFileUri } from '../media/mediaFiles';
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
 * fails (the note is saved either way).
 */
export function afterSave(recorder: RecordDeps | null, saved: Note, opts: { added: boolean; recording?: Recording; settings: VoiceSettings }) {
  if (!recorder) return;
  const r = opts.recording;
  if (r && saved.fields.Audio?.includes(`[sound:${r.name}]`)) sendRecording(recorder, r).catch(() => undefined);
  const voice = recordingVoice(saved, opts.settings);
  if (opts.added && voice && needsRecording(saved)) {
    recordNote(recorder, saved.id, voice).catch((e) => {
      Alert.alert('Saved without a recording', failureText(e, { next: "Record it later with Record audio in the note editor, or from the deck's options." }));
    });
  }
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
  const player = useRef<AudioPlayer | null>(null);
  useEffect(() => () => { player.current?.remove(); player.current = null; }, []);

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
      const r = await makeRecording(recorder, recordingText(note), voice, speechLangFor(note));
      onRecorded(r);
      const uri = mediaFileUri(r.name);
      if (uri) {
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
    </>
  );
}
