import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { markWords, talkPieces } from '../../core/cramThemes';
import type { Language } from '../../reader/api';
import { scaledFontSize, talkTextStyle, type TextSize } from '../../reader/fonts';
import { dotOffsets, UNDERLINE_DOT } from '../../reader/cardGlosses';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Tappable } from '../kit';
import { space, type, useTheme } from '../theme';

/**
 * A talking point's line in the cram's language with its English: tapped, it's read aloud (`onSay`).
 * A word the learner hadn't studied when it was written (`unknown`) is underlined with dots, and a tap
 * on it says what it means underneath, or that it isn't in the deck yet when no meaning was kept.
 * Dotted means not studied yet, not missing from the deck: a new card the deck already has is dotted
 * too, so a screen that offers to add a dotted word checks the deck first (`useWordInDeck`).
 * The dots are drawn under the word's measured box, as on a card's sentence (`CardSentence`), because the
 * platform's dotted underline ran through the letters of Thai text.
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
  const pieces = useMemo(() => talkPieces(runs), [runs]);
  // Each marked word's width once laid out, which its dots are spread across.
  const [widths, setWidths] = useState<Record<number, number>>({});
  const line = info ? { ...talkTextStyle(info, size, scale), color: muted ? c.textSecondary : c.text } : { ...type.body, color: muted ? c.textSecondary : c.text };
  const glossSize = scaledFontSize(type.footnote.fontSize, size);
  const gloss = { ...type.footnote, fontSize: glossSize, lineHeight: Math.round(glossSize * (type.footnote.lineHeight / type.footnote.fontSize)), color: c.textSecondary };
  // The dots sit just under the glyphs: the line's leading below them is split evenly, so skip half of what the glyph box doesn't use.
  const lift = Math.max(0, Math.round((line.lineHeight - line.fontSize * 1.2) / 2));
  const toggle = (word: string) => { haptic.select(); setOpen(open === word ? undefined : word); };
  const meaning = open ? unknown.find((u) => u.word.toLowerCase() === open.toLowerCase()) : undefined;
  return (
    <Tappable
      onPress={() => { if (info && onSay) onSay(text); }}
      disabled={!info || !onSay}
      accessibilityRole="button"
      accessibilityLabel={`Hear ${text}`}
      scaleTo={0.99}
      style={{ gap: space.xs, paddingVertical: space.xs }}
    >
      {runs.some((r) => r.marked) ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {pieces.map((p, i) => {
            if (p.gap) return <View key={i} style={{ width: line.fontSize * 0.3 }} />;
            if (!p.marked) return <Text key={i} style={line}>{p.text}</Text>;
            const width = widths[i];
            return (
              <Pressable
                key={i}
                onLayout={(e) => { const w = e.nativeEvent.layout.width; setWidths((prev) => (prev[i] === w ? prev : { ...prev, [i]: w })); }}
                onPress={() => toggle(p.text)}
                accessibilityRole="button"
                accessibilityLabel={`${p.text}, not studied yet. Shows its meaning.`}
              >
                <Text style={line}>{p.text}</Text>
                {width ? dotOffsets(width).map((x, k) => (
                  <View key={k} pointerEvents="none" style={{ position: 'absolute', bottom: lift, left: x, width: UNDERLINE_DOT, height: UNDERLINE_DOT, backgroundColor: c.countNew }} />
                )) : null}
              </Pressable>
            );
          })}
        </View>
      ) : <Text style={line}>{text}</Text>}
      {english ? <Text style={gloss}>{english}</Text> : null}
      {open ? (
        <View style={{ paddingTop: 2 }}>
          <Text style={{ ...gloss, color: c.countNew }}>{meaning?.english ? `${open}: ${meaning.english}` : `${open} isn't in your deck yet.`}</Text>
        </View>
      ) : null}
    </Tappable>
  );
}
