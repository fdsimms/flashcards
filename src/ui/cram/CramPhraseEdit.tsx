import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { cramLanguageOf, textKey } from '../../core/cram';
import { phraseKey, withPhraseEdited } from '../../core/cramPhrases';
import { failureText } from '../../core/failure';
import { ROMANIZED_LESSON_LANGUAGES } from '../../core/lessonWords';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, ErrorNote, Field, Help, Loading, Screen } from '../kit';
import { readable, space, type, useTheme } from '../theme';
import { cramsNow, saveCram, useCollection, useCrams } from '../useCrams';
import { useKeyboardScroll } from '../useKeyboardScroll';

/**
 * Editing one of a cram's phrases (its menu's Edit): the line in the language, its reading where the
 * language has one, and its English. A line that is already another phrase's is refused with the
 * reason, and changing the line unchecks it as used (`withPhraseEdited`). Writes only to the cram.
 */
export function CramPhraseEdit({ repo, id, text, onDone }: { repo: NoteStore; id: string; text: string; onDone: () => void }) {
  const c = useTheme();
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const { crams } = useCrams(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === id);
  const phrase = cram?.phrases?.find((p) => textKey(p.text) === textKey(text));
  const language = cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined;
  const [line, setLine] = useState<string>();
  const [reading, setReading] = useState<string>();
  const [english, setEnglish] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  /** A failure, shown as an ErrorNote; `problem` is what to fix in what was typed. */
  const [failed, setFailed] = useState<string>();

  if (!cram || !collection.loaded) return <Screen title="Edit phrase" largeTitle={false}><Loading /></Screen>;
  if (!phrase) {
    return <Screen title="Edit phrase" largeTitle={false}><ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l }}><Help>This phrase isn't in the cram anymore.</Help></ScrollView></Screen>;
  }
  const nextLine = line ?? phrase.text;
  const nextEnglish = english ?? phrase.english;
  const nextReading = reading ?? phrase.reading ?? '';
  const changed = nextLine !== phrase.text || nextEnglish !== phrase.english || nextReading !== (phrase.reading ?? '');
  const valid = !!nextLine.trim() && !!nextEnglish.trim();
  const save = async () => {
    if (saving || !valid) return;
    const now = cramsNow().find((x) => x.id === cram.id) ?? cram;
    const next = { text: nextLine, english: nextEnglish, reading: nextReading };
    if (phraseKey(next) !== phraseKey(phrase) && (now.phrases ?? []).some((p) => phraseKey(p) === phraseKey(next))) {
      setProblem('This cram already has that phrase.');
      return;
    }
    setSaving(true);
    setProblem(undefined); setFailed(undefined);
    haptic.tap();
    try {
      await saveCram(repo, withPhraseEdited(now, phrase.text, next));
      haptic.success();
      onDone();
    } catch (e) {
      setFailed(failureText(e, { what: "Couldn't save the phrase.", next: 'Try again.' }));
    } finally {
      setSaving(false);
    }
  };
  const speech = language ? LANGUAGES[language].speech : undefined;
  return (
    <Screen title="Edit phrase" largeTitle={false} footer={<Button label="Save" busy={saving} disabled={!changed || !valid} onPress={() => { void save(); }} />}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ ...readable, padding: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }} {...scrollProps}>
        <Field label={language ? LANGUAGES[language].name : 'Phrase'} value={nextLine} onChangeText={setLine} autoCapitalize="none" autoCorrect={false} keyboardLanguage={speech} multiline />
        {language && ROMANIZED_LESSON_LANGUAGES.includes(language) ? (
          <Field label="Reading (optional)" value={nextReading} onChangeText={setReading} autoCapitalize="none" autoCorrect={false} />
        ) : null}
        <Field label="English" value={nextEnglish} onChangeText={setEnglish} multiline />
        {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
        {failed ? <ErrorNote message={failed} /> : null}
      </ScrollView>
    </Screen>
  );
}
