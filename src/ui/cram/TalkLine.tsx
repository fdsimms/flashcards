import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { markWords } from '../../core/cramThemes';
import type { Language } from '../../reader/api';
import { scaledFontSize, talkTextStyle, type TextSize } from '../../reader/fonts';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Tappable } from '../kit';
import { space, type, useTheme } from '../theme';

/**
 * A talking point's line in the cram's language with its English: tapped, it's read aloud (`onSay`).
 * A word the learner hadn't studied when it was written (`unknown`) is underlined with dots, and a tap
 * on it says what it means underneath, or that it isn't in the deck yet when no meaning was kept.
 * Without a language the line is drawn in the body text and isn't read.
 */
export function TalkLine({ text, english, language, size, unknown = [], onSay, muted, scale = 1 }: {
  text: string;
  english?: string;
  language: Language | undefined;
  size: TextSize;
  unknown?: { word: string; english: string }[];
  onSay?: (text: string) => void;
  /** Drawn quieter (an answer under its question, a question already asked). */
  muted?: boolean;
  scale?: number;
}) {
  const c = useTheme();
  const [open, setOpen] = useState<string>();
  const info = language ? LANGUAGES[language] : undefined;
  const runs = useMemo(() => markWords(text, unknown.map((u) => u.word)), [text, unknown]);
  const line = info ? { ...talkTextStyle(info, size, scale), color: muted ? c.textSecondary : c.text } : { ...type.body, color: muted ? c.textSecondary : c.text };
  const gloss = { ...type.footnote, fontSize: scaledFontSize(type.footnote.fontSize, size), color: c.textSecondary };
  const meaning = open ? unknown.find((u) => u.word.toLowerCase() === open.toLowerCase()) : undefined;
  return (
    <Tappable
      onPress={() => { if (info && onSay) onSay(text); }}
      disabled={!info || !onSay}
      accessibilityRole="button"
      accessibilityLabel={`Hear ${text}`}
      scaleTo={0.99}
      style={{ gap: 2, paddingVertical: space.xs }}
    >
      <Text style={line}>
        {runs.map((r, i) => (r.marked ? (
          <Text
            key={i}
            onPress={() => { haptic.select(); setOpen(open === r.text ? undefined : r.text); }}
            accessibilityRole="button"
            accessibilityLabel={`${r.text}, not studied yet. Shows its meaning.`}
            style={{ textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: c.countNew }}
          >
            {r.text}
          </Text>
        ) : r.text))}
      </Text>
      {english ? <Text style={gloss}>{english}</Text> : null}
      {open ? (
        <View style={{ paddingTop: 2 }}>
          <Text style={{ ...gloss, color: c.countNew }}>{meaning?.english ? `${open}: ${meaning.english}` : `${open} isn't in your deck yet.`}</Text>
        </View>
      ) : null}
    </Tappable>
  );
}
