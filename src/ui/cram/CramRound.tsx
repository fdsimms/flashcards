import { usePreventRemove } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { typeItAnswers } from '../../core/activeRecall';
import { isOmnilanguage, renderCard } from '../../core/cards';
import { cramLanguageOf, cramNotes, lastMissed, practiceWords, withRound } from '../../core/cram';
import { isPhraseRoundId, phraseOfRoundId, phraseRoundId } from '../../core/cramPhrases';
import { answerWord, currentWord, isRoundDone, roundRecord, startRound, wordsLeft, type RoundState } from '../../core/cramRound';
import { failureText } from '../../core/failure';
import { headword } from '../../core/forms';
import { readerLanguageOf } from '../../core/leechHint';
import { missedCardText } from '../../core/missedCard';
import { DEFAULT_THAI_TEXT_SIZE, type ThaiTextSize } from '../../core/script';
import { wantedLines } from '../../core/synonyms';
import { compareTypedAnswer } from '../../core/typedCompare';
import type { Card, Note, NoteType } from '../../core/types';
import { languageName } from '../../core/voices';
import { LANGUAGES } from '../../reader/languages';
import { usePhoneSpeech } from '../usePhoneSpeech';
import { Side } from '../CardSide';
import { haptic } from '../haptics';
import { Button, Card as Box, Field, Help, Loading, ProgressBar, Screen } from '../kit';
import { ListeningNote, SpeakButton } from '../SpeakButton';
import { readable, space, type, useTheme } from '../theme';
import { TypedDiff } from '../TypedDiff';
import { saveCram, useCollection, useCrams } from '../useCrams';
import { useSpokenAnswer } from '../useSpokenAnswer';
import { useCardGlossing } from '../useCardGlossing';
import { useCardGlosses } from '../useCardGlosses';
import { useWordAudio } from '../useWordAudio';
import { useKeyboardScroll } from '../useKeyboardScroll';

const phrasesInRound = (ids: string[]) => ids.some(isPhraseRoundId);
const onlyPhrases = (ids: string[]) => ids.every(isPhraseRoundId);

/**
 * Practicing a cram (src/core/cramRound.ts), any time: the words not solid yet (every word once all
 * are, `practiceWords`) and every phrase (English asked, the phrase said, then shown: `phraseRoundId`), each word's meaning asked and the word answered, typed or spoken where the
 * card is a word (Omnilanguage), then shown; Missed it brings it back a few words later, Got it takes
 * it out. Practice, never a rating: nothing here answers a card or changes its schedule
 * (tests/core/cramRound.test.ts), and the pass is kept in the cram only once every word is got.
 * Leaving before that asks first.
 */
export function CramRound({ repo, id, onDone }: { repo: NoteStore; id: string; onDone: () => void }) {
  const c = useTheme();
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const { crams } = useCrams(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === id);
  const [round, setRound] = useState<RoundState | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState('');
  const [spokenIn, setSpokenIn] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [noteTypes, setNoteTypes] = useState<Map<string, NoteType>>(new Map());
  const [thaiSize, setThaiSize] = useState<ThaiTextSize>(DEFAULT_THAI_TEXT_SIZE);
  const playWord = useWordAudio(repo);
  // The back's example sentence, its words tapped for their meanings as in Review, while Read & Listen is signed in.
  const glossing = useCardGlossing(repo);
  const phone = usePhoneSpeech(repo);
  const answered = useRef(0);
  // Counts answers, so the screen resets for the next showing even when it is the same word again
  // (Missed it on the last word left puts that word straight back).
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    repo.listNoteTypes().then(setNoteTypes, () => undefined);
    repo.thaiTextSize().then(setThaiSize, () => undefined);
  }, [repo]);
  // The round is made once, from the words as they are when it opens.
  useEffect(() => {
    if (round || !cram || !collection.loaded) return;
    // The notes not solid yet, then every phrase (a phrase has no solid state, so each round goes through them all).
    setRound(startRound([...practiceWords(cram, cramNotes(cram, collection.notes).map((n) => n.id)), ...(cram.phrases ?? []).map(phraseRoundId)], lastMissed(cram)));
  }, [cram, collection.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(collection.notes.map((n) => [n.id, n])), [collection.notes]);
  const wanted = useMemo(() => wantedLines(collection.notes), [collection.notes]);
  const noteId = round ? currentWord(round) : undefined;
  const phrase = noteId && cram && isPhraseRoundId(noteId) ? phraseOfRoundId(cram, noteId) : undefined;
  const onPhrase = !!noteId && isPhraseRoundId(noteId);
  const note = noteId && !onPhrase ? byId.get(noteId) : undefined;
  const cramLanguage = cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined;
  const omni = !!note && isOmnilanguage(note);
  // Meaning asked, word answered: the note's reverse card, whether or not it has one.
  const reverse = { kind: 'reverse' } as Card;
  // The cards a round shows, for useCardGlosses to ask about their sentences (a word's home deck is its note's).
  const roundCards = useMemo(() => (round?.noteIds ?? []).filter((id) => byId.has(id)).map((id) => ({ noteId: id, kind: 'reverse' }) as Card), [round?.noteIds, byId]);
  const glossFor = useCardGlosses(glossing, roundCards, byId);
  const rendered = note && omni ? renderCard(note, 'reverse', wanted.get(note.id)) : undefined;
  const plain = note && !omni ? missedCardText(note, noteTypes.get(note.model), 't0') : undefined;
  const answers = note && omni ? typeItAnswers(note, reverse) : [];
  const language = note ? readerLanguageOf(note) : undefined;

  const spoken = useSpokenAnswer(rendered?.speechLang, {
    expected: answers,
    onBeforeListen: () => Keyboard.dismiss(),
    onHeard: (text) => { setSpokenIn(true); setTyped(text); },
  });
  useEffect(() => { spoken.cancel(); setTyped(''); setSpokenIn(false); setRevealed(false); }, [noteId, turn]); // eslint-disable-line react-hooks/exhaustive-deps

  // A cram with no words has no round to do, and none is kept.
  const empty = !!round && round.noteIds.length === 0;
  const done = !!round && !empty && isRoundDone(round);
  usePreventRemove(!!round && !done && answered.current > 0, ({ repeat }) => {
    Alert.alert('Stop practicing?', 'Your answers count only once every word is done.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: repeat },
    ]);
  });

  // Kept once every word is got.
  useEffect(() => {
    if (!done || saved || !cram || !round) return;
    setSaved(true);
    haptic.success();
    // On a failure `saved` stays set, so it isn't tried again until Try again clears it.
    saveCram(repo, withRound(cram, roundRecord(round, new Date()))).catch((e) => {
      setProblem(failureText(e, { what: "Couldn't save the round.", next: 'Try again.' }));
    });
  }, [done, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const reveal = () => {
    haptic.tap();
    Keyboard.dismiss();
    spoken.cancel();
    setRevealed(true);
    if (note && language) playWord(headword(note), language).catch(() => undefined);
    if (phrase && cramLanguage) phone.sayLine(phrase.text, LANGUAGES[cramLanguage].speech, false);
  };
  const mark = (got: boolean) => {
    if (!round) return;
    haptic.answer();
    answered.current++;
    setTurn(answered.current);
    setRound(answerWord(round, got));
  };

  if (!cram || !round) return <Screen title="Practice" largeTitle={false}><Loading /></Screen>;
  if (empty) {
    return (
      <Screen title="Practice" largeTitle={false} footer={<Button label="Done" onPress={onDone} />}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l }}>
          <Help>{`${cram.name} has no words or phrases yet. Add some from its page, then practice them.`}</Help>
        </ScrollView>
      </Screen>
    );
  }
  const total = round.noteIds.length;

  if (done) {
    const missedNotes = round.missed.map((id) => byId.get(id)).filter((x): x is Note => !!x);
    const missedPhrases = round.missed.flatMap((id) => phraseOfRoundId(cram, id) ?? []);
    const missedCount = missedNotes.length + missedPhrases.length;
    const noun = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
    const missedWhat = [missedNotes.length ? noun(missedNotes.length, 'word', 'words') : '', missedPhrases.length ? noun(missedPhrases.length, 'phrase', 'phrases') : ''].filter(Boolean).join(' and ');
    const gotAll = round.noteIds.length === 1 ? 'of it' : phrasesInRound(round.noteIds) ? `${total} ${onlyPhrases(round.noteIds) ? 'phrases' : 'words and phrases'}` : `${total} words`;
    return (
      <Screen title="Practice" largeTitle={false} footer={<Button label="Done" onPress={onDone} />}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
          <Text style={{ ...type.title, color: c.text }}>Done</Text>
          <Help>
            {missedCount
              ? `You missed ${missedWhat} the first time. Practice again any time and ${missedCount === 1 ? "it'll" : "they'll"} come first.`
              : `You got all ${gotAll} the first time.`}
          </Help>
          {missedCount ? <Help>{[...missedNotes.map(headword), ...missedPhrases.map((p) => p.text)].join(', ')}</Help> : null}
          {problem ? (
            <>
              <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text>
              <Button variant="secondary" label="Try again" onPress={() => { setProblem(undefined); setSaved(false); }} />
            </>
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  const comparison = revealed && typed.trim() && answers.length ? compareTypedAnswer(answers, typed, rendered?.speechLang) : undefined;
  return (
    <Screen
      title="Practice"
      largeTitle={false}
      footer={revealed ? (
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button variant="secondary" label="Missed it" style={{ flex: 1 }} onPress={() => mark(false)} />
          <Button label="Got it" style={{ flex: 1 }} onPress={() => mark(true)} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
          {omni ? <SpeakButton spoken={spoken} /> : null}
          <Button label={typed.trim() ? 'Check' : 'Show answer'} style={{ flex: 1 }} onPress={reveal} />
        </View>
      )}
    >
      {/* Tapping empty space shows the answer, as on any card. Not an accessibility element itself: Show answer is the control VoiceOver uses. */}
      <Pressable accessible={false} disabled={revealed} onPress={() => { haptic.select(); reveal(); }} style={{ flex: 1 }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, padding: space.l, paddingBottom: space.l + bottomPadding, gap: space.m, flexGrow: 1 }} keyboardDismissMode="interactive" {...scrollProps}>
        <ProgressBar value={(total - wordsLeft(round)) / Math.max(1, total)} label={phrasesInRound(round.noteIds) ? "Words and phrases you've gotten so far" : "Words you've gotten so far"} />
        <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'right' }}>{`${wordsLeft(round)} left`}</Text>
        {onPhrase ? (
          phrase ? (
            <Box style={{ gap: space.m }}>
              <Text style={{ ...type.overline, color: c.textSecondary }}>{cramLanguage ? `Say it in ${languageName(cramLanguage)}` : 'Say it'}</Text>
              <Text style={{ ...type.title, color: c.text }}>{phrase.english}</Text>
              {revealed ? (
                <>
                  <View style={{ height: 1, backgroundColor: c.border }} />
                  <Text style={{ ...type.title, color: c.text }}>{phrase.text}</Text>
                  {phrase.reading ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{phrase.reading}</Text> : null}
                </>
              ) : null}
            </Box>
          ) : (
            <Help>This phrase isn't in the cram anymore.</Help>
          )
        ) : !note ? (
          <Help>This word isn't in your decks anymore.</Help>
        ) : (
          <Box style={{ gap: space.m }}>
            {rendered ? (
              <>
                <Text style={{ ...type.overline, color: c.textSecondary }}>{language ? `Say it in ${languageName(language)}` : 'Say the word'}</Text>
                <Side key={`${note.id}-front`} side={rendered.front} which="front" showHints={revealed} thaiSize={thaiSize} speechLang={rendered.speechLang} />
                {revealed ? (
                  <>
                    <View style={{ height: 1, backgroundColor: c.border }} />
                    <Side key={`${note.id}-back`} side={rendered.back} which="back" showHints thaiSize={thaiSize} speechLang={rendered.speechLang} gloss={glossFor(reverse, note)} />
                  </>
                ) : null}
              </>
            ) : (
              <>
                <Text style={{ ...type.title, color: c.text }}>{plain?.question || headword(note)}</Text>
                {revealed ? <Text style={{ ...type.headline, color: c.text }}>{plain?.answer ?? ''}</Text> : null}
              </>
            )}
            {comparison ? <TypedDiff comparison={comparison} showExpected={false} lang={rendered?.speechLang} typedLabel={spokenIn ? 'You said' : 'Yours'} /> : null}
          </Box>
        )}
        {!revealed && omni ? (
          <>
            <Field label="Type it (or say it)" value={typed} onChangeText={(t) => { setTyped(t); setSpokenIn(false); }} onSubmitEditing={reveal} autoCapitalize="none" autoCorrect={false} keyboardLanguage={rendered?.speechLang} placeholder="Type the word" />
            {language ? <ListeningNote spoken={spoken} language={languageName(language)} /> : null}
          </>
        ) : null}
      </ScrollView>
      </Pressable>
    </Screen>
  );
}
