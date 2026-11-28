import { usePreventRemove } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { GOAL_DAYS, parseDailyGoal, type GoalResult, type GoalTarget } from '../core/dailyGoal';
import { failureText } from '../core/failure';
import type { DeckSettings } from '../core/types';
import { Bars } from './StatsBars';
import { Card, Field, Group, Help, Section, SwitchRow } from './kit';
import { radius, space, type, useTheme } from './theme';

/** Where the line under the switch is shown before a goal is set. */
const DEFAULT_GOAL = 100;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Deck options' "Keep to a daily goal" (src/core/dailyGoal.ts): the switch, the goal, and what
 * today's tuning set, with the month it expects. Saving goes through Deck options' own queue
 * (`onChange`); `retune` works today's value out again once the save has landed and reads the
 * screen back, so the gate's cap above and the deck list follow. `turnOff` turns the goal off and puts
 * back the value it replaced (`goalTurnedOff`).
 */
export function DeckDailyGoal({ settings, target, onChange, retune, turnOff }: {
  settings: DeckSettings;
  /** What the goal sets for this deck (`goalTarget`); undefined hides the section. */
  target: GoalTarget | undefined;
  onChange: (patch: Partial<DeckSettings>) => void;
  retune: () => Promise<void>;
  turnOff: () => void;
}) {
  const c = useTheme();
  const on = settings.dailyGoal !== undefined;
  const [text, setText] = useState(String(settings.dailyGoal ?? DEFAULT_GOAL));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  useEffect(() => { if (settings.dailyGoal !== undefined) setText(String(settings.dailyGoal)); }, [settings.dailyGoal]);

  const work = (patch: Partial<DeckSettings>) => {
    onChange(patch);
    setBusy(true);
    setProblem(undefined);
    retune()
      .catch((e) => setProblem(failureText(e, { what: "Couldn't work out today's value.", next: 'Try again.' })))
      .finally(() => setBusy(false));
  };

  // Leaving with a goal still being typed saves it (and works its value out behind the screen). A
  // goal that can't be used keeps the screen open with its reason, rather than being dropped.
  const typing = !!target && on && text !== String(settings.dailyGoal);
  usePreventRemove(typing, ({ repeat }) => {
    const parsed = parseDailyGoal(text);
    if ('error' in parsed) { setError(parsed.error); return; }
    work({ dailyGoal: parsed.goal });
    repeat();
  });
  if (!target) return null;

  const toggle = (next: boolean) => {
    setError(undefined);
    if (!next) { turnOff(); return; }
    const parsed = parseDailyGoal(text);
    const goal = 'goal' in parsed ? parsed.goal : DEFAULT_GOAL;
    if (!('goal' in parsed)) setText(String(DEFAULT_GOAL));
    work({ dailyGoal: goal });
  };

  const commit = () => {
    if (!on) return;
    const parsed = parseDailyGoal(text);
    if ('error' in parsed) { setError(parsed.error); return; }
    setError(undefined);
    if (parsed.goal !== settings.dailyGoal) work({ dailyGoal: parsed.goal });
  };

  const sets = target === 'gate'
    ? 'the most cards that can be in progress'
    : 'how many new cards this deck shows';
  const tuned = settings.goalTuned && settings.goalTuned.goal === settings.dailyGoal ? settings.goalTuned : undefined;
  return (
    <Section footer={on && tuned && !busy ? <Help>{summary(tuned, target)}</Help> : undefined}>
      <Group>
        <SwitchRow
          first
          label="Keep to a daily goal"
          hint={`Each study day, Franki sets ${sets} so that reviews and new cards together stay at or under this many a day for the next ${GOAL_DAYS} days. It works from your answers in this deck over the last 30 days. Reviews are never held back to meet the goal.`}
          value={on}
          onValueChange={toggle}
        />
      </Group>
      {on ? (
        <Card>
          <Field
            label="Cards a day"
            value={text}
            onChangeText={(v) => { setText(v); setError(undefined); }}
            onEndEditing={commit}
            keyboardType="number-pad"
            returnKeyType="done"
            error={!!error}
          />
          {error ? <Text style={{ ...type.subhead, color: c.danger }}>{error}</Text> : null}
          {busy ? <Help>Working out today's value.</Help>
            : problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text>
            : tuned ? <Outcome result={tuned} /> : null}
        </Card>
      ) : null}
    </Section>
  );
}

/** Today's value and the month expected at it, under the goal's line. */
function Outcome({ result }: { result: GoalResult }) {
  const c = useTheme();
  const average = Math.round(result.loads.reduce((n, v) => n + v, 0) / Math.max(1, result.loads.length));
  return (
    <View style={{ gap: space.m }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xl, rowGap: space.s }}>
        <Figure value={result.lever === 'gate' ? result.value : result.newToday} label={result.lever === 'gate' ? 'in progress allowed' : 'new today'} color={c.countNew} />
        <Figure value={average} label="cards a day expected" color={c.countDue} approximate />
      </View>
      {result.over ? (
        <Text style={{ ...type.subhead, color: c.warningInk, backgroundColor: c.warningFill, borderRadius: radius.m, padding: space.m, overflow: 'hidden' }}>
          Even with no new cards, up to {plural(Math.max(...result.loads), 'review', 'reviews')} a day {Math.max(...result.loads) === 1 ? 'is' : 'are'} expected over the next {GOAL_DAYS} days. New cards stay off until that falls to {result.goal.toLocaleString()}.
        </Text>
      ) : null}
      <Bars
        bars={result.loads.map((value) => ({ value }))}
        describe={(d, i) => [i === 0 ? 'Today' : `In ${plural(i, 'day', 'days')}`, `about ${plural(d.value, 'card', 'cards')}`]}
        first="Today"
        last={`In ${GOAL_DAYS - 1} days`}
        goal={result.goal}
      />
    </View>
  );
}

function Figure({ value, label, color, approximate }: { value: number; label: string; color: string; approximate?: boolean }) {
  const c = useTheme();
  return (
    <View>
      <Text style={{ ...type.title, color, fontVariant: ['tabular-nums'] }}>{approximate ? `about ${value.toLocaleString()}` : value.toLocaleString()}</Text>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{label}</Text>
    </View>
  );
}

/** What the tuning set, said under the card. */
function summary(r: GoalResult, target: GoalTarget): string {
  if (target === 'gate') return `Today's value is set as Maximum cards in progress, above. Turning the goal off puts back the value from before the goal.`;
  const where = target === 'anki'
    ? "It's this deck's own daily new card limit in Anki, so the other decks on its Anki options keep theirs."
    : "It's this deck's daily new card limit.";
  return `${plural(r.value, 'new card', 'new cards')} a day today. ${where} Turning the goal off puts back the limit from before the goal.`;
}
