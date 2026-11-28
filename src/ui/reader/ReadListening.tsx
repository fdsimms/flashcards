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
import { Card, Group, Help, NavRow, Screen, Section, SECTION_GAP, Segments, SwitchRow } from '../kit';
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
  const [videos, setVideos] = useState(prefs().videos);
  const [podcasts, setPodcasts] = useState(prefs().podcasts);
  const [slowLanguages, setSlowLanguages] = useState(prefs().slowLanguages);
  const [guessFirst, setGuessFirst] = useState(prefs().guessFirst);
  const [quizKnown, setQuizKnown] = useState(prefs().quizKnown);
  const [formQuiz, setFormQuiz] = useState(prefs().formQuiz);
  const [explainInLanguage, setExplainInLanguage] = useState(prefs().explainInLanguage);
  const [thaiToneMarks, setThaiToneMarks] = useState(prefs().thaiToneMarks);

  return (
    <Screen title="Reading and listening">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: SECTION_GAP }}>
        <Section
          title="Voices"
        >
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
        </Section>
        <Section
          title="Listening"
          footer={(
            <Help>
              While a line plays, the word being read aloud is shaded (not in lines recorded before this was added).
              Listen before reading hides a new text's words until every line has played (twice, with Listen twice
              first). Tap Show the text now to see them sooner. Texts you reread, and Play all, aren't hidden.
            </Help>
          )}
        >
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
        </Section>
        <ReadOfflineSettings />
        <Section
          title="Slow speed"
          footer={(
            <Help>
              Adds a Slow speed to that language's lines. Each slow line is recorded by Azure the first time you play
              it.
            </Help>
          )}
        >
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
        </Section>
        <Section
          title="Situations"
          footer={(
            <Help>
              Situations normally reads replies with this iPhone's voices (Settings, Voices), so they're instant. Turn
              this on to use Azure's voices instead: they sound more natural, but each reply waits a moment and costs a
              little.
            </Help>
          )}
        >
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
        </Section>
        <Section
          title="Topics"
          footer={(
            <Help>
              Adds From an image to New topic: photograph a grammar book page or pick a screenshot, and Claude names
              the grammar point for you to edit. The image goes to Claude through your server and isn't saved there or
              on this iPhone.
            </Help>
          )}
        >
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
        </Section>
        <Section
          title="Videos"
          footer={(
            <Help>
              Adds A video to New text: share a YouTube video to Franki or paste its link, and read its subtitles under it
              as it plays. Your server asks YouTube for the subtitles, and the video plays in YouTube's own player, with its
              ads. YouTube can change how its subtitles are read, so a video may sometimes fail to add.
            </Help>
          )}
        >
          <Group>
            <SwitchRow
              first
              label="Watch videos with their subtitles"
              value={videos}
              onValueChange={(on) => {
                savePrefs({ videos: on });
                setVideos(on);
              }}
            />
          </Group>
        </Section>
        <Section
          title="Podcasts"
          footer={(
            <Help>
              Adds A podcast to New text: find a show in Apple's podcast directory, paste its feed or an Apple Podcasts
              link, or share an episode to Franki, and read its transcript as it plays. Only episodes that publish a
              transcript can be added. Your server asks Apple's directory and the show's feed, and this iPhone plays the
              episode from the show's own site.
            </Help>
          )}
        >
          <Group>
            <SwitchRow
              first
              label="Listen to podcasts with their transcripts"
              value={podcasts}
              onValueChange={(on) => {
                savePrefs({ podcasts: on });
                setPodcasts(on);
              }}
            />
          </Group>
        </Section>
        <Section
          title="Hear texts again"
        >
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
        </Section>
        <Section
          title="Meanings"
          footer={(
            <Help>
              With Recall before the meaning on, a word from your deck keeps its meaning hidden until you tap Show
              meaning, so you can try to remember it first. With the quiz on, you pick its meaning from four choices
              instead. Words not in your deck show their meaning at once.
            </Help>
          )}
        >
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
        </Section>
        <Section
          title="Word forms"
          footer={(
            <Help>
              In a longer text, a few words you know are hidden behind a question mark. Tap one, type the form that
              fits the sentence from its dictionary form, and the word comes back. It's for languages that change
              their words (cases, endings), so there are none in Thai.
            </Help>
          )}
        >
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
        </Section>
        <Section
          title="Explain"
          footer={(
            <Help>
              Writes Explain's notes in the language you're reading, in simple words, instead of English. A phrase's
              English meaning stays in English. Applies to Explain more simply too.
            </Help>
          )}
        >
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
        </Section>
        <Section
          title="Thai pronunciation"
          footer={(
            <Help>
              A Thai word's IPA writes its tones as tone letters (hen˩˩˦). With this on, the word's popup and your
              marked words show accent marks instead: ǎ rising, â falling, á high, à low, and no mark for the mid
              tone (hěn). The Pronunciation field of a card you add keeps the tone letters.
            </Help>
          )}
        >
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
        </Section>
      </ScrollView>
    </Screen>
  );
}
