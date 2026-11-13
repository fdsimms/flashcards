import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { bannerOf } from '../reader/noteQueue';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { lift, radius, smooth, space, type, useTheme } from './theme';
import { useNoteQueue } from './useNoteQueue';

/** What the deck list's note queue card says, or null with nothing queued (the card hides itself). */
export function useNoteQueueBanner() {
  const router = useRouter();
  const { reader } = useApp();
  const { queue } = useNoteQueue(reader.api);
  const banner = bannerOf(queue);
  return banner ? { ...banner, open: () => { haptic.tap(); router.push('/read-note-queue'); } } : null;
}

/** The card on the deck list: words waiting for Claude, ready to review, or that it couldn't fill in. */
export function NoteQueueCard({ banner }: { banner: NonNullable<ReturnType<typeof useNoteQueueBanner>> }) {
  const c = useTheme();
  const { tone, message, hint } = banner;
  const icon = tone === 'ready' ? 'checkmark.circle.fill' : tone === 'waiting' ? 'clock' : 'exclamationmark.triangle.fill';
  const color = tone === 'ready' ? c.good : tone === 'waiting' ? c.textSecondary : c.warning;
  return (
    <Tappable
      onPress={banner.open}
      accessibilityRole="button"
      accessibilityLabel={`${message}. ${hint}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingVertical: space.m, paddingHorizontal: space.l,
        borderRadius: radius.l, ...smooth, backgroundColor: c.surface, borderColor: c.border, borderWidth: 0.5, ...lift(c, 'high'),
      }}
    >
      <Icon name={icon} size={22} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.callout, color: c.text }}>{message}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text>
      </View>
      <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
    </Tappable>
  );
}
