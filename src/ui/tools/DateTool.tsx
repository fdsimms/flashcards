import { Stack } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import { randomDate, type CalendarDate } from '../../tools/date';
import { DATE_MODES, nextQuizDraw, quizDate, type DateMode } from '../../tools/dateQuiz';
import { datePatterns } from '../../tools/patterns';
import { dateRule } from '../../tools/rules';
import { DATE_SAYERS, WEEK_STARTS_ON } from '../../tools/tools';
import { haptic } from '../haptics';
import { Button } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { space, type, useTheme } from '../theme';
import { CalendarMonth, dateLabel } from './CalendarMonth';
import { DateFront, PickBack, PickChoices, TapBack, TapFront, today, TypeBack, TypeField, useDateQuiz } from './DateQuiz';
import type { ToolScreenProps } from './index';
import { ListenFooter, PracticeCard, SayFooter, useSwipeSetting } from './PracticeCard';
import { AnswerContent, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

const MODE_LABELS: Record<DateMode, string> = { say: 'Say it', pick: 'Pick', type: 'Type', tap: 'Tap date', explore: 'Explore' };

/**
 * Saying dates, as Review's card (PracticeCard.tsx): Weekday, Year and Answer by are in the header's
 * menu. A date at random, shown as text, then said in the chosen language, with the weekday and
 * the year when they're turned on. It's answered by saying it and showing the answer, or
 * (DateQuiz.tsx) by picking the phrase, typing it, or reading the phrase and tapping the date on a
 * calendar. Saying it aloud is marked Missed it or Got it (swiped too, when swipe is on); the other ways mark
 * themselves. Explore is outside the quiz: tap any day on the calendar to see how it's said, with
 * nothing marked and nothing coming back. A miss shows the rule behind the answer, where there's one (rules.ts). A random date
 * leans toward the kinds missed lately (useMarks), and a date missed comes back once a few dates
 * later (useRetries). Changing the date or what is said hides the answer again.
 */
export function DateTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const retries = useRetries<CalendarDate>();
  const [weekday, setWeekday] = useToolPref('dateWeekday');
  const [year, setYear] = useToolPref('dateYear');
  const [mode, setMode] = useToolPref('dateMode');
  const [drawn, setDrawn] = useState<CalendarDate>(() => randomDate());
  const now = today();
  // The date asked about: the one drawn, or its day and month this year when it's tapped with the year unsaid.
  const date = useMemo(() => quizDate(drawn, mode, { weekday, year }, now), [drawn, mode, year, now.year]); // eslint-disable-line react-hooks/exhaustive-deps

  const saying = useMemo(() => DATE_SAYERS[language]?.(date, { weekday, year }), [language, date, weekday, year]);
  const rule = useMemo(() => dateRule(language, date, { weekday, year }), [language, date, weekday, year]);
  const parts = { weekday, year };
  const change = (next: CalendarDate) => { answer.hide(); setDrawn(next); };
  // A missed date comes back only asked the same way; it's the same question when it asks the same date.
  const scope = `${language}|${mode}|${weekday}|${year}`;
  const asked = (d: CalendarDate) => { const a = quizDate(d, mode, parts, now); return `${a.year}-${a.month}-${a.day}`; };
  // Weighed by the date it would ask, which is what's marked.
  const draw = () => marks.pick(() => nextQuizDraw(drawn, mode, parts, now), (d) => datePatterns(quizDate(d, mode, parts, now), parts));
  const next = () => change(retries.next(scope, asked(drawn), draw));
  const mark = (right: boolean) => {
    marks.mark(datePatterns(date, parts), right);
    if (!right) retries.missed(scope, asked(drawn), drawn);
  };
  const quiz = useDateQuiz({ mode, language, date, parts, saying, sayer: DATE_SAYERS[language], speak: answer.speak, next, onResult: mark });

  const swipeOn = useSwipeSetting(repo);
  const motion = useRef<CardMotion | null>(null);
  const swipe = swipeOn && mode === 'say' && answer.shown && !answer.missed;
  const weekStartsOn = WEEK_STARTS_ON[language]!;
  const full = saying && { everyday: saying.everyday, also: saying.also, last: { title: 'As written', phrase: saying.written } };

  // A mark, from a button or a swipe: Missed it with a rule keeps the answer up with the rule until Next.
  const markAndMove = (right: boolean) => {
    haptic.answer();
    motion.current?.flash(right ? 3 : 1);
    mark(right);
    if (!right && rule) answer.miss();
    else next();
  };
  const showAnswer = () => answer.show(saying?.everyday);
  /** Explore: a new date on the calendar, said aloud. Never marked. */
  const newDate = () => {
    const d = randomDate(drawn);
    change(d);
    const s = DATE_SAYERS[language]?.(d, parts);
    if (s) answer.speak(s.everyday);
  };

  let front: React.ReactNode;
  let back: React.ReactNode;
  let footer: React.ReactNode;
  let playable = !!saying;
  if (mode === 'explore') {
    front = <CalendarMonth date={date} onChange={change} weekStartsOn={weekStartsOn} />;
    back = full ? (
      <View style={{ gap: space.m }}>
        <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{dateLabel(date)}</Text>
        <AnswerContent centered answer={full} rule={rule} onPlay={answer.speak} />
      </View>
    ) : undefined;
    footer = <Button label="Random date" onPress={newDate} />;
  } else if (mode === 'say') {
    front = <DateFront date={date} parts={parts} />;
    back = answer.shown && full ? <AnswerContent centered answer={full} rule={answer.missed ? rule : undefined} onPlay={answer.speak} /> : undefined;
    footer = <SayFooter shown={answer.shown} missed={answer.missed} onShow={showAnswer} onNext={next} onMark={markAndMove} />;
    playable = answer.shown && !!saying;
  } else if (mode === 'pick') {
    const answered = quiz.picked !== null || quiz.revealed;
    front = <DateFront date={date} parts={parts} />;
    back = answered ? <PickBack quiz={quiz} rule={rule} /> : undefined;
    footer = (
      <View style={{ gap: space.s }}>
        <PickChoices quiz={quiz} />
        {answered ? <Button label="Next" onPress={next} /> : <Button variant="secondary" label="Show answer" onPress={quiz.reveal} />}
      </View>
    );
    playable = answered && !!saying;
  } else if (mode === 'type') {
    front = (
      <View style={{ gap: space.xl, alignItems: 'center' }}>
        <DateFront date={date} parts={parts} />
        <TypeField quiz={quiz} language={language} />
      </View>
    );
    back = quiz.checked ? <TypeBack quiz={quiz} saying={saying} rule={rule} onPlay={answer.speak} /> : undefined;
    footer = <ListenFooter verdict={quiz.checked ? { right: quiz.checked.verdict === 'exact' } : null} canCheck={!!quiz.typed.trim()} onCheck={quiz.check} onRetry={quiz.retry} onNext={next} />;
    playable = !!quiz.checked && !!saying;
  } else {
    const answered = !!quiz.tapped || quiz.revealed;
    front = <TapFront quiz={quiz} saying={saying} date={date} weekStartsOn={weekStartsOn} />;
    back = answered ? <TapBack quiz={quiz} date={date} rule={rule} /> : undefined;
    footer = answered ? <Button label="Next" onPress={next} /> : <Button label="Show answer" onPress={quiz.reveal} />;
  }

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
        <Stack.Toolbar.Menu key="1" inline title="Say it with">
          <Stack.Toolbar.MenuAction isOn={weekday} onPress={() => { answer.hide(); setWeekday(!weekday); }}>Weekday</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction isOn={year} onPress={() => { answer.hide(); setYear(!year); }}>Year</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>,
        <Stack.Toolbar.Menu key="2" inline title="Answer by">
          {DATE_MODES.map((m) => <Stack.Toolbar.MenuAction key={m} isOn={m === mode} onPress={() => { if (m !== mode) { answer.hide(); setMode(m); } }}>{MODE_LABELS[m]}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
      ]}
    >
      <PracticeCard
        questionKey={mode === 'explore' ? 'explore' : `${mode}|${date.year}-${date.month}-${date.day}|${weekday}|${year}`}
        cardKey={`${mode}|${date.year}-${date.month}-${date.day}|${weekday}|${year}|${answer.shown}|${answer.missed}`}
        swipe={swipe}
        motion={motion}
        onMark={markAndMove}
        onTap={mode === 'say' && !answer.shown ? showAnswer : undefined}
        onPlay={playable && saying ? () => answer.speak(saying.everyday) : undefined}
        speech={LANGUAGES[language].speech}
        front={front}
        back={back}
      />
    </ToolScreen>
  );
}
