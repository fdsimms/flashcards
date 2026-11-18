import React from 'react';
import { Text, View } from 'react-native';
import { coverageLine, fontOption, resolveFontFace, type AppFont } from '../core/fonts';
import { haptic } from './haptics';
import { Divider, Icon, Tappable } from './kit';
import { MIN_TAP, space, type, useTheme } from './theme';

/** A line in each script a font may cover, to see its letters in them. A font that lacks one shows it in the system font. */
export const FONT_SAMPLE = 'Привет · Zażółć · Straße · Καλημέρα · สวัสดี · 日本語';

/**
 * A font's row on the font pickers, drawn in the font itself, hint and coverage included (`fontFamily` is always set, so the system
 * row shows the phone's font whatever the app is in). `choice` is a radio on the app's font screen and a
 * checkbox where several are picked (the random pool, a deck's cycle). `detail` adds the hint, what the font
 * covers and a sample line. `unavailable` dims the row and says why in its place (a deck's script the font
 * can't draw); it isn't tappable, so call it only for a font that isn't already checked.
 */
export function FontRow({ id, selected, choice, detail, unavailable, download, onRemove, first, onPress }: {
  id: AppFont; selected: boolean; choice: 'one' | 'many'; detail?: boolean; unavailable?: string; first?: boolean; onPress: () => void;
  /** A font that isn't on the phone yet: its size, or how far its download is (0 to 1). The row's press then starts the download. */
  download?: { size: string; progress?: number };
  /** Deletes a downloaded font. Shown beside the check. */
  onRemove?: () => void;
}) {
  const c = useTheme();
  const option = fontOption(id);
  const name = resolveFontFace(id, '600');
  const regular = resolveFontFace(id, '400');
  return (
    <Tappable
      onPress={() => { haptic.select(); onPress(); }}
      accessibilityRole={choice === 'one' ? 'radio' : 'checkbox'}
      accessibilityLabel={unavailable ? `${option.label}. ${unavailable}` : download ? `${option.label}. ${download.progress === undefined ? `Download, ${download.size}` : 'Downloading'}` : option.label}
      accessibilityState={{ disabled: !!unavailable, ...(choice === 'one' ? { selected } : { checked: selected }) }}
      disabled={!!unavailable}
      restOpacity={unavailable ? 0.45 : 1}
      scaleTo={1}
      dimTo={0.7}
      style={{ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l }}
    >
      {first ? null : <Divider inset={space.l} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, fontFamily: name, fontWeight: name ? undefined : '600', color: c.text }}>{option.label}</Text>
        {detail ? <Text style={{ ...type.footnote, fontFamily: regular, color: c.textSecondary }}>{option.hint}</Text> : null}
        {detail ? <Text style={{ ...type.footnote, fontFamily: regular, color: c.accentInk }}>{coverageLine(id)}</Text> : null}
        {unavailable ? <Text style={{ ...type.footnote, fontFamily: regular, color: c.textSecondary }}>{unavailable}</Text> : null}
        {detail ? <Text style={{ ...type.callout, fontFamily: regular, color: c.text, marginTop: 2 }}>{FONT_SAMPLE}</Text> : null}
      </View>
      {download ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Text style={{ ...type.footnote, color: c.accentInk }}>{download.progress === undefined ? download.size : `${Math.round(download.progress * 100)}%`}</Text>
          {download.progress === undefined ? <Icon name="arrow.down.circle" size={22} color={c.accent} /> : null}
        </View>
      ) : null}
      {onRemove ? (
        <Tappable accessibilityRole="button" accessibilityLabel={`Remove ${option.label}`} onPress={() => { haptic.tap(); onRemove(); }} hitSlop={space.s} style={{ paddingHorizontal: space.s, paddingVertical: space.xs }}>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>Remove</Text>
        </Tappable>
      ) : null}
      {selected ? <Icon name="checkmark" size={17} color={c.accent} weight="semibold" /> : null}
    </Tappable>
  );
}
