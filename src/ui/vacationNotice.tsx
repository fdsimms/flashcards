import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { activeMode, vacationNotice, type VacationNotice, type VacationPrefs } from '../core/vacation';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { Reveal } from './motion';
import { lift, radius, smooth, space, type, useTheme } from './theme';
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

/** What the deck list says about the vacation, or undefined. */
export function useVacationBanner(): VacationNotice | undefined {
  const prefs = useVacationPrefs();
  const { dayStartsAtHour } = useStudyToday();
  return vacationNotice(prefs, new Date(), dayStartsAtHour);
}

/**
 * The deck list's card while a vacation applies, and for two days after it ends. A tap opens the
 * setting (to end it early, extend it, or change the level). `due` is the deck list's review total.
 */
export function VacationCard({ notice, due }: { notice: VacationNotice; due: number }) {
  const c = useTheme();
  const router = useRouter();
  const away = notice.kind === 'away';
  const title = !away
    ? `Vacation ended after ${notice.days === 1 ? '1 day' : `${notice.days} days`}`
    : `Vacation: ${notice.mode === 'light' ? 'Light' : 'Paused'}${notice.until ? ` until ${vacationDate(notice.until)}` : ''}`;
  const detail = !away
    ? `${due.toLocaleString()} ${due === 1 ? 'card is' : 'cards are'} due. Reviews that came due while you were away come first, weakest first.`
    : notice.mode === 'light' ? 'Fewer new cards and reviews, weakest first.' : 'No cards are offered.';
  return (
    <Reveal
      style={{
        flexDirection: 'row', alignItems: 'center', borderRadius: radius.l, ...smooth,
        backgroundColor: c.surface, borderColor: c.border, borderWidth: 0.5, ...lift(c, 'high'),
      }}
    >
      <Tappable
        onPress={() => { haptic.tap(); router.push('/vacation'); }}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${detail}`}
        accessibilityHint="Opens Vacation mode"
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingVertical: space.m, paddingHorizontal: space.l }}
      >
        <Icon name={away ? 'airplane' : 'house.fill'} size={22} color={c.accent} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.callout, color: c.text }}>{title}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text>
        </View>
        <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
      </Tappable>
    </Reveal>
  );
}
