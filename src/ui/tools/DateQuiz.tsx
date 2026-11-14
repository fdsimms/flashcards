import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Text, View, type TextInputInstance } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import type { Language } from '../../reader/api';
import { checkTyped, type Check, type Segment } from '../../tools/answer';
import type { CalendarDate, DateParts, DateSaying } from '../../tools/date';
import { acceptedForms, dateOptions, quizCalendarStart, sameDate, type DateMode, type DateOption } from '../../tools/dateQuiz';
import type { Phrase } from '../../tools/phrase';
import { haptic } from '../haptics';
import { Card, Field, Icon, Tappable } from '../kit';
import { Reveal } from '../motion';
import { hairline, radius, smooth, space, type, useTheme } from '../theme';
import { dateLabel } from './CalendarMonth';
import { ChipChoice, PlayButton, RuleLine, Status, Ways, type ToolActions } from './ToolScreen';

/**
 * Saying dates besides saying it aloud: pick the phrase, type it, or read the phrase and tap the
 * date. `useDateQuiz` holds what each one needs and gives the footer's buttons; the parts below
 * draw them. Nothing is scheduled: a new date or a new setting starts the question over, and the
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
  /** The footer's buttons, or none while the answer is said aloud. */
  actions?: ToolActions;
  typed: string;
  setTyped: (text: string) => void;
  checked: Check | null;
  check: () => void;
  options: DateOption[];
  correct: number;
  picked: number | null;
  choose: (index: number) => void;
  /** Whether the answer was asked for rather than given (Show answer). */
  revealed: boolean;
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
    const verdict = checkTyped(typed, acceptedForms(saying));
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

  const randomize = { label: 'Another one', onPress: next };
  const showAnswer = { label: 'Show answer', onPress: reveal };
  let actions: ToolActions | undefined;
  if (mode === 'type') {
    actions = checked
      ? { secondary: { label: 'Try again', onPress: () => setChecked(null) }, primary: { label: 'Next', onPress: next } }
      : { secondary: randomize, primary: { label: 'Check', onPress: check, disabled: !typed.trim() } };
  } else if (mode === 'pick') {
    actions = picked !== null || revealed ? { primary: { label: 'Next', onPress: next } } : { secondary: randomize, primary: showAnswer };
  } else if (mode === 'tap') {
    actions = tapped || revealed ? { primary: { label: 'Next', onPress: next } } : { secondary: randomize, primary: showAnswer };
  }

  return { actions, typed, setTyped, checked, check, options, correct, picked, choose, revealed, view, setView, tapped, tap };
}

const MODES: { value: DateMode; label: string }[] = [
  { value: 'say', label: 'Say it' },
  { value: 'pick', label: 'Pick' },
  { value: 'type', label: 'Type' },
  { value: 'tap', label: 'Tap date' },
];

/** How the date is answered. */
export function ModeChips({ mode, onChange }: { mode: DateMode; onChange: (m: DateMode) => void }) {
  return <ChipChoice label="Answer by" options={MODES} value={mode} onChange={onChange} />;
}

/** Text with the marked stretches in color and underlined. */
function Marked({ segments, color }: { segments: Segment[]; color: string }) {
  const c = useTheme();
  return (
    <Text selectable style={{ ...type.body, lineHeight: 30, color: c.text }}>
      {segments.map((s, i) => (s.marked
        ? <Text key={i} style={{ color, fontWeight: '700', textDecorationLine: 'underline' }}>{s.text}</Text>
        : <Text key={i}>{s.text}</Text>))}
    </Text>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>{title}</Text>
      {children}
    </View>
  );
}

/** Type it: the field, then, once checked, what was right and what to fix. */
export function TypeAnswer({ quiz, saying, language, rule, onPlay }: {
  quiz: DateQuiz;
  saying: DateSaying | undefined;
  language: Language;
  rule: string | undefined;
  onPlay: (p: Phrase) => void;
}) {
  const c = useTheme();
  const input = useRef<TextInputInstance>(null);
  const { checked } = quiz;
  // Japanese is checked in kana only (acceptedForms): kanji typed through the IME can't show the reading.
  const kana = language === 'ja';
  // Focused when the question comes up and again after Try again, so the keyboard is already there.
  useEffect(() => { if (!checked) input.current?.focus(); }, [checked]);
  return (
    <View style={{ gap: space.m }}>
      <Field
        ref={input}
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
      {checked && saying ? (
        <Reveal>
          <Card>
            {checked.verdict === 'exact' ? (
              <Status tone="good">Right.</Status>
            ) : checked.verdict === 'close' ? (
              <Status tone="warn">{`Close. ${checked.differing} ${checked.differing === 1 ? 'letter differs' : 'letters differ'}.`}</Status>
            ) : (
              <Status tone="bad">Not quite. The letters that differ are marked.</Status>
            )}
            {checked.verdict !== 'exact' && checked.typed.length ? (
              <Block title="Your answer"><Marked segments={checked.typed} color={c.danger} /></Block>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
              <View style={{ flex: 1, gap: space.xs }}>
                {checked.verdict === 'exact' ? <Marked segments={checked.correct} color={c.countDue} /> : (
                  <Block title="Correct"><Marked segments={checked.correct} color={c.countDue} /></Block>
                )}
                {checked.expected.roman || checked.expected.note ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>{[checked.expected.roman, checked.expected.note].filter(Boolean).join(' · ')}</Text>
                ) : null}
              </View>
              <PlayButton label="Play the answer" onPress={() => onPlay(checked.expected)} />
            </View>
            {checked.verdict !== 'exact' && rule ? <RuleLine rule={rule} /> : null}
            <Ways title="Also accepted" phrases={acceptedForms(saying).filter((p) => p.text !== checked.expected.text)} onPlay={onPlay} />
          </Card>
        </Reveal>
      ) : (
        <Text style={{ ...type.footnote, color: c.textSecondary, paddingHorizontal: space.xs }}>
          {`Spaces and punctuation don't matter. ${kana ? 'Type it in kana.' : 'Write the numbers as words.'}`}
        </Text>
      )}
    </View>
  );
}

/** Pick the phrase: the right one among phrases for nearby dates. A wrong pick says which date it was. */
export function PickAnswer({ quiz, rule }: { quiz: DateQuiz; rule: string | undefined }) {
  const c = useTheme();
  const answered = quiz.picked !== null || quiz.revealed;
  const wrong = quiz.picked !== null && quiz.picked !== quiz.correct ? quiz.options[quiz.picked] : undefined;
  return (
    <View style={{ gap: space.m }}>
      <View style={{ gap: space.s }}>
        {quiz.options.map((o, i) => {
          const isRight = answered && i === quiz.correct;
          const isWrong = quiz.picked === i && i !== quiz.correct;
          const border = isRight ? c.countDue : isWrong ? c.danger : c.border;
          return (
            <Tappable
              key={o.phrase.text}
              onPress={() => quiz.choose(i)}
              disabled={answered}
              accessibilityRole="button"
              accessibilityLabel={`${o.phrase.text}${isRight ? ', right' : isWrong ? ', wrong' : ''}`}
              accessibilityState={{ selected: quiz.picked === i, disabled: answered }}
              scaleTo={0.99}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52, padding: space.m, backgroundColor: c.surface,
                borderRadius: radius.m, ...smooth, borderWidth: isRight || isWrong ? 1.5 : hairline, borderColor: border,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.body, lineHeight: 26, color: c.text }}>{o.phrase.text}</Text>
                {answered && o.phrase.roman ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{o.phrase.roman}</Text> : null}
              </View>
              {isRight ? <Icon name="checkmark.circle.fill" size={22} color={c.countDue} /> : null}
              {isWrong ? <Icon name="xmark.circle.fill" size={22} color={c.danger} /> : null}
            </Tappable>
          );
        })}
      </View>
      {quiz.picked !== null ? (
        <Reveal>
          {wrong ? <Status tone="bad">{`Not quite. That phrase is ${dateLabel(wrong.date)}.`}</Status> : <Status tone="good">Right.</Status>}
        </Reveal>
      ) : null}
      {(wrong || quiz.revealed) && rule ? <Reveal><RuleLine rule={rule} /></Reveal> : null}
    </View>
  );
}

/** Tap the date: the phrase, to read and hear, which the calendar below is tapped to answer. */
export function TapQuestion({ quiz, saying, onPlay }: { quiz: DateQuiz; saying: DateSaying | undefined; onPlay: (p: Phrase) => void }) {
  const c = useTheme();
  if (!saying) return null;
  const answered = !!quiz.tapped || quiz.revealed;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text selectable style={{ ...type.cardBack, color: c.text }}>{saying.everyday.text}</Text>
          {answered && saying.everyday.roman ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{saying.everyday.roman}</Text> : null}
        </View>
        <PlayButton label="Play the phrase" onPress={() => onPlay(saying.everyday)} />
      </View>
    </Card>
  );
}

/** What tapping the date came to. */
export function TapResult({ quiz, date, rule }: { quiz: DateQuiz; date: CalendarDate; rule: string | undefined }) {
  const c = useTheme();
  if (quiz.tapped) {
    const right = sameDate(quiz.tapped, date);
    return (
      <Reveal style={{ gap: space.m }}>
        {right
          ? <Status tone="good">Right.</Status>
          : <Status tone="bad">{`Not quite. You tapped ${dateLabel(quiz.tapped)}. The phrase is ${dateLabel(date)}.`}</Status>}
        {!right && rule ? <RuleLine rule={rule} /> : null}
      </Reveal>
    );
  }
  if (quiz.revealed) {
    return (
      <View style={{ gap: space.m }}>
        <Text style={{ ...type.subhead, color: c.textSecondary, paddingHorizontal: space.xs }}>{`That's ${dateLabel(date)}.`}</Text>
        {rule ? <RuleLine rule={rule} /> : null}
      </View>
    );
  }
  return <Text style={{ ...type.footnote, color: c.textSecondary, paddingHorizontal: space.xs }}>Move to the right month and tap the date.</Text>;
}
