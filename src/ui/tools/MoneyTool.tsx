import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Text, View, type TextInputInstance } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import type { AnswerMode } from '../../tools/listen';
import type { MoneyMode } from '../../tools/prefs';
import { breakDown, CURRENCIES, MONEY_MAXES, parseTypedAmount, randomAmount, type MoneyMax } from '../../tools/money';
import { moneyPatterns } from '../../tools/patterns';
import { moneyRule } from '../../tools/rules';
import { toolPrefs } from '../../tools/storage';
import { CURRENCY_OF, MONEY_SAYERS, toolLanguage } from '../../tools/tools';
import { haptic } from '../haptics';
import { Field } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { space, type, useTheme } from '../theme';
import { Cash } from './Cash';
import type { ToolScreenProps } from './index';
import { useListenCheck, useSpeakEach } from './Listen';
import { ListenBack, ListenFooter, ListenPrompt, PracticeCard, SayFooter, useSwipeSetting } from './PracticeCard';
import { AnswerContent, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

const MODES: { value: MoneyMode; label: string }[] = [{ value: 'count', label: 'Counting' }, { value: 'price', label: 'Prices' }];
const ANSWERS: { value: AnswerMode; label: string }[] = [{ value: 'say', label: 'Say it' }, { value: 'listen', label: 'Listen' }];

/**
 * Counting money, as Review's card (PracticeCard.tsx): Practice, Amounts up to and Answer by are in
 * the header's menu. An amount in the chosen language's own money, as notes and coins to add up or
 * as a price to read, tapped for how it's said in that language and marked Missed it or Got it, swiped too
 * when swipe is on (Missed it shows the rule behind the answer first, where there's one: rules.ts). A new amount comes with each
 * Another one or mark, leaning toward the kinds missed lately (useMarks), and with a change of
 * language, mode or size, since another currency is priced in other steps. An amount missed comes
 * back once a few amounts later (useRetries). Listen reads a price aloud instead, and the amount
 * typed is checked against it (Listen.tsx); Counting and Prices don't apply there.
 */
export function MoneyTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const retries = useRetries<number>();
  const [mode, setMode] = useToolPref('moneyMode');
  const [max, setMax] = useToolPref('moneyMax');
  const [answerMode, setAnswerMode] = useToolPref('moneyAnswer');
  const listening = answerMode === 'listen';
  const currency = CURRENCIES[CURRENCY_OF[language]!];
  /** The amount, with the currency it's in, so one from another language's money is never shown. */
  const [held, setHeld] = useState(() => {
    const code = CURRENCY_OF[toolLanguage(tool, toolPrefs().language)]!;
    return { code, amount: randomAmount(CURRENCIES[code], toolPrefs().moneyMax) };
  });
  const amount = held.code === currency.code ? held.amount : undefined;
  // A missed amount comes back only in the same money and size.
  const scope = (m: MoneyMax) => `${currency.code}|${m}`;
  const next = (m: MoneyMax = max) => {
    answer.hide();
    listen.reset();
    setTyped({ key: '', text: '' });
    const draw = () => marks.pick(() => randomAmount(currency, m, amount), (a) => moneyPatterns(a, currency), String);
    setHeld({ code: currency.code, amount: retries.next(scope(m), amount === undefined ? undefined : String(amount), draw) });
  };
  // Another language's money (chosen, or the saved language once it's read): a new amount in it.
  useEffect(() => {
    if (held.code !== currency.code) setHeld({ code: currency.code, amount: randomAmount(currency, max) });
  }, [held.code, currency, max]);

  const saying = useMemo(() => (amount === undefined ? undefined : MONEY_SAYERS[language]?.(amount)), [language, amount]);
  const rule = useMemo(() => (amount === undefined ? undefined : moneyRule(language, amount, currency)), [language, amount, currency]);
  const pieces = useMemo(() => (amount === undefined ? [] : breakDown(amount, currency)), [amount, currency]);

  const mark = (right: boolean) => {
    if (amount === undefined) return;
    marks.mark(moneyPatterns(amount, currency), right);
    if (!right) retries.missed(scope(max), String(amount), amount);
  };
  const key = `${currency.code}|${amount}`;
  const listen = useListenCheck(key, mark);
  const [typed, setTyped] = useState({ key, text: '' });
  const typedText = typed.key === key ? typed.text : '';
  useSpeakEach(listening, key, language, saying?.everyday, answer.speak);
  const check = () => {
    if (amount === undefined || listen.verdict || !typedText.trim()) return;
    Keyboard.dismiss();
    listen.check(parseTypedAmount(typedText, currency) === amount);
  };
  const swipeOn = useSwipeSetting(repo);
  const motion = useRef<CardMotion | null>(null);
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

  let front: React.ReactNode;
  let back: React.ReactNode;
  let footer: React.ReactNode;
  if (listening) {
    front = (
      <ListenPrompt label="Play the price again" hint="Listen, then type the price you heard." onPlay={() => saying && answer.speak(saying.everyday)}>
        <PriceField key={key} label={`The price you heard, in ${currency.symbol}`} typed={typedText} onType={(text) => setTyped({ key, text })} onSubmit={check} checked={listen.verdict} />
        {listen.verdict ? null : (
          <Text style={{ ...type.footnote, color: c.textSecondary, paddingHorizontal: space.xs }}>
            {currency.minorStep ? 'Type the amount in digits, with a comma or a dot before the cents.' : 'Type the amount in digits.'}
          </Text>
        )}
      </ListenPrompt>
    );
    back = listen.verdict && saying ? <ListenBack right={listen.verdict.right} wrong={`Not quite. It's ${saying.written.text}.`} answer={{ everyday: saying.everyday, also: saying.also }} rule={rule} onPlay={answer.speak} /> : undefined;
    footer = <ListenFooter verdict={listen.verdict} canCheck={!!typedText.trim()} onCheck={check} onRetry={listen.retry} onNext={() => next()} />;
  } else {
    front = (
      <View style={{ alignItems: 'center', gap: space.m }}>
        <Text style={{ ...type.overline, color: c.textSecondary }}>{mode === 'count' ? 'Notes and coins' : 'Price'}</Text>
        {mode === 'count' ? (
          <Cash pieces={pieces} currency={currency} />
        ) : (
          <Text selectable maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: 44, fontVariant: ['tabular-nums'], color: c.text, textAlign: 'center' }}>{saying?.written.text}</Text>
        )}
      </View>
    );
    back = answer.shown && saying ? (
      <AnswerContent
        centered
        answer={{ everyday: saying.everyday, also: saying.also, last: mode === 'count' ? { title: 'As written', phrase: saying.written } : undefined }}
        rule={answer.missed ? rule : undefined}
        onPlay={answer.speak}
      />
    ) : undefined;
    footer = <SayFooter shown={answer.shown} missed={answer.missed} onShow={showAnswer} onNext={() => next()} onMark={markAndMove} />;
  }

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
          {MODES.map((m) => <Stack.Toolbar.MenuAction key={m.value} isOn={m.value === mode} onPress={() => { if (m.value !== mode) { setMode(m.value); next(); } }}>{m.label}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
        <Stack.Toolbar.Menu key="2" inline title="Amounts up to">
          {MONEY_MAXES.map((m) => <Stack.Toolbar.MenuAction key={m} isOn={m === max} onPress={() => { if (m !== max) { setMax(m); next(m); } }}>{m.toLocaleString('en-US')}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
        <Stack.Toolbar.Menu key="3" inline title="Answer by">
          {ANSWERS.map((m) => <Stack.Toolbar.MenuAction key={m.value} isOn={m.value === answerMode} onPress={() => { if (m.value !== answerMode) { setAnswerMode(m.value); answer.hide(); } }}>{m.label}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
      ]}
    >
      <PracticeCard
        questionKey={`${key}|${answerMode}|${mode}`}
        cardKey={`${key}|${answerMode}|${answer.shown}|${answer.missed}|${listen.verdict?.right ?? ''}`}
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

/** Listen's answer: the price heard, focused as the question comes up and again after Try again. */
function PriceField({ label, typed, onType, onSubmit, checked }: {
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
      placeholder="Type the amount"
      value={typed}
      onChangeText={onType}
      editable={!checked}
      onSubmitEditing={onSubmit}
      keyboardType="decimal-pad"
      returnKeyType="done"
      error={!!checked && !checked.right}
    />
  );
}
