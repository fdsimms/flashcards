import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { checkAnswer } from '../../core/forms';
import { grammarPoint } from '../../core/grammar';
import { DRILL_QUESTIONS, drillPrompts, missingNote, type DrillPrompt } from '../../core/grammarDrills';
import type { Repo } from '../../db/repo';
import { ApiError, type Api } from '../../reader/api';
import { ChoiceButton, type ChoiceState } from '../FormsDrill';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Field, Help, Loading, Screen, Segments } from '../kit';
import { radius, space, type, useTheme } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { Status } from './ToolScreen';

type AnswerMode = 'pick' | 'type';

interface Answered {
  prompt: DrillPrompt;
  given: string;
  right: boolean;
  /** Typed with only an accent or a mark off: shown, but counted wrong, since that can be another form. */
  almost: boolean;
}

/**
 * One grammar drill (docs/grammar.md, step 5): the server's questions on `points`, one at a time,
 * picked or typed, each answer written to the phone as it's given (`addGrammarAnswer`), then how
 * it went. Nothing here touches a card.
 */
export function GrammarDrill({ api, repo, points, onDone }: { api: Api; repo: Repo; points: string[]; onDone: () => void }) {
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const c = useTheme();
  const [prompts, setPrompts] = useState<DrillPrompt[] | null>(null);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [typed, setTyped] = useState('');
  const [mode, setMode] = useState<AnswerMode>('pick');
  // One id for the drill: its answers count together when the next drill is worked out.
  const drillId = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  // Set while an answer is being written: a second tap must not answer the same question twice.
  const busy = useRef(false);

  const load = async () => {
    setError(null);
    try {
      const [set, saved] = await Promise.all([api.drills(points, DRILL_QUESTIONS), repo.formsAnswerMode()]);
      setMode(saved);
      setNote(missingNote(set.missing, set.writing));
      setPrompts(drillPrompts(set.questions));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : failureText(e, { what: "Couldn't load the drill.", next: 'Try again.' }));
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const title = points.length === 1 ? grammarPoint(points[0])?.name ?? 'Grammar' : 'Grammar';
  if (error) {
    return (
      <Screen title={title} largeTitle={false} footer={<Button label="Done" onPress={onDone} />}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l }}>
          <ErrorNote message={error} onRetry={load} />
        </ScrollView>
      </Screen>
    );
  }
  if (!prompts) return <Screen title={title} largeTitle={false}><Loading /></Screen>;

  if (!prompts.length) {
    return (
      <Screen title={title} largeTitle={false} footer={<Button label="Done" onPress={onDone} />}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.m }}>
          <Text style={{ ...type.headline, color: c.text }}>No questions yet</Text>
          {note ? <Help>{note}</Help> : null}
        </ScrollView>
      </Screen>
    );
  }

  const prompt = prompts[index];
  const current = answered.length > index ? answered[index] : undefined;

  if (index >= prompts.length) {
    const right = answered.filter((a) => a.right).length;
    const byPoint = [...new Set(answered.map((a) => a.prompt.pointId))].map((id) => {
      const mine = answered.filter((a) => a.prompt.pointId === id);
      return { id, right: mine.filter((a) => a.right).length, total: mine.length };
    });
    return (
      <Screen title={`${right} of ${answered.length} right`} footer={<Button label="Done" onPress={onDone} />}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
          <Card style={{ gap: space.s }}>
            {byPoint.map((p) => (
              <Text key={p.id} style={{ ...type.body, color: c.text }}>
                <Text style={{ fontWeight: '600' }}>{grammarPoint(p.id)?.name ?? p.id}</Text>
                {`: ${p.right} of ${p.total} right`}
              </Text>
            ))}
          </Card>
          <Help>A point with 8 in 10 right comes back later than last time; one with fewer comes back tomorrow. Answers stay on this phone and never change a card.</Help>
          {note ? <Help>{note}</Help> : null}
        </ScrollView>
      </Screen>
    );
  }

  const picking = mode === 'pick' || !prompt.typable;

  const answer = async (given: string, picked: boolean) => {
    if (current || busy.current) return;
    busy.current = true;
    try {
      const verdict = picked ? (given === prompt.answer ? 'right' : 'wrong') : checkAnswer(given, [prompt.answer]);
      const right = verdict === 'right';
      await repo.addGrammarAnswer({ pointId: prompt.pointId, drillId: drillId.current, kind: prompt.kind, correct: right, answeredAt: new Date().toISOString() });
      if (right) haptic.success(); else haptic.select();
      setAnswered((a) => [...a, { prompt, given, right, almost: verdict === 'almost' }]);
    } catch (e) {
      Alert.alert("Couldn't save this answer", failureText(e, { next: 'The question is still here: answer it again.' }));
    } finally {
      busy.current = false;
    }
  };
  const next = () => { setTyped(''); setIndex((i) => i + 1); };
  const switchMode = (m: AnswerMode) => { setMode(m); repo.saveFormsAnswerMode(m); };
  const state = (choice: string): ChoiceState => (!current ? 'open' : choice === prompt.answer ? 'right' : choice === current.given ? 'wrongPick' : 'other');
  const point = grammarPoint(prompt.pointId);

  const footer = current
    ? <Button label={index === prompts.length - 1 ? 'See how it went' : 'Next'} onPress={next} />
    : !picking ? <Button label="Check" onPress={() => answer(typed, false)} disabled={!typed.trim()} /> : undefined;

  return (
    <Screen title={`${index + 1} of ${prompts.length}`} largeTitle={false} footer={footer}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.l, paddingBottom: space.l + bottomPadding, gap: space.xl, width: '100%', maxWidth: 640, alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
      >
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Progress through this drill"
          accessibilityValue={{ min: 0, max: prompts.length, now: index }}
          style={{ height: 4, borderRadius: 2, backgroundColor: c.fill, overflow: 'hidden' }}
        >
          <View style={{ width: `${(index / prompts.length) * 100}%`, height: 4, borderRadius: 2, backgroundColor: c.accent }} />
        </View>
        {prompt.typable ? (
          <Segments<AnswerMode> options={[{ value: 'pick', label: 'Pick' }, { value: 'type', label: 'Type' }]} value={mode} onChange={switchMode} />
        ) : null}

        <View style={{ alignItems: 'center', gap: space.s }}>
          {prompt.label ? (
            <View style={{ paddingHorizontal: space.m, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: c.fill }}>
              <Text style={{ ...type.subhead, color: c.textSecondary }}>{prompt.label}</Text>
            </View>
          ) : null}
          <Text
            // Until it's answered, VoiceOver reads the gap as "blank" rather than the underscores.
            accessibilityLabel={prompt.kind === 'which' || current ? undefined : `${prompt.before.trimEnd()} blank ${prompt.after.trimStart()}`.trim()}
            style={{ ...type.title, fontWeight: '600', color: c.text, textAlign: 'center' }}
          >
            {prompt.before}
            {prompt.kind === 'which' || current ? (
              <Text style={{ color: prompt.kind === 'gap' ? c.accent : c.text, textDecorationLine: 'underline', textDecorationColor: c.accent }}>{prompt.middle}</Text>
            ) : (
              <Text style={{ color: c.accent }}>_____</Text>
            )}
            {prompt.after}
          </Text>
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{prompt.english}</Text>
          {prompt.source ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{prompt.source}</Text> : null}
        </View>

        {picking ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {prompt.choices.map((choice) => (
              <ChoiceButton key={choice} label={choice} state={state(choice)} onPress={() => answer(choice, true)} />
            ))}
          </View>
        ) : (
          <Field
            key={index}
            label="Your answer"
            value={current ? current.given : typed}
            onChangeText={setTyped}
            editable={!current}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => { if (typed.trim()) answer(typed, false); }}
            error={!!current && !current.right}
          />
        )}

        {current ? (
          <Card style={{ gap: space.xs }}>
            {current.right
              ? <Status tone="good">Right.</Status>
              : <Status tone="bad">{`${current.almost ? 'Almost' : 'Not quite'}. It's ${prompt.answer}.`}</Status>}
            {current.almost ? <Help>Only an accent or a mark differs, and here that makes it another form, so it counts as wrong.</Help> : null}
            {point ? (
              <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.s, marginTop: space.xs }}>
                <Text style={{ ...type.footnote, color: c.textSecondary }}>
                  <Text style={{ fontWeight: '600', color: c.text }}>{`${point.name}.`}</Text>
                  {` ${point.note}.`}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
