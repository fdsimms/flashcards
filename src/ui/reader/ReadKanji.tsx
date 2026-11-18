import React from 'react';
import { Text, View } from 'react-native';
import type { WordKanji } from '../../reader/api';
import { KANJI_CREDIT, kanjiSpoken, meaningsLine, readingsLine } from '../../reader/kanji';
import { hairline, radius, smooth, space, type, useTheme } from '../theme';

/** The kanji of the tapped Japanese word, each with its meanings and readings (the word popup). */
export function ReadKanji({ kanji }: { kanji: WordKanji[] }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs, marginTop: space.xs }}>
      <Text style={{ ...type.overline, color: c.textSecondary }} accessibilityRole="header">Kanji</Text>
      <View style={{ borderWidth: hairline, borderColor: c.border, borderRadius: radius.m, overflow: 'hidden', ...smooth }}>
        {kanji.map((k, i) => (
          <View
            key={k.char}
            accessible
            accessibilityLabel={kanjiSpoken(k)}
            style={{ flexDirection: 'row', gap: space.m, padding: space.m, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: c.border }}
          >
            <Text style={{ ...type.title, color: c.text, width: 36 }}>{k.char}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              {k.meanings.length ? <Text style={{ ...type.body, fontWeight: '600', color: c.text }}>{meaningsLine(k)}</Text> : null}
              {readingsLine(k) ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{readingsLine(k)}</Text> : null}
            </View>
          </View>
        ))}
      </View>
      <Text style={{ ...type.caption, color: c.textSecondary }}>{KANJI_CREDIT}</Text>
    </View>
  );
}
