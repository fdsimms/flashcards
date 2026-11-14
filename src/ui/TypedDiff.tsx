import React from 'react';
import { Text, View, type TextStyle } from 'react-native';
import { comparisonLine, type DiffPart, type TypedComparison } from '../core/typedCompare';
import { hasThai, thaiTextStyle } from '../core/script';
import { space, type, useTheme } from './theme';

/** One line of a comparison: matched text plain, the rest picked out (red and struck through where typed, green where missed). */
function Parts({ parts, style, typed, lang }: { parts: DiffPart[]; style: TextStyle; typed: boolean; lang?: string }) {
  const c = useTheme();
  return (
    <Text style={style} accessibilityLanguage={lang}>
      {parts.map((p, i) => (p.kind === 'same'
        ? p.text
        : (
          <Text
            key={i}
            style={typed
              ? { color: c.danger, backgroundColor: c.dangerFill, textDecorationLine: 'line-through' }
              : { color: c.good, backgroundColor: c.goodFill, fontWeight: '600' }}
          >
            {p.text}
          </Text>
        )))}
    </Text>
  );
}

/**
 * What was typed against what was expected (`compareTyped`), with a line on how close it was.
 * `showExpected` adds the expected text with what was missed picked out; Review leaves it off when
 * the card itself already shows the word.
 */
export function TypedDiff({ comparison, showExpected, size = 'title', lang, expectedLabel = 'Expected', showLine = true }: {
  comparison: TypedComparison;
  showExpected: boolean;
  /** The heading over the expected text: "The line", "Corrected". */
  expectedLabel?: string;
  /** The line on how close it was ("1 letter off."); off where a check says it instead. */
  showLine?: boolean;
  /** `title` for a word, `body` for a sentence. */
  size?: 'title' | 'body';
  /** The text's language, for VoiceOver. */
  lang?: string;
}) {
  const c = useTheme();
  const whole = comparison.typed.map((p) => p.text).join('') + comparison.expected.map((p) => p.text).join('');
  const base: TextStyle = hasThai(whole)
    ? thaiTextStyle('large')
    : size === 'title' ? { ...type.title, fontWeight: '400', lineHeight: 30 } : { ...type.body, fontSize: 20, lineHeight: 28 };
  const label = { ...type.overline, color: c.textSecondary };
  return (
    <View style={{ gap: space.s }}>
      {comparison.typed.length ? (
        <View style={{ gap: space.xs }}>
          <Text style={label}>Yours</Text>
          <Parts parts={comparison.typed} typed lang={lang} style={{ ...base, color: c.text }} />
        </View>
      ) : null}
      {showExpected && !comparison.exact ? (
        <View style={{ gap: space.xs }}>
          <Text style={label}>{expectedLabel}</Text>
          <Parts parts={comparison.expected} typed={false} lang={lang} style={{ ...base, color: c.text, fontWeight: '600' }} />
        </View>
      ) : null}
      {showLine ? <Text style={{ ...type.footnote, color: comparison.exact || comparison.sameWords ? c.good : c.textSecondary }}>{comparisonLine(comparison)}</Text> : null}
    </View>
  );
}
