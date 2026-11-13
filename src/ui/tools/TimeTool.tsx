import React, { useMemo, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import { timePatterns } from '../../tools/patterns';
import { timeRule } from '../../tools/rules';
import { clockText, MINUTE_STEPS, randomTime, type ClockTime, type MinuteStep } from '../../tools/time';
import { toolPrefs } from '../../tools/storage';
import { TIME_SAYERS } from '../../tools/tools';
import { Card, Segments } from '../kit';
import { space, type, useTheme } from '../theme';
import { ClockFace } from './ClockFace';
import type { ToolScreenProps } from './index';
import { AnswerCard, ControlLabel, nextOnly, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';
import { useWheelRow, Wheel, WheelBand, wheelScale } from './Wheel';

const STEP_LABELS: Record<MinuteStep, string> = { 1: 'Any minute', 5: '5 min', 15: '15 min', 30: '30 min' };

/**
 * Telling the time: a clock and hour and minute wheels, set by scrolling or at random, then the
 * answer in the chosen language, marked Missed it or Got it. Missed it shows the rule behind the
 * answer where there's one (rules.ts) before moving on. A random time leans toward the kinds missed
 * lately (useMarks), and a time missed comes back once a few times later (useRetries). Changing the
 * time hides the answer again.
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
  const [time, setTime] = useState<ClockTime>(() => randomTime(toolPrefs().minuteStep));

  const saying = useMemo(() => TIME_SAYERS[language]?.(time), [language, time]);
  const rule = useMemo(() => timeRule(language, time), [language, time]);
  const change = (next: ClockTime) => { answer.hide(); setTime(next); };
  const scope = `${language}|${step}`;
  const next = () => change(retries.next(scope, clockText(time), () => marks.pick(() => randomTime(step, time), (t) => timePatterns(t, language))));
  const chooseStep = (s: MinuteStep) => setStep(s);

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={next}
      onShow={() => answer.show(saying?.everyday)}
      onMark={(right) => {
        marks.mark(timePatterns(time, language), right);
        if (!right) retries.missed(scope, clockText(time), time);
        if (!right && rule) answer.miss();
        else next();
      }}
      actions={answer.missed ? nextOnly(next) : undefined}
    >
      <Card style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: space.l }}>
        <ClockFace time={time} size={Math.max(128, row * 3)} />
        <WheelBand>
          <Wheel label="Hour" count={24} value={time.hour} width={64 * wheelScale(fontScale)} onChange={(hour) => change({ ...time, hour })} />
          <Text maxFontSizeMultiplier={2} style={{ ...type.title, fontSize: 28, color: c.text, paddingBottom: 3 }}>:</Text>
          <Wheel label="Minute" count={60} value={time.minute} width={64 * wheelScale(fontScale)} onChange={(minute) => change({ ...time, minute })} />
        </WheelBand>
      </Card>

      <View style={{ gap: space.s }}>
        <ControlLabel>Random times</ControlLabel>
        <Segments options={MINUTE_STEPS.map((s) => ({ value: s, label: STEP_LABELS[s] }))} value={step} onChange={chooseStep} />
      </View>

      <AnswerCard
        shown={answer.shown}
        prompt={`Say the time in ${LANGUAGES[language].name} out loud, then show the answer.`}
        answer={saying && { everyday: saying.everyday, also: saying.also, last: { title: 'Formal', phrase: saying.formal } }}
        rule={answer.missed ? rule : undefined}
        onPlay={answer.speak}
      />
    </ToolScreen>
  );
}
