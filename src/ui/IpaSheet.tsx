import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, Text } from 'react-native';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { ipaBreakdown } from '../tools/ipaGuide';
import { IpaSoundRow } from './IpaSoundRow';
import { Card, Group, Help, NavRow, Screen } from './kit';
import { readable, space, type, useTheme } from './theme';

/**
 * A word's IPA explained (the `ipa` sheet, opened from IpaPill.tsx on a card or in Look up, and a word popup's How it's said): each of its sounds once, in order,
 * with a word to hear (ipaGuide.ts's `ipaBreakdown`), then what its marks mean (stress, length, tone),
 * and the language's whole table on How it sounds' IPA tab.
 */
export function IpaSheet({ ipa, language, allSounds, onSay }: {
  ipa: string;
  language: Language;
  /** Offers the language's whole table (How it sounds' IPA tab), left out over another sheet (the `ipa` route). */
  allSounds: boolean;
  onSay: (word: string) => void;
}) {
  const c = useTheme();
  const router = useRouter();
  const { parts, marks } = ipaBreakdown(ipa, language);
  const info = LANGUAGES[language];
  return (
    <Screen title="How it's said" largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        <Text style={{ ...type.title, fontWeight: '500', color: c.text, textAlign: 'center' }} accessibilityLabel={`Pronunciation ${ipa}`}>{ipa}</Text>
        {parts.length ? (
          <>
            <Help>Tap a sound to hear a word with it.</Help>
            <Card style={{ paddingVertical: space.xs, gap: 0 }}>
              {parts.map((p, i) => <IpaSoundRow key={p.written} written={p.written} sound={p.sound} language={language} first={i === 0} onSay={onSay} />)}
            </Card>
          </>
        ) : (
          <Help>There are no IPA symbols here to explain.</Help>
        )}
        {marks.map((m) => <Help key={m.hint}>{m.hint}</Help>)}
        {allSounds ? <Group>
          <NavRow
            first
            icon={{ name: 'waveform', color: c.accent }}
            label={`All ${info.name} sounds`}
            // The sheet closes first, so the guide opens over the card and Back returns to it, rather than pushing on top of a sheet.
            onPress={() => { router.back(); router.push({ pathname: '/sounds', params: { language, tab: 'ipa' } }); }}
          />
        </Group> : null}
      </ScrollView>
    </Screen>
  );
}
