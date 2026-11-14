import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import type { Language, RecapLine, Word } from '../reader/api';
import { readFont, scaledFontSize } from '../reader/fonts';
import { LANGUAGES } from '../reader/languages';
import { prefs } from '../reader/storage';
import { wrapGroups } from '../reader/wordLayout';
import { haptic } from './haptics';
import { Help, Icon, Tappable } from './kit';
import { WordView } from './ReadWord';
import { hairline, MIN_TAP, space, type, useTheme } from './theme';

/**
 * Last time, on the story card and at the top of an episode in the reader: what happened in the episode just read. An episode written since
 * the recap was asked for in the story's language shows it as words to tap, with its English
 * behind Show English; an older one has only the English recap and shows that.
 */
export function ReadRecap({ recap, line, language, tapped, onTap }: {
  recap: string;
  line: RecapLine | null | undefined;
  language: Language;
  /** The word whose meaning is showing, ringed while it is. */
  tapped: Word | null;
  onTap: (word: Word, x: number, y: number) => void;
}) {
  const c = useTheme();
  const [english, setEnglish] = useState(false);
  // Hidden again whenever the shelf is left, so the line is read before its English each time.
  useFocusEffect(useCallback(() => () => setEnglish(false), []));
  if (!recap && !line) return null;
  const info = LANGUAGES[language];
  // A little under the reader's own size, as the card's secondary part; Thai stays larger, as there.
  const fontSize = scaledFontSize(info.fontSize, prefs().textSize) - 3;
  const textStyle = { fontSize, lineHeight: fontSize * info.lineHeight, font: readFont(language, prefs().thaiFont) };
  return (
    <View style={{ marginTop: space.s, paddingTop: space.m, gap: space.xs, borderTopWidth: hairline, borderTopColor: c.border }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>Last time</Text>
      {line ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            {wrapGroups(line.words).map((chunk, j) => (
              <View key={j} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {chunk.map((word, m) => (
                  <WordView
                    key={m}
                    word={word}
                    textStyle={textStyle}
                    grammar={null}
                    flagged={false}
                    highlighted={false}
                    named={false}
                    selected={tapped === word}
                    onPress={onTap}
                  />
                ))}
              </View>
            ))}
          </View>
          {english ? <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21 }}>{line.english}</Text> : null}
          <Tappable
            onPress={() => { haptic.select(); setEnglish(!english); }}
            accessibilityRole="button"
            accessibilityState={{ expanded: english }}
            accessibilityLabel={english ? 'Hide English' : 'Show English'}
            style={{ alignSelf: 'flex-start', minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.xs }}
          >
            <Text style={{ ...type.subhead, fontWeight: '600', color: c.accent }}>{english ? 'Hide English' : 'Show English'}</Text>
            <Icon name={english ? 'chevron.up' : 'chevron.down'} size={12} color={c.accent} weight="semibold" />
          </Tappable>
        </>
      ) : (
        <Help>{recap}</Help>
      )}
    </View>
  );
}
