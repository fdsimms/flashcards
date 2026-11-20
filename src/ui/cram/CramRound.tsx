import { usePreventRemove } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { typeItAnswers } from '../../core/activeRecall';
import { isOmnilanguage, renderCard } from '../../core/cards';
import { cramNotes, lastMissed, withRound } from '../../core/cram';
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
import { Side } from '../CardSide';
import { haptic } from '../haptics';
import { Button, Card as Box, Field, Help, Loading, ProgressBar, Screen } from '../kit';
import { ListeningNote, SpeakButton } from '../SpeakButton';
import { readable, space, type, useTheme } from '../theme';
import { TypedDiff } from '../TypedDiff';
import { saveCram, useCollection, useCrams } from '../useCrams';
import { useSpokenAnswer } from '../useSpokenAnswer';
import { useWordAudio } from '../useWordAudio';

/**
 * One cram round (src/core/cramRound.ts): each word's meaning is asked and the word answered, typed
 * or spoken where the card is a word (Omnilanguage), then shown; Missed it brings it back a few
 * words later, Got it takes it out. Practice, never a rating: nothing here answers a card or
 * changes its schedule (tests/core/cramRound.test.ts), and the round is kept in the cram only once
 * every word is got. Leaving before that asks first.
 */
export function CramRound({ repo, id, onDone }: { repo: NoteStore; id: string; onDone: () => void }) {
  const c = useTheme();
  const { crams } = useCrams(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === id);
  const [round, setRound] = useState<RoundState | null>(null);
  const [number, setNumber] = useState(1);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState('');
  const [spokenIn, setSpokenIn] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [noteTypes, setNoteTypes] = useState<Map<string, NoteType>>(new Map());
  const [thaiSize, setThaiSize] = useState<ThaiTextSize>(DEFAULT_THAI_TEXT_SIZE);
  const playWord = useWordAudio(repo);
  const answered = useRef(0);

  useEffect(() => {
    repo.listNoteTypes().then(setNoteTypes, () => undefined);
    repo.thaiTextSize().then(setThaiSize, () => undefined);
  }, [repo]);
  // The round is made once, from the words as they are when it opens.
  useEffect(() => {
    if (round || !cram || !collection.loaded) return;
    setRound(startRound(cramNotes(cram, collection.notes).map((n) => n.id), lastMissed(cram)));
    setNumber(cram.rounds.length + 1);
  }, [cram, collection.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(collection.notes.map((n) => [n.id, n])), [collection.notes]);
  const wanted = useMemo(() => wantedLines(collection.notes), [collection.notes]);
  const noteId = round ? currentWord(round) : undefined;
  const note = noteId ? byId.get(noteId) : undefined;
  const omni = !!note && isOmnilanguage(note);
  // Meaning asked, word answered: the note's reverse card, whether or not it has one.
  const reverse = { kind: 'reverse' } as Card;
  const rendered = note && omni ? renderCard(note, 'reverse', wanted.get(note.id)) : undefined;
  const plain = note && !omni ? missedCardText(note, noteTypes.get(note.model), 't0') : undefined;
  const answers = note && omni ? typeItAnswers(note, reverse) : [];
  const language = note ? readerLanguageOf(note) : undefined;

  const spoken = useSpokenAnswer(rendered?.speechLang, {
    expected: answers,
    onBeforeListen: () => Keyboard.dismiss(),
    onHeard: (text) => { setSpokenIn(true); setTyped(text); },
  });
  useEffect(() => { spoken.cancel(); setTyped(''); setSpokenIn(false); setRevealed(false); }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A cram with no words has no round to do, and none is kept.
  const empty = !!round && round.noteIds.length === 0;
  const done = !!round && !empty && isRoundDone(round);
  usePreventRemove(!!round && !done && answered.current > 0, ({ repeat }) => {
    Alert.alert('End this round?', "It's kept only once every word is done.", [
      { text: 'Keep going', style: 'cancel' },
      { text: 'End round', style: 'destructive', onPress: repeat },
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
  };
  const mark = (got: boolean) => {
    if (!round) return;
    haptic.answer();
    answered.current++;
    setRound(answerWord(round, got));
  };

  if (!cram || !round) return <Screen title="Round" largeTitle={false}><Loading /></Screen>;
  if (empty) {
    return (
      <Screen title="Round" largeTitle={false} footer={<Button label="Done" onPress={onDone} />}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l }}>
          <Help>{`${cram.name} has no words yet. Add some from its page, then start a round.`}</Help>
        </ScrollView>
      </Screen>
    );
  }
  const n = number;
  const total = round.noteIds.length;

  if (done) {
    const missed = round.missed.map((id) => byId.get(id)).filter((x): x is Note => !!x);
    return (
      <Screen title={`Round ${n}`} largeTitle={false} footer={<Button label="Done" onPress={onDone} />}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
          <Text style={{ ...type.title, color: c.text }}>Round done</Text>
          <Help>
            {missed.length
              ? `You missed ${missed.length === 1 ? '1 word' : `${missed.length} words`} at first. The next round asks ${missed.length === 1 ? 'it' : 'them'} first.`
              : `You got all ${total === 1 ? 'of it' : `${total} words`} the first time.`}
          </Help>
          {missed.length ? <Help>{missed.map(headword).join(', ')}</Help> : null}
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
      title={`Round ${n}`}
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
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        <ProgressBar value={(total - wordsLeft(round)) / Math.max(1, total)} label="Words got this round" />
        <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'right' }}>{`${wordsLeft(round)} left`}</Text>
        {!note ? (
          <Help>This word isn't in your decks anymore.</Help>
        ) : (
          <Box style={{ gap: space.m }}>
            {rendered ? (
              <>
                <Text style={{ ...type.overline, color: c.textSecondary }}>{language ? `Say it in ${languageName(language)}` : 'Say the word'}</Text>
                <Side key={`${note.id}-front`} side={rendered.front} which="front" showHints={false} thaiSize={thaiSize} speechLang={rendered.speechLang} />
                {revealed ? (
                  <>
                    <View style={{ height: 1, backgroundColor: c.border }} />
                    <Side key={`${note.id}-back`} side={rendered.back} which="back" showHints thaiSize={thaiSize} speechLang={rendered.speechLang} />
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
    </Screen>
  );
}
