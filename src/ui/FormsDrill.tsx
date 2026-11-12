import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { checkAnswer, type FormPrompt, type Verdict } from '../core/forms';
import { Button, Card, Chip, Field, Help, Screen } from './kit';
import { MIN_TAP, radius, space, type, useTheme } from './theme';

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
 * Practicing forms, full screen over whatever opened it (Review, a deck's practice screen), so
 * that screen keeps its place. Each answer is handed to `onAnswer` as it's given, which writes it
 * before the drill moves on. Nothing here touches the card's schedule.
 */
export function FormsDrill(props: {
  prompts: FormPrompt[];
  /** Where Back goes: "Back to card", "Back to deck". */
  backLabel: string;
  mode: AnswerMode;
  /** When true, Pick isn't offered (practicing "In a sentence"). */
  typeOnly?: boolean;
  onModeChange: (mode: AnswerMode) => void;
  /** Writes one answer. `correct` counts an "almost" the user accepted. */
  onAnswer: (prompt: FormPrompt, correct: boolean) => Promise<void>;
  /** Shown on the summary: lines of a Forms field that couldn't be read, and the like. */
  notice?: string;
  onClose: () => void;
}) {
  const c = useTheme();
  const [prompts, setPrompts] = useState(props.prompts);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [typed, setTyped] = useState('');
  const [mode, setMode] = useState<AnswerMode>(props.typeOnly ? 'type' : props.mode);
  // Set while an answer is being written: a second tap must not answer the same prompt twice.
  const busy = useRef(false);

  const done = index >= prompts.length;
  const prompt = prompts[index];
  const current = answered.length > index ? answered[index] : undefined;
  const picking = mode === 'pick' && !!prompt?.choices;

  const answer = async (given: string, picked = false) => {
    if (!prompt || current || busy.current) return;
    busy.current = true;
    try {
      // A pick is the form or it isn't: a choice one accent away is another form, not a typo.
      const verdict: Verdict = picked ? (prompt.answers.includes(given) ? 'right' : 'wrong') : checkAnswer(given, prompt.answers);
      await props.onAnswer(prompt, verdict === 'right');
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
      await props.onAnswer(current.prompt, true);
      setAnswered((a) => a.map((x, i) => (i === index ? { ...x, counted: true } : x)));
    } finally {
      busy.current = false;
    }
  };

  const next = () => { setTyped(''); setIndex((i) => i + 1); };

  const switchMode = (m: AnswerMode) => { setMode(m); props.onModeChange(m); };

  const again = () => {
    const missed = answered.filter((a) => !isRight(a)).map((a) => a.prompt);
    setPrompts(missed);
    setAnswered([]);
    setIndex(0);
    setTyped('');
  };

  const footer = done ? (
    <>
      {answered.some((a) => !isRight(a)) ? (
        <Button
          label={answered.filter((a) => !isRight(a)).length === 1 ? 'Practice the missed one again' : 'Practice the missed ones again'}
          variant="secondary" onPress={again}
        />
      ) : null}
      <Button label={props.backLabel} onPress={props.onClose} />
    </>
  ) : current ? (
    <Button label={index === prompts.length - 1 ? 'See how it went' : 'Next'} onPress={next} />
  ) : !picking ? (
    <Button label="Check" onPress={() => answer(typed)} disabled={!typed.trim()} />
  ) : undefined;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={props.onClose}>
      <Screen
        onBack={props.onClose}
        backLabel={props.backLabel.replace(/^Back to /, '').replace(/^./, (ch) => ch.toUpperCase())}
        right={done ? undefined : <Text style={{ ...type.subhead, color: c.textSecondary, paddingHorizontal: space.l }}>{index + 1} of {prompts.length}</Text>}
        title={done ? summaryTitle(answered) : undefined}
        footer={footer}
      >
        {done ? (
          <Summary answered={answered} notice={props.notice} />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: space.l, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: c.border }}>
              <View style={{ width: `${(index / prompts.length) * 100}%`, height: 4, borderRadius: radius.pill, backgroundColor: c.accent }} />
            </View>
            {props.typeOnly ? null : (
              <View style={{ flexDirection: 'row', gap: space.s }} accessibilityLabel="Answer by">
                <Chip label="Pick" selected={mode === 'pick'} onPress={() => switchMode('pick')} />
                <Chip label="Type" selected={mode === 'type'} onPress={() => switchMode('type')} />
              </View>
            )}
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
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => { if (typed.trim()) answer(typed); }}
                error={!!current && !isRight(current)}
              />
            )}
            {mode === 'pick' && !prompt.choices ? <Help>This one is typed: the word lists no other forms to pick from.</Help> : null}
            {current ? <Feedback answered={current} onCount={countIt} /> : null}
          </ScrollView>
        )}
      </Screen>
    </Modal>
  );
}

function summaryTitle(answered: Answered[]): string {
  return `${answered.filter(isRight).length} of ${answered.length} right`;
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
    <Pressable
      onPress={onPress}
      disabled={state !== 'open'}
      accessibilityRole="button"
      accessibilityLabel={state === 'right' ? `${label}, the answer` : state === 'wrongPick' ? `${label}, not it` : label}
      style={({ pressed }) => ({
        flexBasis: '48%', flexGrow: 1, minHeight: 64, paddingHorizontal: space.m, paddingVertical: space.m,
        alignItems: 'center', justifyContent: 'center', borderRadius: radius.m,
        borderWidth: state === 'open' || state === 'other' ? 1 : 2, borderColor: border, backgroundColor: c.surface,
        opacity: pressed ? 0.75 : state === 'other' ? 0.6 : 1,
      })}
    >
      <Text style={{ ...type.title, fontWeight: state === 'right' ? '700' : '400', color: c.text, textAlign: 'center' }}>{label}</Text>
    </Pressable>
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
          <Pressable onPress={onCount} accessibilityRole="button" style={({ pressed }) => ({ minHeight: MIN_TAP, justifyContent: 'center', opacity: pressed ? 0.5 : 1, alignSelf: 'flex-start' })}>
            <Text style={{ ...type.subhead, color: c.accent }}>Count it as right</Text>
          </Pressable>
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
    <ScrollView contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
      <Card style={{ gap: 0, paddingVertical: space.xs }}>
        {answered.map((a, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52, paddingVertical: space.s, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
            <Text style={{ ...type.subhead, color: c.textSecondary, width: 130 }}>
              {[a.prompt.headword, a.prompt.label, a.prompt.group].filter(Boolean).join(' · ')}
            </Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.headline, color: c.text }}>{a.prompt.answers[0]}</Text>
              {a.verdict === 'almost' && a.counted ? <Text style={{ ...type.footnote, color: c.warning }}>Accent missed, counted as right</Text> : null}
              {!isRight(a) ? <Text style={{ ...type.footnote, color: c.danger }}>{`You answered ${a.given}`}</Text> : null}
            </View>
            <Text accessibilityLabel={isRight(a) ? 'Right' : 'Wrong'} style={{ ...type.headline, color: isRight(a) ? c.countDue : c.danger }}>
              {isRight(a) ? '✓' : '✕'}
            </Text>
          </View>
        ))}
      </Card>
      <Help>Practice doesn't change when any card is next due.</Help>
      {notice ? <Help>{notice}</Help> : null}
    </ScrollView>
  );
}
