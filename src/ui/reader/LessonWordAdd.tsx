import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, Card, Field, Help, Icon, Screen, Tappable } from '../kit';
import { radius, readable, space, type, useTheme } from '../theme';
import { useLessonWords } from './useLessonWords';

/**
 * Type a phrase for an audio lesson: for words from a tutor or a book that aren't in a deck. It joins
 * this lesson's draft only (useLessonWords) and is never saved as a note. A phrase that can't be added
 * says why under the field that needs changing.
 */
export function LessonWordAdd({ language }: { language: Language }) {
  const c = useTheme();
  const router = useRouter();
  const { words, add, remove } = useLessonWords(language);
  const [text, setText] = useState('');
  const [english, setEnglish] = useState('');
  const [problem, setProblem] = useState<string>();
  const name = LANGUAGES[language].name;
  // Only what was typed in here: a word chosen from a deck has a note, and is taken out from the picker.
  const typed = words.filter((w) => !w.noteId);

  const submit = () => {
    setProblem(undefined);
    try {
      add({ text, english });
      haptic.tap();
      setText('');
      setEnglish('');
    } catch (e) {
      setProblem(failureText(e, { next: 'Try again.' }));
    }
  };

  return (
    <Screen title="Add a phrase" largeTitle={false}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button accessibilityLabel="Done adding phrases" onPress={() => router.back()}>Done</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Card>
          <Field label={name} value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} keyboardLanguage={LANGUAGES[language].speech} returnKeyType="next" />
          <Field label="Meaning" value={english} onChangeText={setEnglish} keyboardLanguage="en-US" error={!!problem} returnKeyType="done" onSubmitEditing={submit} />
          {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          <Button label="Add phrase" onPress={submit} disabled={!text.trim() || !english.trim()} />
        </Card>
        <Help>Added to this lesson only. It isn't saved to a deck.</Help>
        {typed.length ? (
          <View style={{ gap: space.s }}>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>Added by hand</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {typed.map((w) => (
                <Tappable
                  key={w.text}
                  onPress={() => { haptic.tap(); remove(w.text); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${w.text}, ${w.english}`}
                  scaleTo={0.95}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, backgroundColor: c.accentFill, borderRadius: radius.pill, paddingVertical: space.xs + 2, paddingLeft: space.m, paddingRight: space.s }}
                >
                  <Text style={{ ...type.subhead, color: c.accentInk }}>{w.text}</Text>
                  <Text style={{ ...type.caption, color: c.textSecondary }}>{w.english}</Text>
                  <Icon name="xmark" size={11} color={c.textSecondary} />
                </Tappable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
