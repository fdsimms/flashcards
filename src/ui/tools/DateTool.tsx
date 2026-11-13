import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import { randomDate, type CalendarDate } from '../../tools/date';
import { nextQuizDraw, quizDate, sameDate } from '../../tools/dateQuiz';
import { datePatterns } from '../../tools/patterns';
import { dateRule } from '../../tools/rules';
import { DATE_SAYERS, WEEK_STARTS_ON } from '../../tools/tools';
import { Card, Chip } from '../kit';
import { space } from '../theme';
import { CalendarMonth } from './CalendarMonth';
import type { ToolScreenProps } from './index';
import { ModeChips, PickAnswer, TapQuestion, TapResult, today, TypeAnswer, useDateQuiz } from './DateQuiz';
import { AnswerCard, ControlLabel, nextOnly, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

/**
 * Saying dates: a month calendar to pick a day on, or a date at random, then the date said in the
 * chosen language, with the weekday and the year when they're turned on. It's answered by saying
 * it and showing the answer, or (DateQuiz.tsx) by picking the phrase, typing it, or reading the
 * phrase and tapping the date. Saying it aloud is marked Missed it or Got it; the other ways mark
 * themselves. A miss shows the rule behind the answer, where there's one (rules.ts). A random date
 * leans toward the kinds missed lately (useMarks), and a date missed comes back once a few dates
 * later (useRetries). Changing the date or what is said hides the answer again.
 */
export function DateTool({ tool, repo }: ToolScreenProps) {
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
  const tapping = mode === 'tap';

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
      actions={quiz.actions ?? (answer.missed ? nextOnly(next) : undefined)}
    >
      {tapping ? <TapQuestion quiz={quiz} saying={saying} onPlay={answer.speak} /> : null}
      <Card>
        {tapping ? (
          <CalendarMonth
            date={quiz.view}
            weekStartsOn={WEEK_STARTS_ON[language]!}
            selected={quiz.tapped}
            onChange={quiz.tap}
            onNavigate={quiz.setView}
            right={quiz.tapped || quiz.revealed ? date : undefined}
            wrong={quiz.tapped && !sameDate(quiz.tapped, date) ? quiz.tapped : undefined}
            locked={!!quiz.tapped || quiz.revealed}
          />
        ) : (
          <CalendarMonth date={date} onChange={change} weekStartsOn={WEEK_STARTS_ON[language]!} />
        )}
      </Card>

      <View style={{ gap: space.s }}>
        <ControlLabel>Say it with</ControlLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          <Chip label="Weekday" selected={weekday} onPress={() => { answer.hide(); setWeekday(!weekday); }} />
          <Chip label="Year" selected={year} onPress={() => { answer.hide(); setYear(!year); }} />
        </View>
      </View>

      <ModeChips mode={mode} onChange={(m) => { answer.hide(); setMode(m); }} />

      {mode === 'say' ? (
        <AnswerCard
          shown={answer.shown}
          prompt={`Say the date in ${LANGUAGES[language].name} out loud, then show the answer.`}
          answer={saying && { everyday: saying.everyday, also: saying.also, last: { title: 'As written', phrase: saying.written } }}
          rule={answer.missed ? rule : undefined}
          onPlay={answer.speak}
        />
      ) : mode === 'type' ? (
        <TypeAnswer quiz={quiz} saying={saying} language={language} rule={rule} onPlay={answer.speak} />
      ) : mode === 'pick' ? (
        <PickAnswer quiz={quiz} rule={rule} />
      ) : (
        <TapResult quiz={quiz} date={date} rule={rule} />
      )}
    </ToolScreen>
  );
}
