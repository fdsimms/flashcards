import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { Keyboard, Text, View, type TextInputInstance } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import { checkDigits, questionKey, questionText, randomQuestion, type NumberKind, type NumberQuestion } from '../../tools/number';
import type { AnswerMode } from '../../tools/listen';
import { numberPatterns } from '../../tools/patterns';
import { numberRule } from '../../tools/rules';
import { toolPrefs } from '../../tools/storage';
import { NUMBER_SAYERS, toolLanguage } from '../../tools/tools';
import { haptic } from '../haptics';
import { Field } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { useListenCheck, useSpeakEach } from './Listen';
import { ListenBack, ListenFooter, ListenPrompt, PracticeCard, SayFooter, useSwipeSetting } from './PracticeCard';
import { AnswerContent, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

const KINDS: { value: NumberKind; label: string }[] = [
  { value: 'number', label: 'Numbers' },
  { value: 'phone', label: 'Phone numbers' },
  { value: 'year', label: 'Years' },
  { value: 'age', label: 'Ages' },
];

const MODES: { value: AnswerMode; label: string }[] = [{ value: 'say', label: 'Say it' }, { value: 'listen', label: 'Listen' }];

/** The card's label over the number, and what a typed answer is called. */
const KIND_LABEL: Record<NumberKind, string> = { number: 'Number', phone: 'Phone number', year: 'Year', age: 'Age' };

/**
 * Numbers: a plain number, a phone number, a year or an age, in the chosen language, as Review's
 * card (PracticeCard.tsx): Practice and Answer by are in the header's menu. Say it shows the
 * number to say aloud, tapped for the answer, marked Missed it or Got it (swiped too, when swipe is on).
 * Listen reads it aloud (again on the large play button), and the digits typed in the card are checked against it (Listen.tsx).
 * Either way a miss shows the rule behind the answer where there's one (rules.ts), a new question
 * leans toward the kinds missed lately (useMarks), and one missed comes back once a few questions
 * later (useRetries).
 */
export function NumbersTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const retries = useRetries<NumberQuestion>();
  const [kind, setKind] = useToolPref('numberKind');
  const [mode, setMode] = useToolPref('numberMode');
  const [question, setQuestion] = useState<NumberQuestion>(() => {
    const prefs = toolPrefs();
    return randomQuestion(prefs.numberKind, toolLanguage(tool, prefs.language));
  });
  // A question of the kind chosen: the saved kind once it's read, or one just picked.
  useEffect(() => {
    if (question.kind !== kind) setQuestion(randomQuestion(kind, language));
  }, [question.kind, kind, language]);
  // A phone number is the language's own format, so another language needs another one.
  const [phoneLanguage, setPhoneLanguage] = useState(language);
  useEffect(() => {
    if (phoneLanguage === language) return;
    setPhoneLanguage(language);
    if (question.kind === 'phone') setQuestion(randomQuestion('phone', language));
  }, [language, phoneLanguage, question.kind]);

  const saying = useMemo(() => NUMBER_SAYERS[language]?.(question), [language, question]);
  const rule = useMemo(() => (saying ? numberRule(language, question, saying.everyday.text) : undefined), [language, question, saying]);
  const key = questionKey(question);
  const scope = `${language}|${kind}`;

  /** The question's mark: Missed it / Got it, or Listen's first check. */
  const mark = (right: boolean) => {
    marks.mark(numberPatterns(question), right);
    if (!right) retries.missed(scope, key, question);
  };
  const listen = useListenCheck(key, mark);
  const [typed, setTyped] = useState({ key, text: '' });
  const typedText = typed.key === key ? typed.text : '';

  const next = (k: NumberKind = kind) => {
    answer.hide();
    // A missed question handed back later is asked afresh: nothing typed, unchecked.
    setTyped({ key: '', text: '' });
    listen.reset();
    const draw = () => marks.pick(() => randomQuestion(k, language, question), numberPatterns);
    setQuestion(retries.next(`${language}|${k}`, key, draw));
  };

  useSpeakEach(mode === 'listen', key, language, saying?.everyday, answer.speak);

  const check = () => {
    if (!saying || listen.verdict || !typedText.trim()) return;
    Keyboard.dismiss();
    listen.check(checkDigits(typedText, question, language));
  };

  const shown = questionText(question, language);
  const kindName = KIND_LABEL[question.kind].toLowerCase();
  const swipeOn = useSwipeSetting(repo);
  const motion = useRef<CardMotion | null>(null);
  const listening = mode === 'listen';
  const swipe = swipeOn && !listening && answer.shown && !answer.missed;

  // A mark, from a button or a swipe: Missed it with a rule keeps the answer up with the rule until Next.
  const markAndMove = (right: boolean) => {
    haptic.answer();
    motion.current?.flash(right ? 3 : 1);
    mark(right);
    if (!right && rule) answer.miss();
    else next();
  };
  const showAnswer = () => answer.show(saying?.everyday);

  const front = listening ? (
    <ListenPrompt label={`Play the ${kindName} again`} hint={`Listen, then type the ${kindName} you heard.`} onPlay={() => saying && answer.speak(saying.everyday)}>
      <DigitsField key={key} label={`The ${kindName} you heard`} typed={typedText} onType={(text) => setTyped({ key, text })} onSubmit={check} checked={listen.verdict} />
      {listen.verdict ? null : <Text style={{ ...type.footnote, color: c.textSecondary, paddingHorizontal: space.xs }}>Spaces and dashes don't matter.</Text>}
    </ListenPrompt>
  ) : (
    <View style={{ alignItems: 'center', gap: space.xs }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>{KIND_LABEL[question.kind]}</Text>
      <Text selectable maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: question.kind === 'phone' ? 32 : 44, fontVariant: ['tabular-nums'], color: c.text, textAlign: 'center' }}>{shown}</Text>
    </View>
  );

  let back: React.ReactNode;
  if (listening) {
    back = listen.verdict && saying ? <ListenBack right={listen.verdict.right} wrong={`Not quite. It's ${shown}.`} answer={{ everyday: saying.everyday, also: saying.also }} rule={rule} onPlay={answer.speak} /> : undefined;
  } else if (answer.shown && saying) {
    back = <AnswerContent centered answer={{ everyday: saying.everyday, also: saying.also }} rule={answer.missed ? rule : undefined} onPlay={answer.speak} />;
  }

  const footer = listening
    ? <ListenFooter verdict={listen.verdict} canCheck={!!typedText.trim()} onCheck={check} onRetry={listen.retry} onNext={() => next()} />
    : <SayFooter shown={answer.shown} missed={answer.missed} onShow={showAnswer} onNext={() => next()} onMark={markAndMove} />;

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={() => next()}
      onShow={showAnswer}
      onMark={markAndMove}
      fill
      lockGesture={swipe}
      footer={footer}
      menu={[
        <Stack.Toolbar.Menu key="1" inline title="Practice">
          {KINDS.map((k) => <Stack.Toolbar.MenuAction key={k.value} isOn={k.value === kind} onPress={() => { if (k.value !== kind) { setKind(k.value); next(k.value); } }}>{k.label}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
        <Stack.Toolbar.Menu key="2" inline title="Answer by">
          {MODES.map((m) => <Stack.Toolbar.MenuAction key={m.value} isOn={m.value === mode} onPress={() => { if (m.value !== mode) { setMode(m.value); answer.hide(); } }}>{m.label}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
      ]}
    >
      <PracticeCard
        questionKey={`${key}|${mode}`}
        cardKey={`${key}|${mode}|${answer.shown}|${answer.missed}|${listen.verdict?.right ?? ''}`}
        swipe={swipe}
        motion={motion}
        onMark={markAndMove}
        onTap={!listening && !answer.shown ? showAnswer : undefined}
        onPlay={saying && (listening ? !!listen.verdict : answer.shown) ? () => answer.speak(saying.everyday) : undefined}
        speech={LANGUAGES[language].speech}
        front={front}
        back={back}
      />
    </ToolScreen>
  );
}

/** Listen's answer: the digits heard, focused as the question comes up and again after Try again. */
function DigitsField({ label, typed, onType, onSubmit, checked }: {
  label: string;
  typed: string;
  onType: (text: string) => void;
  onSubmit: () => void;
  checked: { right: boolean } | null;
}) {
  const input = useRef<TextInputInstance>(null);
  useEffect(() => { if (!checked) input.current?.focus(); }, [checked]);
  return (
    <Field
        ref={input}
        label={label}
        placeholder="Type the digits"
        value={typed}
        onChangeText={onType}
        editable={!checked}
        onSubmitEditing={onSubmit}
        keyboardType="number-pad"
        returnKeyType="done"
      error={!!checked && !checked.right}
    />
  );
}
