import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { LANGUAGES } from '../reader/languages';
import type { Language } from '../reader/api';
import {
  drawQuestion, drillAnswer, DRILL_QUESTIONS, GROUP_TITLES, questionText, suggestedRating, type DrillQuestion, type DrillStep,
} from '../tools/skills';
import { haptic } from './haptics';
import { Button, Icon, Tappable } from './kit';
import { Reveal } from './motion';
import { radius, smooth, space, type, useTheme } from './theme';
import { ClockFace } from './tools/ClockFace';
import { AnswerContent } from './tools/ToolScreen';

/**
 * A skill card's drill in Review (src/tools/skills.ts): a few questions from its step, each shown,
 * then marked Missed it or Got it, and once the last is marked the card is revealed and the rating
 * buttons come up with one outlined. Those marks are only the drill's: the rating the learner taps
 * is what Review answers the card with, as for any card. Review places the pieces; this file holds
 * the drill's state, the card's face and the footer while the drill runs.
 */

export interface Drill { step: DrillStep; language: Language }

interface DrillState { key: string; question: DrillQuestion; shown: boolean; results: boolean[] }

/** The drill of the card on screen, started afresh for each showing (`showing`, Review's). */
export function useSkillDrill(showing: string | undefined, drill: Drill | undefined) {
  const first = useMemo(() => (drill && showing ? drawQuestion(drill.step) : undefined), [showing, drill?.step.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<DrillState | null>(null);
  const live = state && state.key === showing ? state : first && showing ? { key: showing, question: first, shown: false, results: [] } : null;
  const done = !!live && live.results.length >= DRILL_QUESTIONS;
  return {
    drill,
    question: live?.question,
    shown: !!live?.shown,
    results: live?.results ?? [],
    done,
    /** The rating to outline once the drill is done. */
    suggested: drill && done ? suggestedRating(live!.results) : undefined,
    show: () => { if (live && !live.shown) setState({ ...live, shown: true }); },
    /** Marks the question; true when it was the last. */
    mark: (right: boolean): boolean => {
      if (!live || !drill || done) return false;
      const results = [...live.results, right];
      const last = results.length >= DRILL_QUESTIONS;
      setState({ key: live.key, question: last ? live.question : drawQuestion(drill.step, live.question), shown: false, results });
      return last;
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
        <View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i < results.length ? (results[i] ? c.good : c.again) : 'transparent', borderWidth: i === at ? 2 : i < results.length ? 0 : 1, borderColor: i === at ? c.accent : c.border }} />
      ))}
    </View>
  );
}

/** The card's face: the step's chip, then the question and its answer, or once done, how it went. */
export function SkillDrillCard({ skill, revealed }: { skill: SkillDrillState; revealed: boolean }) {
  const c = useTheme();
  const { drill, question } = skill;
  if (!drill || !question) return null;
  const answer = skill.shown ? drillAnswer(question, drill.language) : undefined;
  const right = skill.results.filter(Boolean).length;
  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, paddingTop: space.xl + space.l, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}>
      <View style={{ position: 'absolute', top: space.m, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.m, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.accentFill }}>
        <Icon name={drill.step.group === 'time' ? 'clock' : 'number'} size={12} color={c.accentInk} />
        <Text style={{ ...type.caption, fontWeight: '600', color: c.accentInk }}>{`Skill · ${GROUP_TITLES[drill.step.group]}`}</Text>
      </View>
      {revealed && skill.done ? (
        <Reveal key="done" rise={6} style={{ alignItems: 'center', gap: space.m }}>
          <Text style={{ ...type.overline, color: c.textSecondary, textAlign: 'center' }}>{drill.step.title}</Text>
          <Text style={{ ...type.largeTitle, fontSize: 44, color: c.text, fontVariant: ['tabular-nums'] }}>{`${right} of ${DRILL_QUESTIONS}`}</Text>
          <Dots results={skill.results} />
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
            {skill.suggested === 3 ? 'All right. Good is outlined.' : skill.suggested === 2 ? 'One miss. Hard is outlined.' : 'More than one miss. Again is outlined.'}
            {'\n'}Tap the rating that fits.
          </Text>
        </Reveal>
      ) : (
        <Reveal key={`${skill.results.length}`} rise={6} duration={140} style={{ alignItems: 'center', gap: space.l }}>
          <Dots results={skill.results} at={skill.results.length} />
          {question.kind === 'time' ? <ClockFace time={question.time} size={answer ? 120 : 180} /> : null}
          <Text selectable maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: question.kind === 'time' ? 34 : 48, color: c.text, fontVariant: ['tabular-nums'] }}>{questionText(question)}</Text>
          {answer ? (
            <View style={{ alignSelf: 'stretch', gap: space.l }}>
              <View style={{ height: 1, backgroundColor: c.textTertiary, opacity: 0.6 }} />
              <AnswerContent centered answer={answer} onPlay={() => undefined} />
            </View>
          ) : null}
        </Reveal>
      )}
    </ScrollView>
  );
}

/** The footer while the drill runs: Show answer, then Missed it and Got it, outlined so they don't read as Again and Good. */
export function SkillDrillFooter({ skill, onFinished, say }: { skill: SkillDrillState; onFinished: () => void; say: (text: string, speech: string) => void }) {
  const c = useTheme();
  const { drill, question } = skill;
  if (!drill || !question) return null;
  if (!skill.shown) {
    return (
      <Button
        label="Show answer"
        onPress={() => {
          skill.show();
          const answer = drillAnswer(question, drill.language);
          if (answer) say(answer.everyday.text, LANGUAGES[drill.language].speech);
        }}
      />
    );
  }
  const mark = (right: boolean) => {
    haptic.select();
    if (skill.mark(right)) onFinished();
  };
  return (
    <View style={{ flexDirection: 'row', gap: space.s }}>
      {[{ right: false, label: 'Missed it', edge: c.again }, { right: true, label: 'Got it', edge: c.good }].map((b) => (
        <Tappable
          key={b.label}
          onPress={() => mark(b.right)}
          accessibilityRole="button"
          accessibilityLabel={b.label}
          scaleTo={0.96}
          style={{ flex: 1, minHeight: 60, borderRadius: radius.m + 2, ...smooth, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: b.edge, backgroundColor: c.surface }}
        >
          <Text style={{ ...type.headline, color: c.text }}>{b.label}</Text>
        </Tappable>
      ))}
    </View>
  );
}
