import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { hairline, space, type, useTheme } from './theme';

/**
 * A sentence's English translation, set off as a small section: a hairline, an ENGLISH label and the
 * translation beside it. Without the label a translation reads as one more line of the sentence, and one
 * that is itself a question ("What does this word mean?") reads as a prompt. `centered` is for the drills,
 * whose sentence is centered; elsewhere the row is left-aligned. ContextTranslation and the grammar
 * examples' `english` are English throughout, so the label is a literal.
 *
 * `literal` is the sentence's word-for-word reading (ContextLiteral), a second row under the natural
 * translation. Both labels take the wider one's width so the two texts start at the same edge.
 */
export function TranslationRow({ children, centered, literal }: { children: React.ReactNode; centered?: boolean; literal?: string }) {
  const c = useTheme();
  const [labelWidth, setLabelWidth] = useState(0);
  const label = (text: string) => (
    <Text
      style={{ ...type.overline, color: c.textDim, minWidth: labelWidth || undefined }}
      onLayout={(e) => { const w = Math.ceil(e.nativeEvent.layout.width); if (w > labelWidth) setLabelWidth(w); }}
    >
      {text}
    </Text>
  );
  return (
    <View
      style={{
        alignSelf: 'stretch', gap: space.s,
        borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.s + 2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.m, justifyContent: centered ? 'center' : 'flex-start' }}>
        {label('English')}
        <View style={centered ? { flexShrink: 1 } : { flex: 1 }}>{children}</View>
      </View>
      {literal ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.m }}>
          {label('Literal')}
          <Text style={{ ...type.footnote, color: c.textSecondary, flex: 1 }}>{literal}</Text>
        </View>
      ) : null}
    </View>
  );
}
