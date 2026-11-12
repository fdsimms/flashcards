import { NativeTabs } from 'expo-router/native-tabs';
import React from 'react';
import { useApp } from '../../ui/AppContext';

/**
 * The bottom tab bar: Decks, Read & Listen once it's signed in (or needs its passphrase again,
 * as the deck list's row used to), and Practice (src/tools/). Everything else (Review, Settings, the reader...) is pushed on
 * the root stack, over the bar.
 */
export default function TabsLayout() {
  const { reader } = useApp();
  return (
    <NativeTabs>
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
