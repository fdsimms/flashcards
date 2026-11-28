import React from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { failureText } from '../core/failure';
import {
  activeMode, chooseLength, chooseMode, VACATION_LENGTHS, VACATION_NEW_CHOICES, VACATION_REVIEW_CHOICES, type VacationMode, type VacationPrefs,
} from '../core/vacation';
import { Card, Help, Loading, Screen, SECTION_GAP, Section, Segments } from './kit';
import { space, type, useTheme, readable } from './theme';
import { vacationDate } from './vacationNotice';
import { saveVacation, useStudyToday, useVacationPrefs } from './vacationPrefs';

const lengthLabel = (days: number) => (days === 0 ? 'No end' : days === 7 ? '1 week' : days === 14 ? '2 weeks' : `${days} days`);

/**
 * Settings, Vacation mode: a lighter load while away (src/core/vacation.ts says what each level
 * does). It only changes what's offered each day and in what order, never a card's schedule, and
 * nothing here is sent to Anki.
 */
export function Vacation() {
  const c = useTheme();
  const prefs = useVacationPrefs();
  const { today, dayStartsAtHour } = useStudyToday();

  const save = async (next: VacationPrefs) => {
    try {
      await saveVacation(next);
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };

  const mode: VacationMode = prefs ? activeMode(prefs, today) : 'off';
  const hourText = new Date(2000, 0, 1, dayStartsAtHour).toLocaleTimeString(undefined, { hour: 'numeric' });
  const endText = !prefs || mode === 'off' ? '' : prefs.until
    ? `Back to normal on ${vacationDate(prefs.until)} at ${hourText}.`
    : "No end date. Turn it off when you're back.";

  return (
    <Screen title="Vacation mode" largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: SECTION_GAP }}>
        {!prefs ? <Loading /> : (
          <>
            <Section
              footer={(
                <Help>
                  {mode === 'off'
                    ? "For when you're away. Light shows fewer cards, the ones you're likeliest to remember first. Paused shows none. Card schedules don't change, and it only applies in Franki."
                    : mode === 'light'
                      ? "Each deck shows a few new cards and part of its review limit, the reviews you're likeliest to remember first. Cards you're still learning today aren't held back."
                      : 'No cards are offered, new or review.'}
                </Help>
              )}
            >
              <Segments
                options={[{ value: 'off', label: 'Off' }, { value: 'light', label: 'Light' }, { value: 'paused', label: 'Paused' }]}
                value={mode}
                onChange={(m) => save(chooseMode(prefs, m, today))}
              />
            </Section>
            {mode === 'light' ? <LightOptions prefs={prefs} onSave={save} /> : null}
            {mode !== 'off' ? (
              <>
                <Section
                  title="Back to normal"
                  footer={(
                    <Help>
                      When it ends, your decks' own limits return. Until you've caught up, reviews you're likeliest to remember come first, then your decks' own order returns.
                    </Help>
                  )}
                >
                  <Card style={{ gap: space.s }}>
                    <Segments
                      options={VACATION_LENGTHS.map((d) => ({ value: d, label: lengthLabel(d), accessibilityLabel: d === 0 ? 'No end date' : `After ${lengthLabel(d)}` }))}
                      value={prefs.length}
                      onChange={(d) => save(chooseLength(prefs, d, today))}
                    />
                    <Text style={{ ...type.footnote, color: c.textSecondary }}>{endText}</Text>
                  </Card>
                </Section>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function LightOptions({ prefs, onSave }: { prefs: VacationPrefs; onSave: (next: VacationPrefs) => void }) {
  const example = Math.max(1, Math.ceil(200 * prefs.reviewPercent / 100));
  return (
    <>
      <Section title="New cards per deck">
        <Segments
          options={VACATION_NEW_CHOICES.map((n) => ({ value: n, label: String(n), accessibilityLabel: n === 1 ? '1 new card' : `${n} new cards` }))}
          value={prefs.newPerDeck}
          onChange={(newPerDeck) => onSave({ ...prefs, newPerDeck })}
        />
      </Section>
      <Section title="Reviews per deck" footer={<Help>A deck that allows 200 reviews a day offers {example}. A deck's own limit is never raised.</Help>}>
        <Segments
          options={VACATION_REVIEW_CHOICES.map((p) => ({ value: p, label: `${p}%`, accessibilityLabel: `${p} percent of each deck's limit` }))}
          value={prefs.reviewPercent}
          onChange={(reviewPercent) => onSave({ ...prefs, reviewPercent })}
        />
      </Section>
    </>
  );
}
