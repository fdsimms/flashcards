import { NativeTabs } from 'expo-router/native-tabs';
import React from 'react';
import { useApp } from '../../ui/AppContext';
import { ReaderMiniPlayer } from '../../ui/reader/ReaderMiniPlayer';
import { useReaderPlayerHost } from '../../ui/useReaderPlayer';

/**
 * The bottom tab bar: Today (the first screen: only what's for today), Decks (every deck), Read &
 * Listen once it's signed in (or needs its passphrase again, as the deck list's row used to), and
 * Practice (src/tools/). Everything else (Review, Settings, the reader...) is pushed on
 * the root stack, over the bar.
 */
export default function TabsLayout() {
  const { reader } = useApp();
  const playing = useReaderPlayerHost().mini !== null;
  return (
    // On iOS 26 the bar shrinks as a list scrolls down and comes back on scrolling up; on iPad it can become a sidebar.
    <NativeTabs minimizeBehavior="onScrollDown" sidebarAdaptable>
      {/* While Play all carries on after the reader was closed: a pill above the tab bar, on every tab (iOS 26). */}
      {playing ? <NativeTabs.BottomAccessory><ReaderMiniPlayer /></NativeTabs.BottomAccessory> : null}
      <NativeTabs.Trigger name="(today)">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'sun.max', selected: 'sun.max.fill' }} md="today" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(decks)">
        <NativeTabs.Trigger.Label>Decks</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'rectangle.stack', selected: 'rectangle.stack.fill' }} md="style" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(read)" hidden={!reader.api && !reader.notice}>
        <NativeTabs.Trigger.Label>Read & Listen</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'book', selected: 'book.fill' }} md="menu_book" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(practice)">
        <NativeTabs.Trigger.Label>Practice</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'dice', selected: 'dice.fill' }} md="casino" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
