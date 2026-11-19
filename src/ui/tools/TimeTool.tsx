import { Stack } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import { TIME_MODES, type TimeMode } from '../../tools/prefs';
import { timePatterns } from '../../tools/patterns';
import { timeRule } from '../../tools/rules';
import { clockText, heardAs, MINUTE_STEPS, randomTime, type ClockTime, type MinuteStep } from '../../tools/time';
import { toolPrefs } from '../../tools/storage';
import { TIME_SAYERS } from '../../tools/tools';
import { Button } from '../kit';
import { haptic } from '../haptics';
import type { CardMotion } from '../SwipeCard';
import { space, type, useTheme } from '../theme';
import { ClockFace } from './ClockFace';
import type { ToolScreenProps } from './index';
import { useListenCheck, useSpeakEach } from './Listen';
import { ListenBack, ListenFooter, ListenPrompt, PracticeCard, SayFooter, useSwipeSetting } from './PracticeCard';
import { AnswerContent, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';
import { useWheelRow, Wheel, WheelBand, wheelScale } from './Wheel';

const STEP_LABELS: Record<MinuteStep, string> = { 1: 'Any minute', 5: '5 min', 15: '15 min', 30: '30 min' };

const MODE_LABELS: Record<TimeMode, string> = { say: 'Say it', listen: 'Listen', explore: 'Explore' };

/**
 * Telling the time, as Review's card (PracticeCard.tsx): Random times and Answer by are in the
 * header's menu. Say it shows a clock and its digits to say aloud, tapped for the answer in the
 * chosen language and marked Missed it or Got it (swiped too, when swipe is on); Missed it shows
 * the rule behind the answer where there's one (rules.ts). Listen reads a time aloud, and the
 * clock in the card is set with its wheels to the time heard and checked (`heardAs`: any time said
 * the same way is right, so 14:25 counts for German's fünf vor halb drei). Explore is outside the
 * deck: set the clock to any time and see how it's said, under it, with nothing marked and nothing
 * coming back. A random time leans toward the kinds missed lately (useMarks), and a time missed
 * comes back once a few times later (useRetries).
 */
export function TimeTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const { fontScale } = useWindowDimensions();
  const row = useWheelRow();
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const retries = useRetries<ClockTime>();
  const [step, setStep] = useToolPref('minuteStep');
  const [mode, setMode] = useToolPref('timeMode');
  /** The clock: the time to say, or in Listen, the time set. */
  const [time, setTime] = useState<ClockTime>(() => randomTime(toolPrefs().minuteStep));
  /** Listen's question: the time read aloud. */
  const [heard, setHeard] = useState<ClockTime>(() => randomTime(toolPrefs().minuteStep, time));
  const listening = mode === 'listen';
  /** What's asked: the clock's time, or the one heard. */
  const asked = listening ? heard : time;

  const sayer = TIME_SAYERS[language];
  const saying = useMemo(() => sayer?.(asked), [sayer, asked]);
  const rule = useMemo(() => timeRule(language, asked), [language, asked]);
  const scope = `${language}|${step}|${mode}`;
  const mark = (right: boolean) => {
    marks.mark(timePatterns(asked, language), right);
    if (!right) retries.missed(scope, clockText(asked), asked);
  };
  const listen = useListenCheck(`${language}|${clockText(heard)}`, mark);
  const draw = (previous: ClockTime) => retries.next(scope, clockText(previous), () => marks.pick(() => randomTime(step, previous), (t) => timePatterns(t, language)));

  const change = (t: ClockTime) => { if (!listening) answer.hide(); setTime(t); };
  const next = () => {
    if (listening) { listen.reset(); setHeard(draw(heard)); }
    else change(draw(time));
  };
  const chooseStep = (s: MinuteStep) => setStep(s);

  useSpeakEach(listening, clockText(heard), language, listening ? saying?.everyday : undefined, answer.speak);

  const swipeOn = useSwipeSetting(repo);
  const motion = useRef<CardMotion | null>(null);
  const exploring = mode === 'explore';
  const swipe = swipeOn && mode === 'say' && answer.shown && !answer.missed;
  const full = saying && { everyday: saying.everyday, also: saying.also, last: { title: 'Formal', phrase: saying.formal } };

  // A mark, from a button or a swipe: Missed it with a rule keeps the answer up with the rule until Next.
  const markAndMove = (right: boolean) => {
    haptic.answer();
    motion.current?.flash(right ? 3 : 1);
    mark(right);
    if (!right && rule) answer.miss();
    else next();
  };
  const showAnswer = () => answer.show(saying?.everyday);
  /** Explore: a new time on the clock, said aloud. Never marked. */
  const newTime = () => {
    const t = randomTime(step, time);
    setTime(t);
    const s = sayer?.(t);
    if (s) answer.speak(s.everyday);
  };

  const clockSize = Math.max(128, row * 3);
  const setClock = (
    <View style={{ alignItems: 'center', gap: space.l }}>
      <ClockFace time={time} size={clockSize} />
      {exploring || !listen.verdict ? (
        <WheelBand>
          <Wheel label="Hour" count={24} value={time.hour} width={64 * wheelScale(fontScale)} onChange={(hour) => change({ ...time, hour })} />
          <Text maxFontSizeMultiplier={2} style={{ ...type.title, fontSize: 28, color: c.text, paddingBottom: 3 }}>:</Text>
          <Wheel label="Minute" count={60} value={time.minute} width={64 * wheelScale(fontScale)} onChange={(minute) => change({ ...time, minute })} />
        </WheelBand>
      ) : null}
    </View>
  );

  let front: React.ReactNode;
  let back: React.ReactNode;
  let footer: React.ReactNode;
  if (exploring) {
    front = setClock;
    back = full ? <AnswerContent centered answer={full} rule={rule} onPlay={answer.speak} /> : undefined;
    footer = <Button label="Random time" onPress={newTime} />;
  } else if (listening) {
    front = <ListenPrompt label="Play the time again" hint="Listen, then set the clock to the time you heard." onPlay={() => saying && answer.speak(saying.everyday)}>{setClock}</ListenPrompt>;
    back = listen.verdict && full ? <ListenBack right={listen.verdict.right} wrong={`Not quite. It's ${clockText(heard)}.`} answer={full} rule={rule} onPlay={answer.speak} /> : undefined;
    footer = <ListenFooter verdict={listen.verdict} canCheck={!!sayer} onCheck={() => sayer && listen.check(heardAs(time, heard, sayer))} onRetry={listen.retry} onNext={next} />;
  } else {
    front = (
      <View style={{ alignItems: 'center', gap: space.l }}>
        <ClockFace time={time} size={row * 5} />
        <Text maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontVariant: ['tabular-nums'], color: c.text }}>{clockText(time)}</Text>
      </View>
    );
    back = answer.shown && full ? <AnswerContent centered answer={full} rule={answer.missed ? rule : undefined} onPlay={answer.speak} /> : undefined;
    footer = <SayFooter shown={answer.shown} missed={answer.missed} onShow={showAnswer} onNext={next} onMark={markAndMove} />;
  }
  const hasAnswer = exploring ? !!saying : listening ? !!listen.verdict : answer.shown;

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={next}
      onShow={showAnswer}
      onMark={markAndMove}
      fill
      lockGesture={swipe}
      footer={footer}
      menu={[
        <Stack.Toolbar.Menu key="1" inline title="Random times">
          {MINUTE_STEPS.map((s) => <Stack.Toolbar.MenuAction key={s} isOn={s === step} onPress={() => chooseStep(s)}>{STEP_LABELS[s]}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
        <Stack.Toolbar.Menu key="2" inline title="Answer by">
          {TIME_MODES.map((m) => <Stack.Toolbar.MenuAction key={m} isOn={m === mode} onPress={() => { if (m !== mode) { setMode(m); answer.hide(); listen.reset(); } }}>{MODE_LABELS[m]}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
      ]}
    >
      <PracticeCard
        questionKey={exploring ? 'explore' : `${mode}|${clockText(asked)}`}
        cardKey={`${mode}|${clockText(asked)}|${answer.shown}|${answer.missed}|${listen.verdict?.right ?? ''}`}
        swipe={swipe}
        motion={motion}
        onMark={markAndMove}
        onTap={mode === 'say' && !answer.shown ? showAnswer : undefined}
        onPlay={saying && hasAnswer ? () => answer.speak(saying.everyday) : undefined}
        speech={LANGUAGES[language].speech}
        front={front}
        back={back}
      />
    </ToolScreen>
  );
}
