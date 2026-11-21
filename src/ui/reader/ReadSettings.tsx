import React, { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { ApiError, createApi, readerAddress } from '../../reader/api';
import { guardedFetch } from '../connection';
import { savePassphrase } from '../../reader/storage';
import { Button, Card, ErrorNote, Field, Group, Help, Screen, SectionTitle, SwitchRow } from '../kit';
import { space, type, useTheme, readable } from '../theme';

/**
 * Turning Read & Listen on or off (Settings, Read & Listen, Server). It's the one part of Franki
 * besides sync that uses the network, so it's off until you sign in here with its passphrase
 * (CLAUDE.md, Read & Listen). Its server runs beside the Anki sync server, so its address comes from
 * the sync settings. The rest of its settings are `ReadListening`, `ReadDailyTasks` and `ReadLanguage`.
 */
export function ReadSettings({ syncServer, signedIn, notice, onSignedIn, onSignOut, onSyncSetup, shareCounts, onShareCounts }: {
  /** The sync server's address, or undefined while sync is off. */
  syncServer?: string;
  signedIn: boolean;
  /** Why the passphrase is needed again, e.g. it was changed on the server. */
  notice?: string | null;
  onSignedIn: (passphrase: string) => void;
  onSignOut: () => void;
  onSyncSetup: () => void;
  /** Whether the deck list's counts are sent to the server for dundundun. */
  shareCounts: boolean;
  onShareCounts: (on: boolean) => void;
}) {
  const c = useTheme();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = syncServer ? readerAddress(syncServer) : null;

  const turnOff = () => Alert.alert(
    'Turn off Read & Listen?',
    "Franki forgets the passphrase on this iPhone and stops reaching Read & Listen's server, so recording cards with Azure's voices stops too. Your topics, texts and reading log stay on the server, ready when you turn it back on.",
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn off', style: 'destructive', onPress: onSignOut },
    ],
  );

  const signIn = async () => {
    const passphrase = value.trim();
    if (!address || !passphrase || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createApi(address, passphrase, guardedFetch(`${address}/api/check`)).check();
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
    <Screen title="Server">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }} keyboardShouldPersistTaps="handled">
        <Card>
          <Help>
            Short dialogues and stories written from the words in your language decks, mostly words you already know,
            with audio and the meaning of every word a tap away. Reading never answers or adds cards.
          </Help>
          <Help>
            Texts are written on your Anki sync server, which sends the words in those decks to Claude and the lines to
            Azure for audio. Nothing goes anywhere until you turn this on.
          </Help>
          <Help>Pronunciations (IPA) come from Wiktionary, under the Creative Commons BY-SA 4.0 license. Where Wiktionary has none, Claude writes it and the app labels it as written by AI.</Help>
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
            <Button label="Turn off" variant="destructive" onPress={turnOff} />
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
            <Help>{`It's the passphrase you set on your Read & Listen server. Franki checks it with ${address} and keeps it in the Keychain.`}</Help>
            {error ? <ErrorNote message={error} /> : null}
            <Button label="Turn on" onPress={signIn} busy={busy} disabled={!value.trim()} />
          </Card>
        )}
        {address && signedIn ? (
          <>
            <SectionTitle>dundundun</SectionTitle>
            <Group>
              <SwitchRow first label="Share today's counts" value={shareCounts} onValueChange={onShareCounts} />
            </Group>
            <Help>
              Sends how many cards are due and how many new cards are left today, as the deck list shows them, to your
              server after each sync. dundundun's Franki task reads them there. Nothing else is sent.
            </Help>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
