import React, { useMemo, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import type { AnswerMode } from '../../tools/listen';
import { timePatterns } from '../../tools/patterns';
import { timeRule } from '../../tools/rules';
import { clockText, heardAs, MINUTE_STEPS, randomTime, type ClockTime, type MinuteStep } from '../../tools/time';
import { toolPrefs } from '../../tools/storage';
import { TIME_SAYERS } from '../../tools/tools';
import { Card, Segments } from '../kit';
import { space, type, useTheme } from '../theme';
import { ClockFace } from './ClockFace';
import type { ToolScreenProps } from './index';
import { ListenCard, ListenResult, useListenCheck, useSpeakEach } from './Listen';
import { AnswerCard, ChipChoice, ControlLabel, nextOnly, ToolScreen, useAnswer, useToolLanguage, useToolPref, type ToolActions } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';
import { useWheelRow, Wheel, WheelBand, wheelScale } from './Wheel';

const STEP_LABELS: Record<MinuteStep, string> = { 1: 'Any minute', 5: '5 min', 15: '15 min', 30: '30 min' };

const MODES: { value: AnswerMode; label: string }[] = [{ value: 'say', label: 'Say it' }, { value: 'listen', label: 'Listen' }];

/**
 * Telling the time: a clock and hour and minute wheels. Say it sets them by scrolling or at
 * random, then shows the answer in the chosen language, marked Missed it or Got it; Missed it
 * shows the rule behind the answer where there's one (rules.ts) before moving on. Listen reads a
 * time aloud, and the clock is set to the time heard and checked (`heardAs`: any time said the
 * same way is right, so 14:25 counts for German's fünf vor halb drei). A random time leans toward
 * the kinds missed lately (useMarks), and a time missed comes back once a few times later
 * (useRetries). Changing the time hides Say it's answer again.
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

  let actions: ToolActions | undefined;
  if (listening) actions = listen.actions({ canCheck: !!sayer, onCheck: () => sayer && listen.check(heardAs(time, heard, sayer)), onNext: next });
  else if (answer.missed) actions = nextOnly(next);

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={next}
      onShow={() => answer.show(saying?.everyday)}
      onMark={(right) => {
        mark(right);
        if (!right && rule) answer.miss();
        else next();
      }}
      actions={actions}
    >
      {listening ? <ListenCard label="Play the time again" hint="Listen, then set the clock to the time you heard." onPlay={() => saying && answer.speak(saying.everyday)} /> : null}

      <Card style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: space.l }}>
        <ClockFace time={time} size={Math.max(128, row * 3)} />
        <WheelBand>
          <Wheel label="Hour" count={24} value={time.hour} width={64 * wheelScale(fontScale)} onChange={(hour) => change({ ...time, hour })} />
          <Text maxFontSizeMultiplier={2} style={{ ...type.title, fontSize: 28, color: c.text, paddingBottom: 3 }}>:</Text>
          <Wheel label="Minute" count={60} value={time.minute} width={64 * wheelScale(fontScale)} onChange={(minute) => change({ ...time, minute })} />
        </WheelBand>
      </Card>

      {listening ? (
        listen.verdict && saying ? (
          <ListenResult
            right={listen.verdict.right}
            wrong={`Not quite. It's ${clockText(heard)}.`}
            saying={saying}
            rule={rule}
            last={{ title: 'Formal', phrase: saying.formal }}
            onPlay={answer.speak}
          />
        ) : null
      ) : (
        <AnswerCard
          shown={answer.shown}
          prompt={`Say the time in ${LANGUAGES[language].name} out loud, then show the answer.`}
          answer={saying && { everyday: saying.everyday, also: saying.also, last: { title: 'Formal', phrase: saying.formal } }}
          rule={answer.missed ? rule : undefined}
          onPlay={answer.speak}
        />
      )}

      <View style={{ gap: space.s }}>
        <ControlLabel>Random times</ControlLabel>
        <Segments options={MINUTE_STEPS.map((s) => ({ value: s, label: STEP_LABELS[s] }))} value={step} onChange={chooseStep} />
      </View>

      <ChipChoice label="Answer by" options={MODES} value={mode} onChange={(m) => { setMode(m); answer.hide(); listen.reset(); }} />
    </ToolScreen>
  );
}
