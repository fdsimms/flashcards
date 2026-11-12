import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { azureVoiceName } from '../core/voices';
import { ApiError, createApi, readerAddress, type Language, type Speakers } from '../reader/api';
import { LANGUAGE_ORDER, LANGUAGES } from '../reader/languages';
import { savePassphrase } from '../reader/storage';
import { Button, Card, ErrorNote, Field, Group, Help, NavRow, Screen, SectionTitle } from './kit';
import { space, type, useTheme } from './theme';

/**
 * Turning Read & Listen on or off. It's the one part of Franki besides sync that uses the network,
 * so it's off until you sign in here with its passphrase (CLAUDE.md, Read & Listen). Its server runs
 * beside the Anki sync server, so its address comes from the sync settings.
 */
export function ReadSettings({ syncServer, signedIn, notice, onSignedIn, onSignOut, onSyncSetup, voices, onVoices }: {
  /** The sync server's address, or undefined while sync is off. */
  syncServer?: string;
  signedIn: boolean;
  /** Why the passphrase is needed again, e.g. it was changed on the server. */
  notice?: string | null;
  onSignedIn: (passphrase: string) => void;
  onSignOut: () => void;
  onSyncSetup: () => void;
  /** Each language's speaker voices, once the server's settings are loaded. */
  voices?: Record<Language, Speakers>;
  onVoices: (language: Language) => void;
}) {
  const c = useTheme();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = syncServer ? readerAddress(syncServer) : null;

  const signIn = async () => {
    const passphrase = value.trim();
    if (!address || !passphrase || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createApi(address, passphrase).check();
      await savePassphrase(passphrase);
      setValue('');
      onSignedIn(passphrase);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Read & Listen">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }} keyboardShouldPersistTaps="handled">
        <Card>
          <Help>
            Short dialogues and stories written from the words in your language decks, mostly words you already know,
            with audio and the meaning of every word a tap away. Reading never answers or adds cards.
          </Help>
          <Help>
            Texts are written on your Anki sync server, which sends the words in those decks to Claude and the lines to
            Azure for audio. Nothing goes anywhere until you turn this on.
          </Help>
        </Card>
        {notice ? <Text style={{ ...type.subhead, color: c.warning }}>{notice}</Text> : null}
        {!address ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>Set up sync first</Text>
            <Help>Read & Listen runs on your Anki sync server, so Franki needs to sync with it before this can be turned on.</Help>
            <Button label="Set up sync" onPress={onSyncSetup} />
          </Card>
        ) : signedIn ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>On</Text>
            <Help>{`Texts come from ${address}.`}</Help>
            <Button label="Turn off" variant="secondary" onPress={onSignOut} />
            <Help>Turning it off forgets the passphrase on this iPhone. Your topics and past texts stay on the server.</Help>
          </Card>
        ) : (
          <Card>
            <Field
              label="Passphrase"
              value={value}
              onChangeText={setValue}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={signIn}
            />
            <Help>{`READER_PASSPHRASE in the server's .env. Franki checks it with ${address} and keeps it in the Keychain.`}</Help>
            {error ? <ErrorNote message={error} /> : null}
            <Button label="Turn on" onPress={signIn} busy={busy} disabled={!value.trim()} />
          </Card>
        )}
        {address && signedIn ? (
          <>
            <SectionTitle>Voices</SectionTitle>
            <Group>
              {LANGUAGE_ORDER.map((l, i) => (
                <NavRow
                  key={l}
                  first={i === 0}
                  label={LANGUAGES[l].name}
                  detail={voices?.[l] ? `${azureVoiceName(voices[l].A)} and ${azureVoiceName(voices[l].B)}` : 'The voices its texts are read in'}
                  onPress={() => onVoices(l)}
                />
              ))}
            </Group>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
