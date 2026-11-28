import { useRouter } from 'expo-router';
import React from 'react';
import { activeMode, vacationNotice, type VacationNotice, type VacationPrefs } from '../core/vacation';
import { Banner } from './kit';
import { Reveal } from './motion';
import { type, useTheme } from './theme';
import { useStudyToday, useVacationPrefs } from './vacationPrefs';

/** A study-day key as the phone writes dates, "Sat, Nov 28". */
export function vacationDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** What Settings says under Vacation mode. */
export function vacationDetail(prefs: VacationPrefs, today: string): string {
  const mode = activeMode(prefs, today);
  if (mode === 'off') return "Off. A lighter load while you're away";
  const name = mode === 'light' ? 'Light' : 'Paused';
  return prefs.until ? `${name} until ${vacationDate(prefs.until)}` : `${name}, with no end date`;
}

/** What Today says about the vacation, or undefined. */
export function useVacationBanner(): VacationNotice | undefined {
  const prefs = useVacationPrefs();
  const { dayStartsAtHour } = useStudyToday();
  return vacationNotice(prefs, new Date(), dayStartsAtHour);
}

/**
 * Today's card while a vacation applies, and for two days after it ends. A tap opens the
 * setting (to end it early, extend it, or change the level). `due` is Today's review total.
 */
export function VacationCard({ notice, due }: { notice: VacationNotice; due: number }) {
  const c = useTheme();
  const router = useRouter();
  const away = notice.kind === 'away';
  const title = !away
    ? `Vacation ended after ${notice.days === 1 ? '1 day' : `${notice.days} days`}`
    : `Vacation: ${notice.mode === 'light' ? 'Light' : 'Paused'}${notice.until ? ` until ${vacationDate(notice.until)}` : ''}`;
  const detail = !away
    ? `${due.toLocaleString()} ${due === 1 ? 'card is' : 'cards are'} due. Until you've caught up, the ones you're likeliest to remember come first.`
    : notice.mode === 'light' ? `Fewer new cards and reviews, the ones you're likeliest to remember first.` : 'No cards are offered.';
  return (
    <Reveal>
      <Banner icon={away ? 'airplane' : 'house.fill'} iconColor={c.accent} title={title} hint={detail} onPress={() => router.push('/vacation')} accessibilityHint="Opens Vacation mode" />
    </Reveal>
  );
}
