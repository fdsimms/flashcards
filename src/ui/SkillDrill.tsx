import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { LANGUAGES } from '../reader/languages';
import type { Language } from '../reader/api';
import {
  drillAnswer, DRILL_QUESTIONS, GROUP_TITLES, heardRight, isSlow, medianMs, missesToCarry, nextDrillQuestion, questionKey, questionNote, questionText, suggestedRating, type DrillQuestion, type DrillStep,
} from '../tools/skills';
import { drillSeenFor, loadDrillSeen, noteDrillAsked } from '../tools/drillSeenStorage';
import { haptic } from './haptics';
import { ListeningNote, SpeakButton } from './SpeakButton';
import { useSpokenAnswer } from './useSpokenAnswer';
import { Button, Icon, Tappable } from './kit';
import { Reveal } from './motion';
import { radius, smooth, space, type, useTheme } from './theme';
import { ClockFace } from './tools/ClockFace';
import { AnswerContent, Status } from './tools/ToolScreen';

/**
 * A skill card's drill in Review (src/tools/skills.ts): a few questions from its step, each shown,
 * then marked Missed it or Got it, and once the last is marked the card is revealed and the rating
 * buttons come up with one outlined. Those marks are only the drill's: the rating the learner taps
 * is what Review answers the card with, as for any card. Review places the pieces; this file holds
 * the drill's state, the card's face and the footer while the drill runs.
 */

/** A drill's step and language, and for dates the months (1 to 12) whose words the deck has studied: only those are asked about. */
export interface Drill { step: DrillStep; language: Language; months?: number[] }

/** The chip's symbol for each kind of drill. */
const GROUP_ICONS: Record<DrillStep['group'], 'clock' | 'number' | 'calendar' | 'banknote' | 'square.stack.3d.up'> = { time: 'clock', numbers: 'number', dates: 'calendar', money: 'banknote', counting: 'square.stack.3d.up' };

/**
 * The questions missed the last time a card was answered Again or Hard, by card id. When the card comes
 * back they're asked again before any new one, as a failed card in Anki comes back unchanged. Kept
 * in memory only, and dropped as soon as the card is answered Good or Easy.
 */
const carriedMisses = new Map<string, DrillQuestion[]>();

interface DrillState {
  key: string;
  question: DrillQuestion;
  /** Missed questions still to ask again, and the ones missed so far in this showing. */
  retry: DrillQuestion[];
  missed: DrillQuestion[];
  shown: boolean;
  results: boolean[];
  /** When the question came up, and how long each answer took to give (to Show answer, or to the end of speaking it). */
  askedAt: number;
  times: number[];
  /** What the phone heard, when the answer was said aloud, and whether it's the answer. */
  heard?: { text: string; right: boolean };
  /** The state at each earlier mark, newest last, so Back can return to a marked question to look at it again. */
  trail: DrillState[];
}

/** The drill of the card on screen, started afresh for each showing (`showing`, Review's). */
export function useSkillDrill(showing: string | undefined, drill: Drill | undefined, cardId: string | undefined) {
  const first = useMemo(() => {
    if (!drill || !showing) return undefined;
    void loadDrillSeen();
    const next = nextDrillQuestion(drill.step, undefined, (cardId && carriedMisses.get(cardId)) || [], Math.random, drill.language, drill.months, drillSeenFor(drill.language, drill.step.id));
    return { ...next, at: Date.now() };
  }, [showing, drill?.step.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<DrillState | null>(null);
  const live: DrillState | null = state && state.key === showing ? state : first && showing ? { key: showing, question: first.question, retry: first.retry, missed: [], shown: false, results: [], askedAt: first.at, times: [], trail: [] } : null;
  const done = !!live && live.results.length >= DRILL_QUESTIONS;
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
    shown: !!live?.shown,
    heard: live?.heard,
    results: live?.results ?? [],
    done,
    /** Right throughout but slow (`SLOW_MS`): the reason Hard is outlined. */
    slow: !!drill && done && isSlow(live!.times, drill.step.group),
    seconds: live ? Math.round((medianMs(live.times) ?? 0) / 1000) : 0,
    /** The rating to outline once the drill is done. */
    suggested: drill && done ? suggestedRating(live!.results, live!.times, drill.step.group) : undefined,
    show: () => reveal(),
    /** The answer said aloud: it's shown, with what was heard and whether that's it. */
    heardAnswer: (text: string) => reveal(text),
    /** Marks the question; true when it was the last. */
    mark: (right: boolean): boolean => {
      if (!live || !drill || done) return false;
      const results = [...live.results, right];
      const last = results.length >= DRILL_QUESTIONS;
      const missed = right ? live.missed : [...live.missed, live.question];
      // Asked now, so the next draw (and every later drill of this step) leaves it for the others to come round first.
      noteDrillAsked(drill.language, drill.step.id, questionKey(live.question));
      const next = last ? { question: live.question, retry: live.retry } : nextDrillQuestion(drill.step, live.question, live.retry, Math.random, drill.language, drill.months, drillSeenFor(drill.language, drill.step.id));
      setState({ key: live.key, question: next.question, retry: next.retry, missed, shown: false, results, askedAt: Date.now(), times: live.times, trail: [...live.trail, live] });
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
    /** The card was answered: after Again or Hard, what was missed comes back with it; Good and Easy let it go. */
    rated: (rating: number) => {
      if (!cardId) return;
      const carry = missesToCarry(rating, live?.missed ?? []);
      if (carry.length) carriedMisses.set(cardId, carry);
      else carriedMisses.delete(cardId);
    },
  };
}

export type SkillDrillState = ReturnType<typeof useSkillDrill>;

/** The questions answered so far, green or red, and the one being asked outlined. */
function Dots({ results, at }: { results: boolean[]; at?: number }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={`${results.filter(Boolean).length} of ${results.length} right so far`} style={{ flexDirection: 'row', gap: space.xs + 2, justifyContent: 'center' }}>
      {Array.from({ length: DRILL_QUESTIONS }, (_, i) => (
        <View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i < results.length ? (results[i] ? c.good : c.again) : 'transparent', borderWidth: i === at ? 2 : i < results.length ? 0 : 1, borderColor: i === at ? c.accent : c.textTertiary }} />
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
    <Pressable accessible={false} disabled={skill.shown || skill.done} onPress={() => { haptic.select(); skill.show(); if (answer0 && speech) say(answer0.everyday.text, speech); }} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: space.xl, paddingTop: space.xxl + space.l, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}>
      <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.m, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.accentFill }}>
        <Icon name={GROUP_ICONS[drill.step.group]} size={12} color={c.accentInk} />
        <Text style={{ ...type.caption, fontWeight: '600', color: c.accentInk }}>{`Skill · ${GROUP_TITLES[drill.step.group]}`}</Text>
      </View>
      {revealed && skill.done ? (
        <Reveal key="done" rise={6} style={{ alignItems: 'center', gap: space.m }}>
          <Text style={{ ...type.overline, color: c.textSecondary, textAlign: 'center' }}>{drill.step.title}</Text>
          <Text style={{ ...type.largeTitle, fontSize: 44, color: c.text, fontVariant: ['tabular-nums'] }}>{`${right} of ${DRILL_QUESTIONS}`}</Text>
          <Dots results={skill.results} />
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
            {skill.suggested === 3 ? 'All correct. Good is outlined.'
              : skill.suggested === 2 && skill.slow ? `All correct, but slow (about ${skill.seconds} seconds each). Hard is outlined.`
                : skill.suggested === 2 ? 'One miss. Hard is outlined.' : 'More than one miss. Again is outlined.'}
            {'\n'}Tap the rating that fits.
          </Text>
        </Reveal>
      ) : (
        <Reveal key={`${skill.results.length}`} rise={6} duration={140} style={{ alignItems: 'center', gap: space.l }}>
          <Dots results={skill.results} at={skill.results.length} />
          {question.kind === 'time' ? <ClockFace time={question.time} size={answer ? 120 : 180} /> : null}
          <Text selectable maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: question.kind === 'time' ? 34 : question.kind === 'date' ? 30 : 44, color: c.text, fontVariant: ['tabular-nums'], textAlign: 'center' }}>{questionText(question, drill.language)}</Text>
          {questionNote(question, drill.language) ? <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{questionNote(question, drill.language)}</Text> : null}
          {answer ? (
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
