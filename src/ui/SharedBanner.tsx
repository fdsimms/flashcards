import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { shareName } from '../core/shareInbox';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { Reveal } from './motion';
import { shareInbox } from './shareInbox';
import { hairline, lift, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';
import { openShare } from './useShareInbox';

/**
 * Today's card for text shared from another app that's still waiting (src/core/shareInbox.ts): one
 * shared over an hour ago, which useShareInbox doesn't open by itself, or a text to read while Read &
 * Listen is off. Null when nothing waits. The newest is named; the card says how many more.
 */
export function useSharedBanner() {
  const router = useRouter();
  const { reader } = useApp();
  const items = shareInbox.use();
  const newest = items[items.length - 1];
  if (!newest) return null;
  const more = items.length - 1;
  const needsReader = newest.kind !== 'words' && !reader.api;
  const what = needsReader
    ? `Turn on Read & Listen to ${newest.kind === 'read' ? 'read it' : newest.kind === 'video' ? 'watch it' : 'look it up'}.`
    : newest.kind === 'read' ? 'Tap to read it.' : newest.kind === 'video' ? 'Tap to add the video.' : newest.kind === 'lookup' ? 'Tap to look it up.' : 'Tap to add the words.';
  return {
    message: `Shared: ${shareName(newest)}`,
    hint: more ? `${what} ${more} more ${more === 1 ? 'share is' : 'shares are'} waiting.` : what,
    open: () => (needsReader ? router.push('/read-settings') : openShare(router, newest)),
    dismiss: () => shareInbox.remove(newest.id),
  };
}

export function SharedCard({ banner }: { banner: NonNullable<ReturnType<typeof useSharedBanner>> }) {
  const c = useTheme();
  return (
    <Reveal>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', borderRadius: radius.l, ...smooth,
          backgroundColor: c.surface, borderColor: c.border, borderWidth: hairline, ...lift(c, 'high'),
        }}
      >
        <Tappable
          onPress={() => { haptic.tap(); banner.open(); }}
          accessibilityRole="button"
          accessibilityLabel={`${banner.message}. ${banner.hint}`}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingVertical: space.m, paddingLeft: space.l }}
        >
          <Icon name="square.and.arrow.down" size={22} color={c.accent} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={2} style={{ ...type.callout, color: c.text }}>{banner.message}</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{banner.hint}</Text>
          </View>
        </Tappable>
        <Tappable
          onPress={() => { haptic.tap(); banner.dismiss(); }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss the share"
          style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', marginRight: space.xs }}
        >
          <Icon name="xmark" size={14} color={c.textTertiary} weight="semibold" />
        </Tappable>
      </View>
    </Reveal>
  );
}
