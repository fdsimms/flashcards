import React from 'react';
import { Text, View } from 'react-native';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { exampleSpans, type IpaSound } from '../tools/ipaGuide';
import { Tappable } from './kit';
import { PlayDot } from './PlayCircle';
import { space, type, useTheme } from './theme';

/**
 * One IPA sound with its word: the symbol, the word with the letters that make the sound in gold, and the
 * hint, the whole row playing the word. Shared by the card's sheet (IpaSheet.tsx) and How it sounds' IPA tab
 * (SoundGuideScreen.tsx). `written` is the symbol as the card's IPA writes it (ɑː), where that differs from
 * the guide's (ɑ); a symbol the guide has no row for comes with no `sound` and says so.
 */
export function IpaSoundRow({ written, sound, language, first, onSay }: {
  written: string;
  sound?: IpaSound;
  language: Language;
  first: boolean;
  onSay: (word: string) => void;
}) {
  const c = useTheme();
  const info = LANGUAGES[language];
  const symbol = <Text style={{ ...type.title, fontWeight: '500', color: c.text, width: 56, textAlign: 'center' }} adjustsFontSizeToFit numberOfLines={1}>{written}</Text>;
  const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.m, paddingVertical: space.m, borderTopWidth: first ? 0 : 1, borderTopColor: c.border };
  if (!sound) {
    return (
      <View style={rowStyle}>
        {symbol}
        <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{`This symbol isn't in the ${info.name} guide.`}</Text>
      </View>
    );
  }
  return (
    <Tappable
      onPress={() => onSay(sound.example)}
      accessibilityRole="button"
      accessibilityLabel={`${written}, as in ${sound.example}. ${sound.hint} Play ${sound.example}`}
      style={rowStyle}
    >
      {symbol}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, color: c.text }} accessibilityLanguage={info.speech}>
          {exampleSpans(sound).map((part, i) => <Text key={i} style={part.marked ? { color: c.accent } : undefined}>{part.text}</Text>)}
        </Text>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{sound.hint}</Text>
      </View>
      <PlayDot />
    </Tappable>
  );
}
