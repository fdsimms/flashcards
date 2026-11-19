import React, { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { ApiError, createApi, readerAddress, type Language, type Speakers } from '../../reader/api';
import { guardedFetch } from '../connection';
import { endListening } from '../listeningActivity';
import { ReadOfflineSettings } from './ReadOfflineSettings';
import { LANGUAGE_ORDER, flaggedName } from '../../reader/languages';
import type { ListenAgain } from '../../reader/prefs';
import { prefs, savePassphrase, savePrefs } from '../../reader/storage';
import { voicesSummary } from '../../reader/voiceSlots';
import { Button, Card, ErrorNote, Field, Group, Help, NavRow, Screen, SectionTitle, Segments, SwitchRow } from '../kit';
import { space, type, useTheme, readable } from '../theme';

/**
 * Turning Read & Listen on or off. It's the one part of Franki besides sync that uses the network,
 * so it's off until you sign in here with its passphrase (CLAUDE.md, Read & Listen). Its server runs
 * beside the Anki sync server, so its address comes from the sync settings.
 */
export function ReadSettings({ syncServer, signedIn, notice, onSignedIn, onSignOut, onSyncSetup, voices, onVoices, dailySummary, onDailyTasks, shareCounts, onShareCounts }: {
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
  /** What the Daily reading tasks row says (dailyTasks.ts), null from a server older than the setting. */
  dailySummary: string | null;
  onDailyTasks: () => void;
  shareCounts: boolean;
  onShareCounts: (on: boolean) => void;
}) {
  const c = useTheme();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followWords, setFollowWords] = useState(prefs().followWords);
  const [listeningActivity, setListeningActivity] = useState(prefs().listeningActivity);
  const [listenAgain, setListenAgain] = useState(prefs().listenAgain);
  const [listenFirst, setListenFirst] = useState(prefs().listenFirst);
  const [listenTwice, setListenTwice] = useState(prefs().listenTwice);
  const [situationsAzure, setSituationsAzure] = useState(prefs().situationsAzure);
  const [topicImages, setTopicImages] = useState(prefs().topicImages);
  const [slowLanguages, setSlowLanguages] = useState(prefs().slowLanguages);
  const [guessFirst, setGuessFirst] = useState(prefs().guessFirst);
  const [quizKnown, setQuizKnown] = useState(prefs().quizKnown);
  const [formQuiz, setFormQuiz] = useState(prefs().formQuiz);
  const [explainInLanguage, setExplainInLanguage] = useState(prefs().explainInLanguage);
  const [thaiToneMarks, setThaiToneMarks] = useState(prefs().thaiToneMarks);
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
                label="Lock screen and Dynamic Island controls"
                value={listeningActivity}
                onValueChange={(on) => {
                  savePrefs({ listeningActivity: on });
                  setListeningActivity(on);
                  if (!on) endListening();
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
            <ReadOfflineSettings />
            <SectionTitle>Slow speed</SectionTitle>
            <Group>
              {LANGUAGE_ORDER.map((l, i) => (
                <SwitchRow
                  key={l}
                  first={i === 0}
                  label={flaggedName(l)}
                  value={slowLanguages.includes(l)}
                  onValueChange={(on) => {
                    const next = LANGUAGE_ORDER.filter((x) => (x === l ? on : slowLanguages.includes(x)));
                    savePrefs({ slowLanguages: next });
                    setSlowLanguages(next);
                  }}
                />
              ))}
            </Group>
            <Help>
              A language with Slow on offers a Slow and a Normal speed when you play its lines. Slow is a second
              recording of each line, made by Azure the first time you play it slowly. Leave it off for a language you
              follow at normal speed, and its lines play at normal speed with no speed choice.
            </Help>
            <SectionTitle>Situations</SectionTitle>
            <Group>
              <SwitchRow
                first
                label="Use Azure voices"
                value={situationsAzure}
                onValueChange={(on) => {
                  savePrefs({ situationsAzure: on });
                  setSituationsAzure(on);
                }}
              />
            </Group>
            <Help>
              Situations reads the other person's lines with this phone's voices (Settings, Voices), so each reply
              arrives as soon as it's written. If a language's phone voice sounds too poor, turn this on and the lines
              are recorded with Azure's voices instead. They sound more natural, but each reply waits for the recording,
              and the recording costs a little. The Slow speed is recorded the first time you play a line slowly.
            </Help>
            <SectionTitle>Topics</SectionTitle>
            <Group>
              <SwitchRow
                first
                label="Start a topic from an image"
                value={topicImages}
                onValueChange={(on) => {
                  savePrefs({ topicImages: on });
                  setTopicImages(on);
                }}
              />
            </Group>
            <Help>
              New topic gets a From an image button. Take a photo of a grammar book's page, or choose a screenshot, and
              Claude names the grammar point on it for you to edit before the page is written. The image is sent to
              Claude through your server when you pick it. It isn't saved on the server or on this phone.
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
                Texts you finish come back under Hear again, to listen to with the words hidden. Once is 3 days after you read
                it. Three times is 1, 4 and 10 days after. A text isn't offered once it's been heard that many times, or
                a month after you read it.
              </Help>
            </Card>
            <SectionTitle>Meanings</SectionTitle>
            <Group>
              <SwitchRow
                first
                label="Recall before the meaning"
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
              Tapping a word in your deck shows its meaning only when you ask for it, so you can try to remember it
              first. A word's meaning counts as looked up once it's shown. A word that isn't in your deck shows its
              meaning right away. With the quiz on, a word in your deck asks you to pick its meaning from four choices,
              with I don't know to skip. Nothing is graded or added to your deck.
            </Help>
            <SectionTitle>Word forms</SectionTitle>
            <Group>
              <SwitchRow
                first
                label="Practice word forms"
                value={formQuiz}
                onValueChange={(on) => {
                  savePrefs({ formQuiz: on });
                  setFormQuiz(on);
                }}
              />
            </Group>
            <Help>
              In a longer text, a few words you know are hidden behind a question mark. Tap one, type the form that
              fits the sentence from its dictionary form, and the word comes back. It's for languages that change
              their words (cases, endings), so there are none in Thai. Nothing is graded or added to your deck.
            </Help>
            <SectionTitle>Explain</SectionTitle>
            <Group>
              <SwitchRow
                first
                label="Explain in the language"
                value={explainInLanguage}
                onValueChange={(on) => {
                  savePrefs({ explainInLanguage: on });
                  setExplainInLanguage(on);
                }}
              />
            </Group>
            <Help>
              Explain on a line or a phrase writes its notes in English. With this on, the notes are in the language
              you're reading, in simple words, for practice. The English meaning of a phrase stays in English. Notes
              already asked for stay as they were, and each version is kept separately. Explain more simply works the same way.
            </Help>
            <SectionTitle>Thai pronunciation</SectionTitle>
            <Group>
              <SwitchRow
                first
                label="Show tones as accent marks"
                value={thaiToneMarks}
                onValueChange={(on) => {
                  savePrefs({ thaiToneMarks: on });
                  setThaiToneMarks(on);
                }}
              />
            </Group>
            <Help>
              A Thai word's IPA writes its tones as tone letters (hen˩˩˦). With this on, the word's popup and your
              marked words show accent marks instead: ǎ rising, â falling, á high, à low, and no mark for the mid
              tone (hěn). The Pronunciation field of a card you add keeps the tone letters.
            </Help>
            <SectionTitle>dundundun</SectionTitle>
            <Group>
              <SwitchRow first label="Share today's counts" value={shareCounts} onValueChange={onShareCounts} />
              <NavRow label="Daily reading tasks" detail={dailySummary ?? 'Which languages get a task each day'} onPress={onDailyTasks} />
            </Group>
            <Help>
              Sends how many cards are due and how many new cards are left today, as the deck list shows them, to your
              server after each sync. dundundun's Franki task reads them there. Nothing else is sent.
            </Help>
            <Help>
              Daily reading tasks sets which languages dundundun adds a Read & Listen task for each day.
            </Help>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
