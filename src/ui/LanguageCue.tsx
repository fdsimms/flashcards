import React from 'react';
import { Text, View } from 'react-native';
import { languageCue } from '../core/languageCue';
import type { CardKind } from '../core/types';
import { Icon } from './kit';
import { space, type, useTheme } from './theme';

/**
 * A quiet line under a native card's front: "Russian → English" on a card that shows the word,
 * "English → Russian" on one that asks for it, so a word spelled like an English one (у) isn't
 * mistaken for it and the answer's language is clear. Nothing when the language isn't known.
 * `trailing` (Review's mic button) sits at the line's end, centered with the line itself.
 */
export function LanguageCue({ kind, speechLang, trailing }: { kind: CardKind; speechLang: string | undefined; trailing?: React.ReactNode }) {
  const c = useTheme();
  const cue = languageCue(kind, speechLang);
  if (!cue) return trailing ? <View style={{ alignItems: 'center' }}>{trailing}</View> : null;
  const text = { ...type.footnote, color: c.textSecondary } as const;
  const line = (
    <View accessible accessibilityLabel={`${cue.from} to ${cue.to}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs + 2 }}>
      <Text style={text}>{cue.from}</Text>
      <Icon name="arrow.right" size={11} color={c.textSecondary} weight="semibold" />
      <Text style={text}>{cue.to}</Text>
    </View>
  );
  if (!trailing) return line;
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.m }}>{line}{trailing}</View>;
}
