import React from 'react';
import { Text, View } from 'react-native';
import { fontOption, resolveFontFace, type AppFont } from '../core/fonts';
import { haptic } from './haptics';
import { Divider, Icon, Tappable } from './kit';
import { MIN_TAP, space, type, useTheme } from './theme';

/** Words in the scripts the decks use, to see a font's letters in them (Cyrillic, Polish and German accents). */
export const FONT_SAMPLE = 'Привет · Zażółć gęślą jaźń · Straße';

/**
 * A font's row on the font pickers, drawn in the font itself (`fontFamily` is always set, so the system
 * row shows the phone's font whatever the app is in). `choice` is a radio on the app's font screen and a
 * checkbox where several are picked (the random pool, a deck's cycle). `detail` adds the hint and a sample line.
 */
export function FontRow({ id, selected, choice, detail, first, onPress }: {
  id: AppFont; selected: boolean; choice: 'one' | 'many'; detail?: boolean; first?: boolean; onPress: () => void;
}) {
  const c = useTheme();
  const option = fontOption(id);
  const name = resolveFontFace(id, '600');
  const regular = resolveFontFace(id, '400');
  return (
    <Tappable
      onPress={() => { haptic.select(); onPress(); }}
      accessibilityRole={choice === 'one' ? 'radio' : 'checkbox'}
      accessibilityState={choice === 'one' ? { selected } : { checked: selected }}
      accessibilityLabel={option.label}
      scaleTo={1}
      dimTo={0.7}
      style={{ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l }}
    >
      {first ? null : <Divider inset={space.l} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, fontFamily: name, fontWeight: name ? undefined : '600', color: c.text }}>{option.label}</Text>
        {detail ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{option.hint}</Text> : null}
        {detail ? <Text style={{ ...type.callout, fontFamily: regular, color: c.text, marginTop: 2 }}>{FONT_SAMPLE}</Text> : null}
      </View>
      {selected ? <Icon name="checkmark" size={17} color={c.accent} weight="semibold" /> : null}
    </Tappable>
  );
}
