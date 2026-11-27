import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SIDE_PANEL_WIDTH } from '../../core/wide';
import { hairline, space, type, useTheme } from '../theme';
import { useHeaderInset } from '../useHeaderInset';

/**
 * The tapped word's panel beside the text, on a window wide enough for both (`sidePanelFits`,
 * src/core/wide.ts): what the gloss popover shows on a phone, kept at the screen's right edge so
 * the text stays in full view and the next word replaces this one in place. With no word tapped
 * it says what the panel is for, and stays, so the text never shifts sideways.
 *
 * Laid over the screen's right edge; the text's scroll view leaves `SIDE_PANEL_WIDTH` clear for
 * it (Reader.tsx). It starts under the native header, which covers the top of a view that isn't
 * the screen's scroll view (useHeaderInset).
 */
export function ReaderWordPanel({ children }: { children?: React.ReactNode }) {
  const c = useTheme();
  const header = useHeaderInset();
  return (
    <View
      ref={header.ref}
      onLayout={header.onLayout}
      style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: SIDE_PANEL_WIDTH, paddingTop: header.top, borderLeftWidth: hairline, borderLeftColor: c.border }}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.l, gap: space.m, flexGrow: 1 }}>
        <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary }}>Word</Text>
        {children ?? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.l }}>
            <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>Tap a word to see its meaning.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
