import React from 'react';
import { ScrollView } from 'react-native';
import { LANGUAGES } from '../reader/languages';
import { CHOICE_KINDS, PLAN_MINUTES, type ChoiceKind, type PlanMinutes } from '../tools/plan';
import { Card, Group, Help, Loading, Screen, Section, SECTION_GAP, Segments, Select, SwitchRow } from './kit';
import { readable, space } from './theme';
import { useDailyExtras } from './useDailyExtras';
import { useTodayPlan } from './useTodayPlan';

const KIND_LABELS: Record<ChoiceKind, string> = {
  read: 'A text to read',
  watch: 'A video or podcast from your shelf',
  listen: 'A Your words lesson',
  drill: 'A drill from what you missed',
  speak: 'A Situations scene',
  write: 'A journal entry',
};

/**
 * Today's plan's settings (src/tools/plan.ts): on or off, the time a day, the language (the one with
 * the most to do, or always one), and what the plan may pick. Reviews and new words are always in it.
 */
export function TodayPlanSettings() {
  const extras = useDailyExtras();
  const plan = useTodayPlan(extras);
  const prefs = plan.prefs;
  if (!prefs) return <Screen title="Today's plan"><Loading /></Screen>;
  const auto = 'The one with the most to do';
  const names = plan.languages.map((l) => LANGUAGES[l].name);
  return (
    <Screen title="Today's plan">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: SECTION_GAP }}>
        <Section footer={<Help>A few things for the day at the top of Today, ticked off as you do them. It takes the place of Daily extras' list; their drills are one kind of item in it.</Help>}>
          <Group>
            <SwitchRow first label="Show today's plan" value={prefs.on} onValueChange={(on) => void plan.savePrefs({ ...prefs, on })} />
          </Group>
        </Section>
        <Section title="Time a day" footer={<Help>Reviews always come first. When they'd fill the time, the plan is just reviews, and new words wait.</Help>}>
          <Card>
            <Segments<PlanMinutes>
              options={PLAN_MINUTES.map((m) => ({ value: m, label: `${m} min` }))}
              value={prefs.minutes}
              onChange={(minutes) => void plan.savePrefs({ ...prefs, minutes })}
            />
          </Card>
        </Section>
        <Section title="Language" footer={<Help>The plan is in one language a day, from the decks Read & Listen knows the language of.</Help>}>
          <Card>
            <Select
              label="Plan in"
              options={[auto, ...names]}
              value={prefs.language === 'auto' ? auto : LANGUAGES[prefs.language].name}
              onChange={(v) => {
                const picked = plan.languages.find((l) => LANGUAGES[l].name === v);
                void plan.savePrefs({ ...prefs, language: picked ?? 'auto' });
              }}
            />
          </Card>
        </Section>
        <Section title="What it can pick" footer={<Help>One thing to take in and one to produce, taking turns from day to day.</Help>}>
          <Group>
            {CHOICE_KINDS.map((k, i) => (
              <SwitchRow key={k} first={i === 0} label={KIND_LABELS[k]} value={prefs.kinds[k]} onValueChange={(on) => void plan.savePrefs({ ...prefs, kinds: { ...prefs.kinds, [k]: on } })} />
            ))}
          </Group>
        </Section>
      </ScrollView>
    </Screen>
  );
}
