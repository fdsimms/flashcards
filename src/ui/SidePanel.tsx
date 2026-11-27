import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SIDE_PANEL_WIDTH } from '../core/wide';
import { hairline, space, type, useTheme } from './theme';
import { useHeaderInset } from './useHeaderInset';

/**
 * A panel beside a screen's content column, on a window wide enough for both (`sidePanelFits`,
 * src/core/wide.ts): what a tap on the content chose (the reader's word, Browse's note), kept at
 * the screen's right edge so the content stays in full view and the next choice replaces this one
 * in place. With nothing chosen it says what the panel is for (`empty`), and stays, so the content
 * never shifts sideways.
 *
 * Laid over the screen's right edge; the screen's scroll view leaves `SIDE_PANEL_WIDTH` clear for
 * it (a right margin). It starts under the native header, which covers the top of a view that
 * isn't the screen's scroll view (useHeaderInset). `footer` stays at its foot while the rest scrolls.
 */
export function SidePanel({ label, empty, footer, children }: { label: string; empty: string; footer?: React.ReactNode; children?: React.ReactNode }) {
  const c = useTheme();
  const header = useHeaderInset();
  return (
    <View
      ref={header.ref}
      onLayout={header.onLayout}
      style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: SIDE_PANEL_WIDTH, paddingTop: header.top, borderLeftWidth: hairline, borderLeftColor: c.border }}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.l, gap: space.m, flexGrow: 1 }}>
        <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary }}>{label}</Text>
        {children ?? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.l }}>
            <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{empty}</Text>
          </View>
        )}
      </ScrollView>
      {children && footer ? <View style={{ padding: space.l, paddingTop: space.s }}>{footer}</View> : null}
    </View>
  );
}
