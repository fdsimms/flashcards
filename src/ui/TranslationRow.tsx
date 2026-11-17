import React from 'react';
import { Text, View } from 'react-native';
import { hairline, space, type, useTheme } from './theme';

/**
 * A sentence's English translation, set off as a small section: a hairline, an ENGLISH label and the
 * translation beside it. Without the label a translation reads as one more line of the sentence, and one
 * that is itself a question ("What does this word mean?") reads as a prompt. `centered` is for the drills,
 * whose sentence is centered; elsewhere the row is left-aligned. ContextTranslation and the grammar
 * examples' `english` are English throughout, so the label is a literal.
 */
export function TranslationRow({ children, centered }: { children: React.ReactNode; centered?: boolean }) {
  const c = useTheme();
  return (
    <View
      style={{
        alignSelf: 'stretch', flexDirection: 'row', alignItems: 'baseline', gap: space.m,
        justifyContent: centered ? 'center' : 'flex-start',
        borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.s + 2,
      }}
    >
      <Text style={{ ...type.overline, color: c.textDim }}>English</Text>
      <View style={centered ? { flexShrink: 1 } : { flex: 1 }}>{children}</View>
    </View>
  );
}
