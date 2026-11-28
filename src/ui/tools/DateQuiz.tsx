import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Text, View, type TextInputInstance } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import type { Language } from '../../reader/api';
import { checkTyped, type Check, type Segment } from '../../tools/answer';
import type { CalendarDate, DateParts, DateSaying } from '../../tools/date';
import { acceptedForms, dateOptions, quizCalendarStart, sameDate, usualSpelling, type DateMode, type DateOption } from '../../tools/dateQuiz';
import type { Phrase } from '../../tools/phrase';
import { haptic } from '../haptics';
import { answerLook, Field, Icon, Tappable } from '../kit';
import { space, type, useTheme } from '../theme';
import { CalendarMonth, dateLabel, dateWords } from './CalendarMonth';
import { RuleLine, Status, Ways } from './ToolScreen';
import { withThaiLineHeight } from '../../core/script';

/**
 * Saying dates besides saying it aloud: pick the phrase, type it, or read the phrase and tap the
 * date. `useDateQuiz` holds what each one needs; the parts below draw them in the card (PracticeCard.tsx)
 * and its footer. Nothing is scheduled: a new date or a new setting starts the question over, and the
 * first answer to each question (or asking for the answer) is passed to `onResult`, which only leans
 * what comes up next (useMarks). A miss shows the rule behind the answer (`rule`, rules.ts) where
 * there's one.
 */

/** State that goes back to `initial` as soon as `key` (the question) changes, with no render in between showing the old answer. */
function useKeyedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [state, set] = useState({ key, value: initial });
  return [state.key === key ? state.value : initial, (value) => set({ key, value })];
}

/** Today, as the calendar opens on it to find a date. A calendar date's own fields, not a day key, so the local clock is right. */
export function today(): CalendarDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

export interface DateQuiz {
  /** The language being practiced, so what's said in it draws in its font. */
  language: Language;
  typed: string;
  setTyped: (text: string) => void;
  checked: Check | null;
  check: () => void;
  /** Try again: unchecked, still marked. */
  retry: () => void;
  options: DateOption[];
  correct: number;
  picked: number | null;
  choose: (index: number) => void;
  /** Whether the answer was asked for rather than given (Show answer). */
  revealed: boolean;
  /** Show answer, in Pick and Tap date: counts as missed. */
  reveal: () => void;
  /** Tap the date: the month in view, the day tapped. */
  view: CalendarDate;
  setView: (d: CalendarDate) => void;
  tapped: CalendarDate | null;
  tap: (d: CalendarDate) => void;
}

export function useDateQuiz({ mode, language, date, parts, saying, sayer, speak, next, onResult }: {
  mode: DateMode;
  language: Language;
  date: CalendarDate;
  parts: DateParts;
  saying: DateSaying | undefined;
  sayer: ((d: CalendarDate, parts: DateParts) => DateSaying) | undefined;
  speak: (p: Phrase) => void;
  /** A new date. */
  next: () => void;
  /** How the question went: once per question, at its first answer, so Try again can't count it twice. Asking for the answer counts as missed. */
  onResult: (right: boolean) => void;
}): DateQuiz {
  const question = `${mode}|${language}|${date.year}-${date.month}-${date.day}|${parts.weekday}|${parts.year}`;
  const resulted = useRef<string | null>(null);
  const result = (right: boolean) => {
    if (resulted.current === question) return;
    resulted.current = question;
    onResult(right);
  };
  const [typed, setTyped] = useKeyedState(question, '');
  const [checked, setChecked] = useKeyedState<Check | null>(question, null);
  const [picked, setPicked] = useKeyedState<number | null>(question, null);
  const [revealed, setRevealed] = useKeyedState(question, false);
  const [view, setView] = useKeyedState<CalendarDate>(question, quizCalendarStart(date, parts, today()));
  const [tapped, setTapped] = useKeyedState<CalendarDate | null>(question, null);

  const { options, correct } = useMemo(
    () => (sayer ? dateOptions(date, parts, sayer) : { options: [], correct: -1 }),
    // `parts` is a new object each render; its two flags are what matter.
    [sayer, date, parts.weekday, parts.year],
  );

  const check = () => {
    if (!saying || checked || !typed.trim()) return;
    Keyboard.dismiss();
    const verdict = checkTyped(usualSpelling(typed, saying), acceptedForms(saying));
    setChecked(verdict);
    // Close counts as missed: the letters off are often an ending, which is the hard part.
    result(verdict.verdict === 'exact');
    haptic.answer();
    speak(saying.everyday);
  };
  const choose = (index: number) => {
    if (!saying || picked !== null || revealed) return;
    setPicked(index);
    result(index === correct);
    haptic.answer();
    speak(saying.everyday);
  };
  const tap = (d: CalendarDate) => {
    if (!saying || tapped || revealed) return;
    setTapped(d);
    result(sameDate(d, date));
    haptic.answer();
    speak(saying.everyday);
  };
  const reveal = () => {
    if (!saying) return;
    setRevealed(true);
    result(false);
    setView({ ...date });
    speak(saying.everyday);
  };

  return { language, typed, setTyped, checked, check, retry: () => setChecked(null), options, correct, picked, choose, revealed, reveal, view, setView, tapped, tap };
}

/** The date as the question when it's shown as text: the weekday (or "Date"), the day and month, and the year when it's said. */
export function DateFront({ date, parts }: { date: CalendarDate; parts: DateParts }) {
  const c = useTheme();
  const words = dateWords(date);
  return (
    <View style={{ alignItems: 'center', gap: space.xs }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>{parts.weekday ? words.weekday : 'Date'}</Text>
      <Text maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: 44, color: c.text, textAlign: 'center' }}>{`${words.month} ${date.day}`}</Text>
      {parts.year ? <Text style={{ ...type.title, fontWeight: '400', color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{date.year}</Text> : null}
    </View>
  );
}

/** Text with the marked stretches in color and underlined. */
function Marked({ segments, color, speech }: { segments: Segment[]; color: string; speech: string }) {
  const c = useTheme();
  return (
    <Text selectable accessibilityLanguage={speech} style={{ ...type.body, lineHeight: 30, color: c.text, textAlign: 'center' }}>
      {segments.map((s, i) => (s.marked
        ? <Text key={i} style={{ color, fontWeight: '700', textDecorationLine: 'underline' }}>{s.text}</Text>
        : <Text key={i}>{s.text}</Text>))}
    </Text>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs, alignItems: 'center' }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>{title}</Text>
      {children}
    </View>
  );
}

/** Type it: the field, in the card under the date. */
export function TypeField({ quiz, language }: { quiz: DateQuiz; language: Language }) {
  const c = useTheme();
  const input = useRef<TextInputInstance>(null);
  const { checked } = quiz;
  // Japanese is checked in kana only (acceptedForms): kanji typed through the IME can't show the reading.
  const kana = language === 'ja';
  // Focused when the question comes up and again after Try again, so the keyboard is already there.
  useEffect(() => { if (!checked) input.current?.focus(); }, [checked]);
  return (
    <View style={{ gap: space.m, width: '100%' }}>
      <Field
        ref={input}
        keyboardLanguage={LANGUAGES[language].speech}
        label="Your answer"
        placeholder={kana ? 'Type the date in kana' : `Type the date in ${LANGUAGES[language].name}`}
        value={quiz.typed}
        onChangeText={quiz.setTyped}
        editable={!checked}
        onSubmitEditing={quiz.check}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="done"
        error={!!checked && checked.verdict !== 'exact'}
      />
      {checked ? null : (
        <Text style={{ ...type.footnote, color: c.textSecondary, paddingHorizontal: space.xs }}>
          {`Spaces and punctuation don't matter. ${kana ? 'Type it in kana.' : 'Write the numbers as words.'}`}
        </Text>
      )}
    </View>
  );
}

/** Type it, once checked: what was right and what to fix, under the card's divider. */
export function TypeBack({ quiz, saying, rule, onPlay }: { quiz: DateQuiz; saying: DateSaying | undefined; rule: string | undefined; onPlay: (p: Phrase) => void }) {
  const c = useTheme();
  const { checked } = quiz;
  if (!checked || !saying) return null;
  return (
    <View style={{ gap: space.m }}>
      <View style={{ alignItems: 'center' }}>
        {checked.verdict === 'exact' ? (
          <Status tone="good">Right.</Status>
        ) : checked.verdict === 'close' ? (
          <Status tone="warn">{`Close. ${checked.differing} ${checked.differing === 1 ? 'letter differs' : 'letters differ'}.`}</Status>
        ) : (
          <Status tone="bad">Not quite. The letters that differ are marked.</Status>
        )}
      </View>
      {checked.verdict !== 'exact' && checked.typed.length ? (
        <Block title="Your answer"><Marked speech={LANGUAGES[quiz.language].speech} segments={checked.typed} color={c.danger} /></Block>
      ) : null}
      <View style={{ gap: space.xs }}>
        {checked.verdict === 'exact' ? <Marked speech={LANGUAGES[quiz.language].speech} segments={checked.correct} color={c.countDue} /> : (
          <Block title="Correct"><Marked speech={LANGUAGES[quiz.language].speech} segments={checked.correct} color={c.countDue} /></Block>
        )}
        {checked.expected.roman || checked.expected.note ? (
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{[checked.expected.roman, checked.expected.note].filter(Boolean).join(' · ')}</Text>
        ) : null}
      </View>
      {checked.verdict !== 'exact' && rule ? <RuleLine rule={rule} /> : null}
      <Ways title="Also accepted" phrases={acceptedForms(saying).filter((p) => p.text !== checked.expected.text)} onPlay={onPlay} />
    </View>
  );
}

/** Pick the phrase: the right one among phrases for nearby dates, in the footer. The right one is marked once answered. */
export function PickChoices({ quiz }: { quiz: DateQuiz }) {
  const c = useTheme();
  const answered = quiz.picked !== null || quiz.revealed;
  return (
    <View style={{ gap: space.s }}>
      {quiz.options.map((o, i) => {
        const isRight = answered && i === quiz.correct;
        const isWrong = quiz.picked === i && i !== quiz.correct;
        return (
          <Tappable
            key={o.phrase.text}
            onPress={() => quiz.choose(i)}
            disabled={answered}
            accessibilityRole="button"
            accessibilityLabel={`${o.phrase.text}${isRight ? ', right' : isWrong ? ', wrong' : ''}`}
            accessibilityState={{ selected: quiz.picked === i, disabled: answered }}
            scaleTo={0.98}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52, paddingHorizontal: space.m, paddingVertical: space.s,
              ...answerLook(c, isRight ? 'right' : isWrong ? 'wrong' : 'open'),
            }}
          >
            <View style={{ flex: 1, gap: space.xs }}>
              <Text accessibilityLanguage={LANGUAGES[quiz.language].speech} style={{ ...type.body, lineHeight: 26, color: c.text }}>{o.phrase.text}</Text>
              {answered && o.phrase.roman ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{o.phrase.roman}</Text> : null}
            </View>
            {isRight ? <Icon name="checkmark.circle.fill" size={22} color={c.countDue} /> : null}
            {isWrong ? <Icon name="xmark.circle.fill" size={22} color={c.danger} /> : null}
          </Tappable>
        );
      })}
    </View>
  );
}

/** Pick, once answered: whether it was right (a wrong pick says which date that phrase was), and the rule after a miss. */
export function PickBack({ quiz, rule }: { quiz: DateQuiz; rule: string | undefined }) {
  const wrong = quiz.picked !== null && quiz.picked !== quiz.correct ? quiz.options[quiz.picked] : undefined;
  return (
    <View style={{ gap: space.m }}>
      {quiz.picked !== null ? (
        <View style={{ alignItems: 'center' }}>
          {wrong ? <Status tone="bad">{`Incorrect. That phrase is ${dateLabel(wrong.date)}.`}</Status> : <Status tone="good">Right.</Status>}
        </View>
      ) : null}
      {(wrong || quiz.revealed) && rule ? <RuleLine rule={rule} /> : null}
    </View>
  );
}

/** Tap the date: the phrase, to read and hear, and the month calendar under it that is tapped to answer. */
export function TapFront({ quiz, saying, date, weekStartsOn }: { quiz: DateQuiz; saying: DateSaying | undefined; date: CalendarDate; weekStartsOn: 0 | 1 }) {
  const c = useTheme();
  if (!saying) return null;
  const answered = !!quiz.tapped || quiz.revealed;
  return (
    <View style={{ gap: space.l, width: '100%' }}>
      <View style={{ gap: space.xs, alignItems: 'center' }}>
        <Text selectable accessibilityLanguage={LANGUAGES[quiz.language].speech} style={{ ...withThaiLineHeight(type.cardBack, saying.everyday.text), color: c.text, textAlign: 'center' }}>{saying.everyday.text}</Text>
        {answered && saying.everyday.roman ? <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{saying.everyday.roman}</Text> : null}
      </View>
      <CalendarMonth
        date={quiz.view}
        weekStartsOn={weekStartsOn}
        selected={quiz.tapped}
        onChange={quiz.tap}
        onNavigate={quiz.setView}
        right={quiz.tapped || quiz.revealed ? date : undefined}
        wrong={quiz.tapped && !sameDate(quiz.tapped, date) ? quiz.tapped : undefined}
        locked={!!quiz.tapped || quiz.revealed}
      />
      {answered ? null : <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>Move to the right month and tap the date.</Text>}
    </View>
  );
}

/** What tapping the date came to, under the card's divider. */
export function TapBack({ quiz, date, rule }: { quiz: DateQuiz; date: CalendarDate; rule: string | undefined }) {
  const c = useTheme();
  if (quiz.tapped) {
    const right = sameDate(quiz.tapped, date);
    return (
      <View style={{ gap: space.m }}>
        <View style={{ alignItems: 'center' }}>
          {right
            ? <Status tone="good">Right.</Status>
            : <Status tone="bad">{`Incorrect. You tapped ${dateLabel(quiz.tapped)}. The phrase is ${dateLabel(date)}.`}</Status>}
        </View>
        {!right && rule ? <RuleLine rule={rule} /> : null}
      </View>
    );
  }
  if (quiz.revealed) {
    return (
      <View style={{ gap: space.m }}>
        <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{`That's ${dateLabel(date)}.`}</Text>
        {rule ? <RuleLine rule={rule} /> : null}
      </View>
    );
  }
  return null;
}
