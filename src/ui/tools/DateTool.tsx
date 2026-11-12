import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import { randomDate, type CalendarDate } from '../../tools/date';
import { DATE_SAYERS, WEEK_STARTS_ON } from '../../tools/tools';
import { Card, Chip } from '../kit';
import { space } from '../theme';
import { CalendarMonth } from './CalendarMonth';
import type { ToolScreenProps } from './index';
import { AnswerCard, ControlLabel, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';

/**
 * Saying dates: a month calendar to pick a day on, or a date at random, then the date said in the
 * chosen language, with the weekday and the year when they're turned on. Changing the date or what
 * is said hides the answer again.
 */
export function DateTool({ tool, repo }: ToolScreenProps) {
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const [weekday, setWeekday] = useToolPref('dateWeekday');
  const [year, setYear] = useToolPref('dateYear');
  const [date, setDate] = useState<CalendarDate>(() => randomDate());

  const saying = useMemo(() => DATE_SAYERS[language]?.(date, { weekday, year }), [language, date, weekday, year]);
  const change = (next: CalendarDate) => { answer.hide(); setDate(next); };

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={() => change(randomDate(date))}
      onToggle={() => answer.toggle(saying?.everyday)}
    >
      <Card>
        <CalendarMonth date={date} onChange={change} weekStartsOn={WEEK_STARTS_ON[language]} />
      </Card>

      <View style={{ gap: space.s }}>
        <ControlLabel>Say it with</ControlLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          <Chip label="Weekday" selected={weekday} onPress={() => { answer.hide(); setWeekday(!weekday); }} />
          <Chip label="Year" selected={year} onPress={() => { answer.hide(); setYear(!year); }} />
        </View>
      </View>

      <AnswerCard
        shown={answer.shown}
        prompt={`Say the date in ${LANGUAGES[language].name} out loud, then show the answer.`}
        answer={saying && { everyday: saying.everyday, also: saying.also, last: { title: 'As written', phrase: saying.written } }}
        onPlay={answer.speak}
      />
    </ToolScreen>
  );
}
