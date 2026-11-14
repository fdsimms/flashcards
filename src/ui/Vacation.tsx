import React from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { failureText } from '../core/failure';
import {
  activeMode, chooseLength, chooseMode, VACATION_LENGTHS, VACATION_NEW_CHOICES, VACATION_REVIEW_CHOICES, type VacationMode, type VacationPrefs,
} from '../core/vacation';
import { Card, Help, Loading, Screen, SectionTitle, Segments } from './kit';
import { space, type, useTheme } from './theme';
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
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.m }}>
        {!prefs ? <Loading /> : (
          <>
            <Segments
              options={[{ value: 'off', label: 'Off' }, { value: 'light', label: 'Light' }, { value: 'paused', label: 'Paused' }]}
              value={mode}
              onChange={(m) => save(chooseMode(prefs, m, today))}
            />
            <Help>
              {mode === 'off'
                ? "For when you're away. Light offers a few new cards and fewer reviews, the ones closest to being forgotten first. Paused offers nothing. Neither changes any card's schedule, and nothing is sent to Anki."
                : mode === 'light'
                  ? 'Each deck offers a few new cards and part of its review limit, weakest cards first. Learning steps within the day are not limited, and a limit you set for today in Custom Study stands.'
                  : 'No cards are offered, new or review.'}
            </Help>
            {mode === 'light' ? <LightOptions prefs={prefs} onSave={save} /> : null}
            {mode !== 'off' ? (
              <>
                <SectionTitle>Back to normal</SectionTitle>
                <Card style={{ gap: space.s }}>
                  <Segments
                    options={VACATION_LENGTHS.map((d) => ({ value: d, label: lengthLabel(d), accessibilityLabel: d === 0 ? 'No end date' : `After ${lengthLabel(d)}` }))}
                    value={prefs.length}
                    onChange={(d) => save(chooseLength(prefs, d, today))}
                  />
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>{endText}</Text>
                </Card>
                <Help>
                  When it ends, reviews that came due while you were away come back weakest first, until they're done. Your decks' own limits and order return.
                </Help>
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
      <SectionTitle>New cards per deck</SectionTitle>
      <Segments
        options={VACATION_NEW_CHOICES.map((n) => ({ value: n, label: String(n), accessibilityLabel: n === 1 ? '1 new card' : `${n} new cards` }))}
        value={prefs.newPerDeck}
        onChange={(newPerDeck) => onSave({ ...prefs, newPerDeck })}
      />
      <SectionTitle>Reviews per deck</SectionTitle>
      <Segments
        options={VACATION_REVIEW_CHOICES.map((p) => ({ value: p, label: `${p}%`, accessibilityLabel: `${p} percent of each deck's limit` }))}
        value={prefs.reviewPercent}
        onChange={(reviewPercent) => onSave({ ...prefs, reviewPercent })}
      />
      <Help>A deck that allows 200 reviews a day offers {example}. A deck's own limit is never raised.</Help>
    </>
  );
}
