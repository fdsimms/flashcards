import { useRouter } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { radius, space, type, useTheme } from './theme';

/**
 * A card's IPA (its Pronunciation field) where the language has a guide (src/tools/ipaGuide.ts): a pill
 * that opens what each of its symbols means (the `ipa` sheet, IpaSheet.tsx). A language with no guide
 * shows the IPA as plain text, as before (CardSide.tsx).
 */
export function IpaPill({ ipa, language }: { ipa: string; language: Language }) {
  const c = useTheme();
  const router = useRouter();
  return (
    <Tappable
      onPress={() => { haptic.tap(); router.push({ pathname: '/ipa', params: { ipa, language } }); }}
      accessibilityRole="button"
      accessibilityLabel={`Pronunciation ${ipa}`}
      accessibilityHint={`Shows what each sound means, with ${LANGUAGES[language].name} words to hear.`}
      style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, backgroundColor: c.accentFill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.xs }}
    >
      <Text style={{ ...type.body, lineHeight: 24, color: c.text }}>{ipa}</Text>
      <Icon name="info.circle" size={15} color={c.accent} />
    </Tappable>
  );
}
