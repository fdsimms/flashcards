import React, { useState } from 'react';
import { ActionSheetIOS, Text, View } from 'react-native';
import { withQuestion, withoutQuestion, type Cram } from '../../core/cram';
import { failureText } from '../../core/failure';
import type { NoteStore } from '../../anki/noteService';
import { haptic } from '../haptics';
import { Divider, Field, Group, Icon, SectionTitle, Tappable } from '../kit';
import { MIN_TAP, space, type, useTheme } from '../theme';
import { saveCram } from '../useCrams';

/** A question's id: the time and a few random letters, unique enough within one cram. */
const questionId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Ask my tutor, on a cram's page: questions to bring to the lesson (how to say something, a grammar
 * point), typed in English or the language. Return adds one and keeps the keyboard up for the next;
 * a tap on one offers to remove it. Lesson mode checks them off.
 */
export function CramQuestions({ repo, cram }: { repo: NoteStore; cram: Cram }) {
  const c = useTheme();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string>();
  const questions = cram.questions ?? [];
  const keep = (next: Cram | undefined) => {
    if (!next) return;
    setProblem(undefined);
    saveCram(repo, next).catch((e) => setProblem(failureText(e, { what: "Couldn't save the question.", next: 'Try again.' })));
  };
  const add = () => {
    const next = withQuestion(cram, draft, questionId());
    if (!next) { setDraft(''); return; }
    haptic.tap();
    setDraft('');
    keep(next);
  };
  const menu = (id: string, text: string) => {
    haptic.tap();
    ActionSheetIOS.showActionSheetWithOptions(
      { title: text, options: ['Remove', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => { if (i === 0) keep(withoutQuestion(cram, id)); },
    );
  };
  return (
    <View style={{ gap: space.s }}>
      <SectionTitle>Ask my tutor</SectionTitle>
      {questions.length ? (
        <Group>
          {questions.map((q, i) => (
            <Tappable
              key={q.id}
              onPress={() => menu(q.id, q.text)}
              accessibilityRole="button"
              accessibilityLabel={`${q.text}${q.asked ? ', asked' : ''}. Opens a menu.`}
              scaleTo={0.99}
              style={{ minHeight: MIN_TAP + space.s, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s + 2, paddingHorizontal: space.l }}
            >
              {i === 0 ? null : <Divider inset={space.l} />}
              <Icon name={q.asked ? 'checkmark.circle.fill' : 'questionmark.circle'} size={20} color={q.asked ? c.countDue : c.orange} />
              <Text style={{ ...type.body, color: q.asked ? c.textSecondary : c.text, flex: 1 }}>{q.text}</Text>
            </Tappable>
          ))}
        </Group>
      ) : null}
      <Field
        label={questions.length ? 'Another question' : 'A question to bring'}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={add}
        submitBehavior="submit"
        returnKeyType="done"
        placeholder={'e.g. How do I say "it went well"?'}
      />
      {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
    </View>
  );
}
