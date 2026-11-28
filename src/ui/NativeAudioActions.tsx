import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { nativeWanted } from '../anki/nativeRecordings';
import type { RecordDeps, Recording } from '../anki/recordService';
import { sha1Hex } from '../anki/sha1';
import { failureText } from '../core/failure';
import { headword } from '../core/forms';
import { readerLanguageOf } from '../core/leechHint';
import { canKeepNative, CREDIT_FIELD, hasNative, nativeName, nextSpeaker, withNative, withoutNative } from '../core/nativeRecording';
import type { Note } from '../core/types';
import { useApp } from './AppContext';
import { Button, ErrorNote } from './kit';
import { space } from './theme';

/**
 * The note editor's native recording actions (src/core/nativeRecording.ts), under the fields like Record
 * audio: Another speaker and Use Azure voice for a word whose Audio is a native recording, and Find a
 * native recording for one without, where native recordings are on for its language. Each changes the
 * draft; Save keeps it, and sends the file with the next sync as Record audio's does.
 */
export function NativeAudioActions({ recorder, note, onChange }: {
  recorder: RecordDeps | null;
  note: Note;
  onChange: (fields: Record<string, string>, recording?: Recording) => void;
}) {
  const { repo, reader } = useApp();
  const api = reader.api;
  const language = readerLanguageOf(note);
  const [wanted, setWanted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (language) repo.ankiNativeRecordings().then((c) => { if (live) setWanted(nativeWanted(c, language)); }, () => undefined);
    return () => { live = false; };
  }, [repo, language]);

  if (!api || !recorder || !language || !canKeepNative(note) || !wanted) return null;
  const native = hasNative(note);

  const another = async () => {
    const word = headword(note);
    if (!word || busy) return;
    setBusy(true);
    setError(null);
    try {
      const found = (await api.nativeFind(language, [word])).results.find((r) => r.word === word)?.recordings ?? [];
      const next = native ? nextSpeaker(found, note.fields[CREDIT_FIELD] ?? '') : found[0];
      if (!next) {
        setError(native ? 'There is no other speaker for this word.' : 'Wikimedia Commons has no recording of this word.');
        return;
      }
      const bytes = await api.nativeAudio(next.title);
      const name = nativeName(next.title);
      if (!recorder.media.exists(name)) await recorder.media.write(name, bytes);
      onChange(withNative(note, name, next.credit), { name, sha1: sha1Hex(bytes) });
    } catch (e) {
      setError(failureText(e, { what: "Couldn't get a native recording.", next: 'Try again.' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.s }}>
      {native ? (
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button variant="secondary" label="Another speaker" onPress={() => void another()} busy={busy} style={{ flex: 1 }} />
          <Button variant="secondary" label="Use Azure voice" onPress={() => onChange(withoutNative(note))} style={{ flex: 1 }} />
        </View>
      ) : (
        <Button variant="secondary" label="Find a native recording" onPress={() => void another()} busy={busy} />
      )}
      {error ? <ErrorNote message={error} /> : null}
    </View>
  );
}
