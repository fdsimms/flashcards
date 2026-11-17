import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { deckTint } from '../../core/deckBadge';
import { haptic } from '../haptics';
import { Tappable } from '../kit';
import { MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';

/** The tint a cover takes: from what it's about (a story's or a text's id), so it keeps its color wherever it shows. */
export function useCoverTint(key: string | number): string {
  const c = useTheme();
  return c.deckTints[deckTint(String(key), c.deckTints.length)];
}

/**
 * A text or a story as a cover in a row that scrolls sideways: its kind small on top, its title
 * large, and a line at the foot (with a bar for how far through a season a story is). No pictures:
 * the tint and the title are the cover.
 */
export function Cover({ tint, kind, title, meta, metaColor, progress, width = 220, onPress, onLongPress, accessibilityLabel, children }: {
  tint: string;
  kind: string;
  title: string;
  meta?: string;
  metaColor?: string;
  /** 0 to 1, drawn as a bar over the meta line; none when null or left out. */
  progress?: number | null;
  width?: number;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  children?: React.ReactNode;
}) {
  const c = useTheme();
  return (
    <Pressable
      onPress={() => { haptic.tap(); onPress(); }}
      onLongPress={onLongPress ? () => { haptic.select(); onLongPress(); } : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [kind, title, meta].filter(Boolean).join('. ')}
      accessibilityActions={onLongPress ? [{ name: 'more', label: 'More' }] : undefined}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'more') onLongPress?.(); }}
      style={({ pressed }) => ({
        width, minHeight: width < 200 ? 196 : 150, padding: space.m + 2, borderRadius: radius.l, ...smooth, backgroundColor: tint,
        justifyContent: 'space-between', gap: space.s, opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ gap: space.xs + 2 }}>
        <Text style={{ ...type.overline, fontSize: 11, color: c.textSecondary }}>{kind}</Text>
        <Text style={{ fontSize: 19, fontWeight: '800', lineHeight: 22, color: c.text }}>{title}</Text>
      </View>
      <View style={{ gap: space.s }}>
        {children}
        {progress != null ? (
          <View style={{ height: 4, borderRadius: 2, backgroundColor: c.border, overflow: 'hidden' }}>
            <View style={{ height: 4, width: `${Math.round(progress * 100)}%`, backgroundColor: c.accent }} />
          </View>
        ) : null}
        {meta ? <Text style={{ ...type.footnote, color: metaColor ?? c.textSecondary }}>{meta}</Text> : null}
      </View>
    </Pressable>
  );
}

/** A row of covers under a heading, with an action on the heading's right (See all, Play all). */
export function CoverRow({ title, action, children }: {
  title: string;
  action?: { label: string; accessibilityLabel?: string; onPress: () => void } | null;
  children: React.ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m, paddingHorizontal: space.l }}>
        <Text accessibilityRole="header" style={{ ...type.title, fontSize: 20, color: c.text, flexShrink: 1 }}>{title}</Text>
        {action ? (
          <Tappable
            onPress={() => { haptic.tap(); action.onPress(); }}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            style={{ minHeight: MIN_TAP, justifyContent: 'center' }}
          >
            <Text style={{ ...type.subhead, fontWeight: '600', color: c.accent }}>{action.label}</Text>
          </Tappable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.l, gap: space.s + 2 }}>
        {children}
      </ScrollView>
    </View>
  );
}
