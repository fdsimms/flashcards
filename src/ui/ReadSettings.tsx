import React, { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { ApiError, createApi, readerAddress, type Language, type Speakers } from '../reader/api';
import { LANGUAGE_ORDER, flaggedName } from '../reader/languages';
import type { ListenAgain } from '../reader/prefs';
import { prefs, savePassphrase, savePrefs } from '../reader/storage';
import { voicesSummary } from '../reader/voiceSlots';
import { Button, Card, ErrorNote, Field, Group, Help, NavRow, Screen, SectionTitle, Segments, SwitchRow } from './kit';
import { space, type, useTheme, readable } from './theme';

/**
 * Turning Read & Listen on or off. It's the one part of Franki besides sync that uses the network,
 * so it's off until you sign in here with its passphrase (CLAUDE.md, Read & Listen). Its server runs
 * beside the Anki sync server, so its address comes from the sync settings.
 */
export function ReadSettings({ syncServer, signedIn, notice, onSignedIn, onSignOut, onSyncSetup, voices, onVoices, shareCounts, onShareCounts }: {
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
  /** Whether the deck list's counts are sent to the server for dundundun. */
  shareCounts: boolean;
  onShareCounts: (on: boolean) => void;
}) {
  const c = useTheme();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followWords, setFollowWords] = useState(prefs().followWords);
  const [listenAgain, setListenAgain] = useState(prefs().listenAgain);
  const [listenFirst, setListenFirst] = useState(prefs().listenFirst);
  const [listenTwice, setListenTwice] = useState(prefs().listenTwice);
  const [guessFirst, setGuessFirst] = useState(prefs().guessFirst);
  const [quizKnown, setQuizKnown] = useState(prefs().quizKnown);
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
            <SectionTitle>Voices</SectionTitle>
            <Group>
              {LANGUAGE_ORDER.map((l, i) => (
                <NavRow
                  key={l}
                  first={i === 0}
                  label={flaggedName(l)}
                  detail={voicesSummary(voices?.[l]) ?? 'The voices its texts are read in'}
                  onPress={() => onVoices(l)}
                />
              ))}
            </Group>
            <SectionTitle>Listening</SectionTitle>
            <Group>
              <SwitchRow
                first
                label="Highlight each word as it's read"
                value={followWords}
                onValueChange={(on) => {
                  savePrefs({ followWords: on });
                  setFollowWords(on);
                }}
              />
              <SwitchRow
                label="Listen before reading"
                value={listenFirst}
                onValueChange={(on) => {
                  savePrefs({ listenFirst: on });
                  setListenFirst(on);
                }}
              />
              {listenFirst ? (
                <SwitchRow
                  label="Listen twice first"
                  value={listenTwice}
                  onValueChange={(on) => {
                    savePrefs({ listenTwice: on });
                    setListenTwice(on);
                  }}
                />
              ) : null}
            </Group>
            <Help>
              While a line plays, the word being read aloud is shaded. With Listen before reading on, a new text opens
              with its words hidden and shows them once every line has played, so you hear it first and read it second.
              Listen twice first waits for every line to play twice. Show the text now skips the wait. Play all and texts you read again open as usual. Lines recorded before this was added play without it.
            </Help>
            <SectionTitle>Hear texts again</SectionTitle>
            <Card style={{ gap: space.s }}>
              <Segments<ListenAgain>
                options={[
                  { value: 0, label: 'Never' },
                  { value: 1, label: 'Once' },
                  { value: 3, label: 'Three times' },
                ]}
                value={listenAgain}
                onChange={(value) => {
                  savePrefs({ listenAgain: value });
                  setListenAgain(value);
                }}
              />
              <Help>
                Texts you finish come back on the shelf to listen to with the words hidden. Once is 3 days after you read
                it. Three times is 1, 4 and 10 days after. A text isn't offered once it's been heard that many times, or
                a month after you read it.
              </Help>
            </Card>
            <SectionTitle>Meanings</SectionTitle>
            <Group>
              <SwitchRow
                first
                label="Guess before the meaning"
                value={guessFirst}
                onValueChange={(on) => {
                  savePrefs({ guessFirst: on });
                  setGuessFirst(on);
                }}
              />
              {guessFirst ? (
                <SwitchRow
                  label="Quiz me on words I know"
                  value={quizKnown}
                  onValueChange={(on) => {
                    savePrefs({ quizKnown: on });
                    setQuizKnown(on);
                  }}
                />
              ) : null}
            </Group>
            <Help>
              Tapping a word shows its meaning only when you ask for it, so you can try to remember it, or work it out
              from the line, first. A word's meaning counts as looked up once it's shown. With the quiz on, a word in your
              deck asks you to pick its meaning from four choices, with I don't know to skip. Nothing is graded or added
              to your deck.
            </Help>
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
