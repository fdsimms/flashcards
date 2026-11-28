import { Stack, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { candidateWord, lessonWordHint, noCandidatesText, type LessonWordCandidate } from '../../core/lessonWords';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Field, Help, RemovableChip, Screen, Tappable } from '../kit';
import { CandidateChips } from '../cram/CramBits';
import { radius, smooth, readable, space, type, useTheme } from '../theme';
import { useLessonWords } from './useLessonWords';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { leaveScreen } from '../leaveScreen';
import { LESSONS_PATH } from '../tabPaths';
import { withThaiLineHeight } from '../../core/script';

/**
 * Type a word for an audio lesson: for words from a tutor or a book that aren't in a deck. It joins
 * this lesson's draft only (useLessonWords) and is never saved as a note. A word that can't be added
 * says why under the field that needs changing.
 *
 * What's typed may be romanization, English or a spelling by ear, which the voice would read as if it were
 * the language's own writing: Find word lists the words it could be with their readings and meanings, and
 * the one picked joins the lesson as the language's own writing, with its meaning. There is no meaning to type.
 */
export function LessonWordAdd({ language, findWords }: { language: Language; findWords: (text: string) => Promise<LessonWordCandidate[]> }) {
  const c = useTheme();
  const router = useRouter();
  const { words, add, remove } = useLessonWords(language);
  const { bottomPadding } = useKeyboardScroll();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string>();
  /** A failure, shown as an ErrorNote; `problem` is what to fix in what was typed. */
  const [failed, setFailed] = useState<string>();
  const [candidates, setCandidates] = useState<LessonWordCandidate[]>();
  const [picked, setPicked] = useState<LessonWordCandidate>();
  const [finding, setFinding] = useState(false);
  // Counts the looks up asked for and the edits since, so an answer for words the field no longer holds is dropped.
  const asked = useRef(0);
  const name = LANGUAGES[language].name;
  // Only what was typed in here: a word chosen from a deck has a note, and is taken out from the picker.
  const typed = words.filter((w) => !w.noteId);

  const edit = (next: string) => {
    asked.current += 1;
    setText(next);
    setCandidates(undefined);
    setPicked(undefined);
    setFinding(false);
    setProblem(undefined); setFailed(undefined);
  };

  const find = async () => {
    const mine = ++asked.current;
    setProblem(undefined); setFailed(undefined);
    setCandidates(undefined);
    setPicked(undefined);
    setFinding(true);
    try {
      const found = await findWords(text.trim());
      if (asked.current !== mine) return;
      setCandidates(found);
      if (!found.length) setProblem(noCandidatesText(text, name));
      else if (found.length === 1) setPicked(found[0]);
    } catch (e) {
      if (asked.current !== mine) return;
      setFailed(failureText(e, { next: 'Try again.' }));
    } finally {
      if (asked.current === mine) setFinding(false);
    }
  };

  const addPicked = () => {
    if (!picked) return;
    setProblem(undefined); setFailed(undefined);
    try {
      add(candidateWord(picked));
      haptic.tap();
      edit('');
    } catch (e) {
      setFailed(failureText(e, { next: 'Try again.' }));
    }
  };

  return (
    <Screen title="Add a word" largeTitle={false}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button accessibilityLabel="Done adding words" onPress={() => leaveScreen(router, LESSONS_PATH)}>Done</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl + bottomPadding, gap: space.m }}>
        <Card>
          <Field label="Word" value={text} onChangeText={edit} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => { if (text.trim() && !finding) void find(); }} />
          <Help>{lessonWordHint(language, name)}</Help>
          {candidates?.length ? (
            <View style={{ gap: space.s }}>
              <Text style={{ ...type.subhead, color: c.textSecondary }}>{candidates.length === 1 ? 'Is this the one?' : 'Which one?'}</Text>
              {candidates.map((cand) => {
                const on = picked?.text === cand.text;
                return (
                  <Tappable
                    key={cand.text}
                    onPress={() => { haptic.tap(); setPicked(cand); }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={[cand.text, cand.reading, cand.english].filter(Boolean).join(', ')}
                    scaleTo={0.98}
                    // The border is always there, clear when not picked, so picking a card doesn't shift its text.
                    style={{ gap: space.xs, backgroundColor: on ? c.accentFill : c.fill, borderRadius: radius.m, ...smooth, borderWidth: 2, borderColor: on ? c.accent : 'transparent', padding: space.m - 2 }}
                  >
                    <Text style={{ ...withThaiLineHeight(type.title, cand.text), color: c.text }}>{cand.text}</Text>
                    <Text style={{ ...type.subhead, color: c.textSecondary }}>{[cand.reading, cand.english].filter(Boolean).join(' · ')}</Text>
                    <CandidateChips word={cand} />
                  </Tappable>
                );
              })}
            </View>
          ) : null}
          {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          {failed ? <ErrorNote message={failed} /> : null}
          {picked ? <Button label={`Add ${picked.text}`} onPress={addPicked} /> : <Button label="Find word" onPress={() => void find()} busy={finding} disabled={!text.trim()} />}
        </Card>
        <Help>Added to this lesson only. It isn't saved to a deck.</Help>
        {typed.length ? (
          <View style={{ gap: space.s }}>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>Added by hand</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {typed.map((w) => (
                <RemovableChip key={w.text} label={w.text} detail={w.english} onRemove={() => remove(w.text)} />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
