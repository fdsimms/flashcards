import { useRouter } from 'expo-router';
import React from 'react';
import { shareName } from '../core/shareInbox';
import { useApp } from './AppContext';
import { Banner } from './kit';
import { Reveal } from './motion';
import { shareInbox } from './shareInbox';
import { useTheme } from './theme';
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
    ? `Turn on Read & Listen to ${newest.kind === 'read' ? 'read it' : 'look it up'}.`
    : newest.kind === 'read' ? 'Tap to read it.' : newest.kind === 'lookup' ? 'Tap to look it up.' : 'Tap to add the words.';
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
      <Banner icon="square.and.arrow.down" iconColor={c.accent} title={banner.message} hint={banner.hint} onPress={banner.open} onDismiss={banner.dismiss} dismissLabel="Dismiss the share" />
    </Reveal>
  );
}
