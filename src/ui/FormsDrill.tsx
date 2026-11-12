import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { checkAnswer, drillPrompts, type DrillRequest, type FormPrompt, type PracticeRecord, type Verdict } from '../core/forms';
import type { Repo } from '../db/repo';
import { haptic } from './haptics';
import { Button, Card, Field, Help, Icon, Screen, Segments, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

export type AnswerMode = 'pick' | 'type';

interface Answered {
  prompt: FormPrompt;
  given: string;
  verdict: Verdict;
  /** "Almost" that the user chose to count. */
  counted: boolean;
}

const isRight = (a: Answered) => a.verdict === 'right' || a.counted;

/**
 * Practicing forms: the prompts `request` asks for (`drillPrompts`), one at a time, then how it
 * went. Each answer is written as it's given (`addPractice`), before the drill moves on. Nothing
 * here touches a card's schedule or the Anki collection.
 */
export function FormsDrill({ repo, request, onDone }: { repo: Repo; request: DrillRequest; onDone: () => void }) {
  const c = useTheme();
  const [prompts, setPrompts] = useState<FormPrompt[] | null>(null);
  const [notice, setNotice] = useState<string>();
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [typed, setTyped] = useState('');
  // "In a sentence" is always typed; otherwise the last choice made, on any drill.
  const typeOnly = request.kind === 'pattern' && request.sentence;
  const [mode, setMode] = useState<AnswerMode>('pick');
  // Set while an answer is being written: a second tap must not answer the same prompt twice.
  const busy = useRef(false);

  useEffect(() => {
    (async () => {
      const [notes, cards, practice, saved] = await Promise.all([
        repo.listNotes(), repo.listCards(), repo.listPractice(), repo.formsAnswerMode(),
      ]);
      const built = drillPrompts(request, { notes, cards, practice });
      setMode(typeOnly ? 'type' : saved);
      setNotice(built.notice);
      setPrompts(built.prompts);
    })();
  }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!prompts) return <Screen title="Practice forms" largeTitle={false}><View /></Screen>;

  const done = index >= prompts.length;
  const prompt = prompts[index];
  const current = answered.length > index ? answered[index] : undefined;
  const picking = mode === 'pick' && !!prompt?.choices;

  const log = async (p: FormPrompt, correct: boolean, given: string) => {
    const record: PracticeRecord = { noteId: p.noteId, key: p.key, correct, practicedAt: new Date().toISOString(), given };
    await repo.addPractice(record);
  };

  const answer = async (given: string, picked = false) => {
    if (!prompt || current || busy.current) return;
    busy.current = true;
    try {
      // A pick is the form or it isn't: a choice one accent away is another form, not a typo.
      const verdict: Verdict = picked ? (prompt.answers.includes(given) ? 'right' : 'wrong') : checkAnswer(given, prompt.answers);
      await log(prompt, verdict === 'right', given);
      if (verdict === 'right') haptic.success(); else haptic.select();
      setAnswered((a) => [...a, { prompt, given, verdict, counted: false }]);
    } finally {
      busy.current = false;
    }
  };

  /** "Almost" counted as right: logged again as right, so the miss isn't what's remembered. */
  const countIt = async () => {
    if (!current || current.verdict !== 'almost' || current.counted || busy.current) return;
    busy.current = true;
    try {
      await log(current.prompt, true, current.given);
      setAnswered((a) => a.map((x, i) => (i === index ? { ...x, counted: true } : x)));
    } finally {
      busy.current = false;
    }
  };

  const next = () => { setTyped(''); setIndex((i) => i + 1); };

  const switchMode = (m: AnswerMode) => { setMode(m); repo.saveFormsAnswerMode(m); };

  const missed = answered.filter((a) => !isRight(a));
  const again = () => {
    setPrompts(missed.map((a) => a.prompt));
    setAnswered([]);
    setIndex(0);
    setTyped('');
  };

  if (!prompts.length) {
    return (
      <Screen title="Practice forms" largeTitle={false} footer={<Button label="Done" onPress={onDone} />}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.m }}>
          <Text style={{ ...type.headline, color: c.text }}>Nothing to practice</Text>
          <Help>None of these words list forms that can be asked here. Forms come from each note's Forms field, one per line, like "present · yo: espero".</Help>
          {notice ? <Help>{notice}</Help> : null}
        </ScrollView>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen
        title={`${answered.filter(isRight).length} of ${answered.length} right`}
        footer={
          <>
            {missed.length ? <Button label={missed.length === 1 ? 'Practice the missed one again' : 'Practice the missed ones again'} variant="secondary" onPress={again} /> : null}
            <Button label="Done" onPress={onDone} />
          </>
        }
      >
        <Summary answered={answered} notice={notice} />
      </Screen>
    );
  }

  const footer = current ? (
    <Button label={index === prompts.length - 1 ? 'See how it went' : 'Next'} onPress={next} />
  ) : !picking ? (
    <Button label="Check" onPress={() => answer(typed)} disabled={!typed.trim()} />
  ) : undefined;

  return (
    <Screen title={`${index + 1} of ${prompts.length}`} largeTitle={false} footer={footer}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.l, gap: space.xl, flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Progress through this practice"
          accessibilityValue={{ min: 0, max: prompts.length, now: index }}
          style={{ height: 4, borderRadius: 2, backgroundColor: c.fill, overflow: 'hidden' }}
        >
          <View style={{ width: `${(index / prompts.length) * 100}%`, height: 4, borderRadius: 2, backgroundColor: c.accent }} />
        </View>
        {typeOnly ? null : (
          <Segments<AnswerMode>
            options={[{ value: 'pick', label: 'Pick' }, { value: 'type', label: 'Type' }]}
            value={mode}
            onChange={switchMode}
          />
        )}
        <View style={{ flex: 1, justifyContent: 'center', gap: space.xl }}>
          <Question prompt={prompt} reveal={current ? prompt.answers[0] : undefined} />
          {picking ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {prompt.choices!.map((choice) => (
                <ChoiceButton key={choice} label={choice} state={choiceState(choice, prompt, current)} onPress={() => answer(choice, true)} />
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
              onSubmitEditing={() => { if (typed.trim()) answer(typed); }}
              error={!!current && !isRight(current)}
            />
          )}
          {mode === 'pick' && !prompt.choices ? <Help>This one is typed: there are no other forms to pick from.</Help> : null}
          {current ? <Feedback answered={current} onCount={countIt} /> : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** The word, what's asked, and the example sentence with a gap where the answer goes. */
function Question({ prompt, reveal }: { prompt: FormPrompt; reveal?: string }) {
  const c = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.s }}>
      <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
        {prompt.meaning ? `${prompt.headword} · ${prompt.meaning}` : prompt.headword}
      </Text>
      <Text style={{ ...type.cardFront, color: c.text, textAlign: 'center' }}>{prompt.label}</Text>
      {prompt.group ? (
        <View style={{ paddingHorizontal: space.m, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: c.fill }}>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>{prompt.group}</Text>
        </View>
      ) : null}
      {prompt.sentence ? (
        <View style={{ alignItems: 'center', gap: space.xs, marginTop: space.s }}>
          <Text style={{ ...type.title, fontWeight: '600', color: c.text, textAlign: 'center' }}>
            {prompt.sentence.before}
            <Text style={{ color: c.accent, textDecorationLine: 'underline' }}>{reveal ?? '_____'}</Text>
            {prompt.sentence.after}
          </Text>
          {prompt.sentence.translation ? (
            <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{prompt.sentence.translation}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type ChoiceState = 'open' | 'right' | 'wrongPick' | 'other';

function choiceState(choice: string, prompt: FormPrompt, current?: Answered): ChoiceState {
  if (!current) return 'open';
  if (choice === prompt.answers[0]) return 'right';
  return choice === current.given ? 'wrongPick' : 'other';
}

function ChoiceButton({ label, state, onPress }: { label: string; state: ChoiceState; onPress: () => void }) {
  const c = useTheme();
  const border = state === 'right' ? c.good : state === 'wrongPick' ? c.danger : c.border;
  return (
    <Tappable
      onPress={onPress}
      disabled={state !== 'open'}
      accessibilityRole="button"
      accessibilityLabel={state === 'right' ? `${label}, the answer` : state === 'wrongPick' ? `${label}, not it` : label}
      restOpacity={state === 'other' ? 0.6 : 1}
      style={{
        flexBasis: '48%', flexGrow: 1, minHeight: 64, paddingHorizontal: space.m, paddingVertical: space.m,
        flexDirection: 'row', gap: space.s, alignItems: 'center', justifyContent: 'center', borderRadius: radius.m, ...smooth,
        borderWidth: state === 'open' || state === 'other' ? hairline : 2, borderColor: border, backgroundColor: c.surface,
      }}
    >
      {state === 'right' ? <Icon name="checkmark" size={18} color={c.good} weight="bold" /> : null}
      <Text style={{ ...type.title, fontWeight: state === 'right' ? '700' : '400', color: c.text, textAlign: 'center' }}>{label}</Text>
    </Tappable>
  );
}

function Feedback({ answered, onCount }: { answered: Answered; onCount: () => void }) {
  const c = useTheme();
  const answer = answered.prompt.answers[0];
  if (answered.verdict === 'right') {
    return (
      <Card style={{ gap: space.xs }}>
        <Text style={{ ...type.headline, color: c.countDue }}>Right</Text>
      </Card>
    );
  }
  if (answered.verdict === 'almost') {
    return (
      <Card style={{ gap: space.xs }}>
        <Text style={{ ...type.headline, color: c.warning }}>{answered.counted ? `Counted as right: ${answer}` : `Almost: ${answer}`}</Text>
        <Help>Only an accent or a mark differs, and that can make it a different form.</Help>
        {answered.counted ? null : (
          <Tappable onPress={onCount} accessibilityRole="button" style={{ minHeight: MIN_TAP, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Text style={{ ...type.subhead, fontWeight: '600', color: c.accent }}>Count it as right</Text>
          </Tappable>
        )}
      </Card>
    );
  }
  return (
    <Card style={{ gap: space.xs }}>
      <Text style={{ ...type.headline, color: c.danger }}>{`Not quite: ${answer}`}</Text>
      {answered.prompt.answers.length > 1 ? <Help>{`Also right: ${answered.prompt.answers.slice(1).join(', ')}`}</Help> : null}
    </Card>
  );
}

function Summary({ answered, notice }: { answered: Answered[]; notice?: string }) {
  const c = useTheme();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
      <Card style={{ gap: 0, paddingVertical: space.xs }}>
        {answered.map((a, i) => (
          <View
            key={i}
            accessible
            accessibilityLabel={`${[a.prompt.headword, a.prompt.label, a.prompt.group].filter(Boolean).join(', ')}: ${a.prompt.answers[0]}. ${isRight(a) ? 'Right' : `Wrong, you answered “${a.given}”`}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52, paddingVertical: space.s, borderTopWidth: i ? hairline : 0, borderTopColor: c.border }}
          >
            <Text style={{ ...type.subhead, color: c.textSecondary, width: 130 }}>
              {[a.prompt.headword, a.prompt.label, a.prompt.group].filter(Boolean).join(' · ')}
            </Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.headline, color: c.text }}>{a.prompt.answers[0]}</Text>
              {a.verdict === 'almost' && a.counted ? <Text style={{ ...type.footnote, color: c.warning }}>Accent missed, counted as right</Text> : null}
              {!isRight(a) ? <Text style={{ ...type.footnote, color: c.danger }}>{`You answered “${a.given}”`}</Text> : null}
            </View>
            <Icon name={isRight(a) ? 'checkmark' : 'xmark'} size={18} color={isRight(a) ? c.countDue : c.danger} weight="bold" />
          </View>
        ))}
      </Card>
      <Help>Practice doesn't change when any card is next due.</Help>
      {notice ? <Help>{notice}</Help> : null}
    </ScrollView>
  );
}
