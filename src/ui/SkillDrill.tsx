import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { LANGUAGES } from '../reader/languages';
import type { Language } from '../reader/api';
import {
  drawRound, drillAnswer, GROUP_TITLES, heardRight, isSlow, medianMs, missesToCarry, questionKey, questionNote, questionText, suggestedRating, type DrillQuestion, type DrillStep,
} from '../tools/skills';
import { drillMissedMonths, drillSeenFor, loadDrillSeen, noteDrillAsked, noteDrillMonth } from '../tools/drillSeenStorage';
import { questionsToAsk } from '../tools/drillRound';
import { drillCarryOf, drillRoundFor, keepDrillCarry, keepDrillRound, loadDrillRounds } from '../tools/drillRoundStorage';
import { studyDayKey } from '../core/day';
import { haptic } from './haptics';
import { ListeningNote, SpeakButton } from './SpeakButton';
import { useSpokenAnswer } from './useSpokenAnswer';
import { Button, Icon, Tappable } from './kit';
import { Reveal } from './motion';
import { radius, smooth, space, type, useTheme } from './theme';
import { ClockFace } from './tools/ClockFace';
import { AnswerContent, Status } from './tools/ToolScreen';
import { ContrastChoices, ContrastSentenceView, ContrastVerdict } from './tools/ContrastParts';
import { contrastSet, showSentence } from '../tools/contrasts';

/**
 * A skill card's drill in Review (src/tools/skills.ts): a few questions from its step, each shown,
 * then marked Missed it or Got it, and once the last is marked the card is revealed and the rating
 * buttons come up with one outlined. Those marks are only the drill's: the rating the learner taps
 * is what Review answers the card with, as for any card. Review places the pieces; this file holds
 * the drill's state, the card's face and the footer while the drill runs.
 */

/** A drill's step and language, and for dates the months (1 to 12) and days of the month whose words the deck knows: only those are asked about. */
export interface Drill { step: DrillStep; language: Language; months?: number[]; days?: number[] }

/** The chip's symbol for each kind of drill. */
const GROUP_ICONS: Record<DrillStep['group'], 'clock' | 'number' | 'calendar' | 'banknote' | 'square.stack.3d.up' | 'text.badge.checkmark'> = { time: 'clock', numbers: 'number', dates: 'calendar', money: 'banknote', counting: 'square.stack.3d.up', contrast: 'text.badge.checkmark' };

/**
 * What each card's carried misses were before its latest answers, newest last, so an undo puts them
 * back. In memory only: undo reaches back through this session's answers and no further.
 */
const carryBefore = new Map<string, DrillQuestion[][]>();

interface DrillState {
  key: string;
  question: DrillQuestion;
  /** How many questions this showing asks: the day's round, or only what was missed when the card returns. */
  total: number;
  /** The questions after this one. */
  upcoming: DrillQuestion[];
  /** The ones missed so far in this showing. */
  missed: DrillQuestion[];
  shown: boolean;
  results: boolean[];
  /** When the question came up, and how long each answer took to give (to Show answer, or to the end of speaking it). */
  askedAt: number;
  times: number[];
  /** What the phone heard, when the answer was said aloud, and whether it's the answer. */
  heard?: { text: string; right: boolean };
  /** Which word fits: the word tapped (its index in the set), which is the answer to the question. */
  picked?: number;
  /** The state at each earlier mark, newest last, so Back can return to a marked question to look at it again. */
  trail: DrillState[];
}

/**
 * The drill of the card on screen, started afresh for each showing (`showing`, Review's). Its questions
 * are the card's for the study day (src/tools/drillRound.ts): the same however often the card comes
 * up, an undo included, and after Again or Hard only the ones missed.
 */
export function useSkillDrill(showing: string | undefined, drill: Drill | undefined, cardId: string | undefined, hardShown: boolean, dayStartsAtHour: number) {
  const first = useMemo(() => {
    if (!drill || !showing) return undefined;
    void loadDrillSeen();
    void loadDrillRounds();
    const day = studyDayKey(new Date(), dayStartsAtHour);
    const kept = cardId ? drillRoundFor(cardId, day, drill.step.id) : undefined;
    if (kept) return { questions: questionsToAsk(kept), at: Date.now() };
    const questions = drawRound(drill.step, Math.random, drill.language, { months: drill.months, days: drill.days }, drillSeenFor(drill.language, drill.step.id), drillMissedMonths(drill.language, drill.step.id));
    if (cardId) keepDrillRound(cardId, day, drill.step.id, questions);
    // Asked as far as the step's bag is concerned: the next card of the step leaves these for the others to come round first.
    for (const q of questions) noteDrillAsked(drill.language, drill.step.id, questionKey(q));
    return { questions, at: Date.now() };
  }, [showing, drill?.step.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<DrillState | null>(null);
  const live: DrillState | null = state && state.key === showing ? state : first && showing ? { key: showing, question: first.questions[0], total: first.questions.length, upcoming: first.questions.slice(1), missed: [], shown: false, results: [], askedAt: first.at, times: [], trail: [] } : null;
  const done = !!live && live.results.length >= live.total;
  const reveal = (heard?: string) => {
    if (!live || live.shown || !drill) return;
    setState({
      ...live, shown: true, times: [...live.times, Date.now() - live.askedAt],
      heard: heard === undefined ? undefined : { text: heard, right: heardRight(live.question, heard, drill.language) },
    });
  };
  return {
    drill,
    question: live?.question,
    /** How many questions this showing asks. */
    total: live?.total ?? 0,
    shown: !!live?.shown,
    heard: live?.heard,
    results: live?.results ?? [],
    done,
    /** Right throughout but slow (`SLOW_MS`): the reason Hard is outlined. */
    slow: !!drill && done && isSlow(live!.times, drill.step.group),
    seconds: live ? Math.round((medianMs(live.times) ?? 0) / 1000) : 0,
    /** The rating to outline once the drill is done. */
    suggested: drill && done ? suggestedRating(live!.results, live!.times, drill.step.group, hardShown) : undefined,
    show: () => reveal(),
    /** Which word fits: the word picked, by its index in the set. */
    picked: live?.picked,
    /** The questions missed in this showing, oldest first. */
    missed: live?.missed ?? [],
    /** Which word fits: a word tapped. It's the answer, so the question is shown with it; Next marks it. */
    pick: (index: number) => {
      if (!live || live.shown || !drill) return;
      setState({ ...live, shown: true, picked: index, times: [...live.times, Date.now() - live.askedAt] });
    },
    /** The answer said aloud: it's shown, with what was heard and whether that's it. */
    heardAnswer: (text: string) => reveal(text),
    /** Marks the question; true when it was the last. */
    mark: (right: boolean): boolean => {
      if (!live || !drill || done) return false;
      const results = [...live.results, right];
      const last = results.length >= live.total;
      // A dates drill's next round asks a month missed here first, until it's had right (`nextMonth`).
      if (live.question.kind === 'date') noteDrillMonth(drill.language, drill.step.id, live.question.date.month, right);
      const missed = right ? live.missed : [...live.missed, live.question];
      setState({ key: live.key, question: last ? live.question : live.upcoming[0], total: live.total, upcoming: last ? [] : live.upcoming.slice(1), missed, shown: false, results, askedAt: Date.now(), times: live.times, trail: [...live.trail, live] });
      return last;
    },
    /** Whether an earlier question can be gone back to. */
    canBack: !!live && live.trail.length > 0,
    /** Back to the question marked last, its answer showing, to be marked again. The question on screen is let go; the marks it replaces are taken back. */
    back: () => {
      if (!live || !live.trail.length) return;
      const previous = live.trail[live.trail.length - 1];
      setState({ ...previous, askedAt: Date.now(), trail: live.trail.slice(0, -1) });
    },
    /** The card was answered: after Again or Hard, what was missed is all it asks when it comes back; Good and Easy let it go. */
    rated: (rating: number) => {
      if (!cardId || !drill) return;
      carryBefore.set(cardId, [...(carryBefore.get(cardId) ?? []), drillCarryOf(cardId)]);
      keepDrillCarry(cardId, missesToCarry(rating, live?.missed ?? []));
    },
    /** A card's answer was changed to `rating` in place (Review's Change to Good or Again): what it carried goes as for a rating, though what was missed isn't known here. */
    redone: (redoneId: string, rating: number) => {
      carryBefore.set(redoneId, [...(carryBefore.get(redoneId) ?? []), drillCarryOf(redoneId)]);
      if (rating >= 3) keepDrillCarry(redoneId, []);
    },
    /** An answer was undone: the card carries what it carried before it. */
    undone: (undoneId: string) => {
      const stack = carryBefore.get(undoneId);
      const before = stack?.pop();
      if (!stack?.length) carryBefore.delete(undoneId);
      if (before) keepDrillCarry(undoneId, before);
    },
  };
}

export type SkillDrillState = ReturnType<typeof useSkillDrill>;

/** The questions answered so far, green or red, and the one being asked outlined. */
function Dots({ results, total, at }: { results: boolean[]; total: number; at?: number }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={`${results.filter(Boolean).length} of ${results.length} right so far`} style={{ flexDirection: 'row', gap: space.xs + 2, justifyContent: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: i < results.length ? (results[i] ? c.good : c.again) : 'transparent', borderWidth: i === at ? 2 : i < results.length ? 0 : 1, borderColor: i === at ? c.accent : c.textTertiary }} />
      ))}
    </View>
  );
}

/** The card's face: the step's chip, then the question and its answer, or once done, how it went. */
export function SkillDrillCard({ skill, revealed, say }: { skill: SkillDrillState; revealed: boolean; say: (text: string, speech: string) => void }) {
  const c = useTheme();
  const { drill, question } = skill;
  if (!drill || !question) return null;
  const answer = skill.shown ? drillAnswer(question, drill.language) : undefined;
  const right = skill.results.filter(Boolean).length;
  const answer0 = drillAnswer(question, drill.language);
  const speech = LANGUAGES[drill.language].speech;
  return (
    // The top padding clears the language pill CardSurface draws at the card's top edge in a mixed deck; the chip sits in the flow below it, never pinned to the same spot.
    // Tapping the card shows the answer, as on any card. Not an accessibility element itself: Show answer is the control VoiceOver uses.
    <Pressable accessible={false} disabled={skill.shown || skill.done || question.kind === 'contrast'} onPress={() => { haptic.select(); skill.show(); if (answer0 && speech) say(answer0.everyday.text, speech); }} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: space.xl, paddingTop: space.xxl + space.l, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}>
      <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.m, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.accentFill }}>
        <Icon name={GROUP_ICONS[drill.step.group]} size={12} color={c.accentInk} />
        <Text style={{ ...type.caption, fontWeight: '600', color: c.accentInk }}>{`Skill · ${GROUP_TITLES[drill.step.group]}`}</Text>
      </View>
      {revealed && skill.done ? (
        <Reveal key="done" rise={6} style={{ alignItems: 'center', gap: space.m }}>
          <Text style={{ ...type.overline, color: c.textSecondary, textAlign: 'center' }}>{drill.step.title}</Text>
          <Text style={{ ...type.largeTitle, fontSize: 44, color: c.text, fontVariant: ['tabular-nums'] }}>{`${right} of ${skill.total}`}</Text>
          <Dots results={skill.results} total={skill.total} />
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
            {right === skill.total
              ? skill.slow && skill.suggested === 2 ? `All correct, but slow (about ${skill.seconds} seconds each). Hard is outlined.` : 'All correct. Good is outlined.'
              : `${skill.total - right === 1 ? 'One miss.' : 'More than one miss.'} ${skill.suggested === 2 ? 'Hard' : 'Again'} is outlined.`}
            {'\n'}Tap the rating that fits.
          </Text>
          {skill.missed.map((q) => <MissedSentence key={questionKey(q)} question={q} />)}
        </Reveal>
      ) : (
        <Reveal key={`${skill.results.length}`} rise={6} duration={140} style={{ alignItems: 'center', gap: space.l }}>
          <Dots results={skill.results} total={skill.total} at={skill.results.length} />
          {question.kind === 'contrast' ? <ContrastFace key={questionKey(question)} skill={skill} /> : null}
          {question.kind === 'contrast' ? null : question.kind === 'time' ? <ClockFace time={question.time} size={answer ? 120 : 180} /> : null}
          {question.kind === 'contrast' ? null : <Text selectable maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: question.kind === 'time' ? 34 : question.kind === 'date' ? 30 : 44, color: c.text, fontVariant: ['tabular-nums'], textAlign: 'center' }}>{questionText(question, drill.language)}</Text>}
          {questionNote(question, drill.language) ? <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{questionNote(question, drill.language)}</Text> : null}
          {answer && question.kind !== 'contrast' ? (
            <View style={{ alignSelf: 'stretch', gap: space.l }}>
              <View style={{ height: 1, backgroundColor: c.textTertiary, opacity: 0.6 }} />
              {skill.heard ? (
                <View style={{ alignItems: 'center', gap: space.xs }}>
                  <Status tone={skill.heard.right ? 'good' : 'bad'}>{skill.heard.right ? 'Right.' : 'Not quite.'}</Status>
                  <Text accessibilityLanguage={LANGUAGES[drill.language].speech} style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{`Heard: ${skill.heard.text || 'nothing'}`}</Text>
                </View>
              ) : null}
              <AnswerContent centered answer={answer} onPlay={() => undefined} />
            </View>
          ) : null}
        </Reveal>
      )}
    </ScrollView>
    </Pressable>
  );
}

/** Which word fits' question on the card: the sentence with its gap, and once a word is picked, the verdict, the sentence filled in and the rule. The choices are in the footer, under the thumb. */
function ContrastFace({ skill }: { skill: SkillDrillState }) {
  const q = skill.question;
  if (q?.kind !== 'contrast') return null;
  const found = contrastSet(q.setId);
  const shown = found && showSentence(found.set, q.index, found.language);
  if (!shown) return null;
  const answered = skill.picked !== undefined;
  return <ContrastSentenceView shown={shown} answered={answered} verdict={answered ? <ContrastVerdict right={skill.picked === found.set.sentences[q.index].answer} answer={shown.answer.word} /> : undefined} />;
}

/** A sentence missed in this drill, filled in, on the card's back once the drill is done. */
function MissedSentence({ question }: { question: DrillQuestion }) {
  const c = useTheme();
  if (question.kind !== 'contrast') return null;
  const found = contrastSet(question.setId);
  const shown = found && showSentence(found.set, question.index, found.language);
  if (!shown) return null;
  return (
    <View style={{ alignSelf: 'stretch', gap: space.xs, backgroundColor: c.dangerFill, borderRadius: radius.m, ...smooth, paddingHorizontal: space.m, paddingVertical: space.s }}>
      <Text selectable style={{ ...type.body, color: c.text }}>{shown.before}<Text style={{ fontWeight: '700' }}>{shown.fill}</Text>{shown.after}</Text>
      <Text selectable style={{ ...type.footnote, color: c.textSecondary }}>{shown.english}</Text>
    </View>
  );
}

/** Back to the previous question of the drill, at the left of the footer's buttons. Nothing is shown until there is one. */
export function SkillBackButton({ skill, onBack }: { skill: SkillDrillState; onBack?: () => void }) {
  const c = useTheme();
  if (!skill.canBack) return null;
  return (
    <Tappable
      onPress={() => { haptic.select(); skill.back(); onBack?.(); }}
      accessibilityRole="button"
      accessibilityLabel="Previous question"
      scaleTo={0.95}
      style={{ width: 52, alignSelf: 'center', height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill }}
    >
      <Icon name="chevron.left" size={20} color={c.text} />
    </Tappable>
  );
}

/** The footer while the drill runs: Show answer, then Missed it and Got it, outlined so they don't read as Again and Good. */
export function SkillDrillFooter({ skill, onFinished, say }: { skill: SkillDrillState; onFinished: () => void; say: (text: string, speech: string) => void }) {
  const c = useTheme();
  const { drill, question } = skill;
  const speech = drill ? LANGUAGES[drill.language].speech : undefined;
  const answer = drill && question ? drillAnswer(question, drill.language) : undefined;
  // Answer by speaking (Settings, Speaking): what's heard is checked against every way of saying it, and the answer shown.
  const spoken = useSpokenAnswer(speech, {
    expected: answer ? [answer.everyday.text, ...answer.also.map((p) => p.text)] : undefined,
    onHeard: (text, final) => { if (final) skill.heardAnswer(text); },
  });
  // The card can be tapped to show the answer, which ends any listening the mic button started.
  useEffect(() => { if (skill.shown) spoken.cancel(); }, [skill.shown]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!drill || !question) return null;
  if (question.kind === 'contrast') {
    const found = contrastSet(question.setId);
    if (!found) return null;
    const answer = found.set.sentences[question.index]?.answer ?? 0;
    const shownSentence = showSentence(found.set, question.index, found.language);
    return (
      <View style={{ gap: space.s }}>
        <ContrastChoices
          key={questionKey(question)}
          set={found.set}
          language={drill.language}
          answer={answer}
          picked={skill.picked}
          onPick={(i) => {
            if (i === answer) haptic.success(); else haptic.answer();
            skill.pick(i);
            if (shownSentence && speech) say(shownSentence.filled, speech);
          }}
        />
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <SkillBackButton skill={skill} />
          {skill.shown ? <Button label="Next" style={{ flex: 1 }} onPress={() => { haptic.select(); if (skill.mark(skill.picked === answer)) onFinished(); }} /> : null}
        </View>
      </View>
    );
  }
  if (!skill.shown) {
    return (
      <View style={{ gap: space.s }}>
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <SkillBackButton skill={skill} />
          <SpeakButton spoken={spoken} label="Say the answer" />
          <Button
            label="Show answer"
            style={{ flex: 1 }}
            onPress={() => {
              spoken.cancel();
              skill.show();
              if (answer && speech) say(answer.everyday.text, speech);
            }}
          />
        </View>
        <ListeningNote spoken={spoken} language={LANGUAGES[drill.language].name} />
      </View>
    );
  }
  // After a spoken answer, the mark it suggests is filled in its color's quiet tint.
  const hint = skill.heard ? skill.heard.right : undefined;
  const mark = (right: boolean) => {
    haptic.select();
    if (skill.mark(right)) onFinished();
  };
  return (
    <View style={{ flexDirection: 'row', gap: space.s }}>
      <SkillBackButton skill={skill} />
      {[{ right: false, label: 'Missed it', edge: c.again, fill: c.dangerFill }, { right: true, label: 'Got it', edge: c.good, fill: c.goodFill }].map((b) => (
        <Tappable
          key={b.label}
          onPress={() => mark(b.right)}
          accessibilityRole="button"
          accessibilityLabel={b.label}
          scaleTo={0.96}
          style={{ flex: 1, minHeight: 60, borderRadius: radius.m + 2, ...smooth, alignItems: 'center', justifyContent: 'center', borderWidth: hint === b.right ? 3 : 1.5, borderColor: b.edge, backgroundColor: hint === b.right ? b.fill : c.surface }}
        >
          <Text style={{ ...type.headline, color: c.text }}>{b.label}</Text>
        </Tappable>
      ))}
    </View>
  );
}
