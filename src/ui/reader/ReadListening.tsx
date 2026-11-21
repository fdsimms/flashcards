import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import type { Language, Speakers } from '../../reader/api';
import { endListening } from '../listeningActivity';
import { useAudioQueue } from '../useAudioQueue';
import { ReadOfflineSettings } from './ReadOfflineSettings';
import { LANGUAGE_ORDER, flaggedName } from '../../reader/languages';
import type { ListenAgain } from '../../reader/prefs';
import { prefs, savePrefs } from '../../reader/storage';
import { voicesSummary } from '../../reader/voiceSlots';
import { Card, Group, Help, NavRow, Screen, SectionTitle, Segments, SwitchRow } from '../kit';
import { space, readable } from '../theme';

/**
 * Everything Read & Listen does once it's on, apart from turning it on (`ReadSettings`): each
 * language's voices, listening, slow speed, situations, topics, hearing texts again, meanings, word
 * forms, explain and Thai pronunciation. Read from Settings, Read & Listen, Reading and listening.
 */
export function ReadListening({ voices, onVoices }: {
  /** Each language's speaker voices, once the server's settings are loaded. */
  voices?: Record<Language, Speakers>;
  onVoices: (language: Language) => void;
}) {
  const [followWords, setFollowWords] = useState(prefs().followWords);
  // Up Next's own setting, kept with the queue (useAudioQueue), shown here beside the other listening ones.
  const queue = useAudioQueue();
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

  return (
    <Screen title="Reading and listening">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
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
            label="Keep playing the shelf"
            hint="When Up Next runs out after a shelf text, play the next unread text in the same language."
            value={queue.queue.keepPlaying}
            onValueChange={queue.setKeepPlaying}
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
      </ScrollView>
    </Screen>
  );
}
