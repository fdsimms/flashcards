import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { NATIVE_OFF, NATIVE_OFF_BY_DEFAULT, nativeWanted, type NativeRecordingsConfig } from '../anki/nativeRecordings';
import { failureText } from '../core/failure';
import { canKeepNative } from '../core/nativeRecording';
import type { DeckLanguage } from '../core/voices';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { useApp } from './AppContext';
import { Group, Help, Section, SwitchRow } from './kit';

type NativeRepo = Pick<Repo, 'listNotes'> & Pick<AnkiLink, 'ankiNativeRecordings' | 'setAnkiNativeRecordings'>;

/**
 * Settings, Voices' Native recordings (src/anki/nativeRecordings.ts): a native speaker's recording of a
 * word from Wikimedia Commons in place of an Azure one, where there is one. Off until turned on; then on for
 * each language but those Commons has few of, each of which can be changed. Read & Listen's server looks
 * the words up, and the credit goes in the note's AudioCredit field, which the note type needs first.
 */
export function NativeRecordingsSetting({ repo, languages }: { repo: NativeRepo; languages: DeckLanguage[] }) {
  const { reader } = useApp();
  const [config, setConfig] = useState<NativeRecordingsConfig | null>(null);
  const [hasField, setHasField] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    repo.ankiNativeRecordings().then((c) => { if (live) setConfig(c); }, () => { if (live) setConfig(NATIVE_OFF); });
    repo.listNotes().then((notes) => { if (live) setHasField(notes.some(canKeepNative)); }, () => undefined);
    return () => { live = false; };
  }, [repo]);

  const save = useCallback(async (next: NativeRecordingsConfig) => {
    const before = config;
    setConfig(next);
    try {
      await repo.setAnkiNativeRecordings(next);
    } catch (e) {
      setConfig(before);
      Alert.alert("Couldn't save the setting", failureText(e, { next: 'Try again.' }));
    }
  }, [config, repo]);

  if (!config) return null;
  return (
    <Section
      footer={(
        <>
          <Help>
            {"A word's Audio becomes a native speaker's recording from Wikimedia Commons (Lingua Libre, then Wiktionary) where one exists, and stays Azure's where none does. Read & Listen's server looks each word up. Each recording's credit (speaker, license and where it's from) goes in the note's AudioCredit field."}
          </Help>
          {!reader.api ? <Help>Uses Read & Listen. Turn it on in Settings, Read & Listen.</Help> : null}
          {hasField === false ? (
            <Help>{"Your Omnilanguage note type has no AudioCredit field yet, so no native recording is kept. Ask Claude to add the field with the MCP's add_field, after syncing every device."}</Help>
          ) : null}
        </>
      )}
    >
      <Group>
        <SwitchRow first label="Native recordings" value={config.on} onValueChange={(on) => void save({ ...config, on })} />
        {config.on ? languages.map((l) => (
          <SwitchRow
            key={l.key}
            label={l.name}
            hint={NATIVE_OFF_BY_DEFAULT.includes(l.key) ? 'Commons has few of its words.' : undefined}
            value={nativeWanted(config, l.key)}
            onValueChange={(on) => void save({ ...config, languages: { ...config.languages, [l.key]: on } })}
          />
        )) : null}
      </Group>
    </Section>
  );
}
