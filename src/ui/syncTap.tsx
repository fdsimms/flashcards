import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Reveal } from './motion';
import { hairline, lift, radius, space, type, useTheme } from './theme';

/** Sync as a screen with a sync button gets it: present when sync is on. */
export interface SyncProp {
  syncing: boolean;
  status: string;
  failed: boolean;
  onSync: () => Promise<unknown> | void;
}

/** How long a tap on the sync button shows "Syncing" at least, however quickly the sync itself ends. */
const MIN_SYNC_SHOWN_MS = 1200;

/**
 * The sync button and pull-to-sync of Today and Decks. `also` reads anything else again with it
 * (WaniKani's counts). `shown` is for the pill, which answers a tap: a sync at launch or on
 * returning to the app runs quietly, the button disabled while it runs (`busy`).
 */
export function useSyncTap(sync: SyncProp | undefined, also?: () => Promise<unknown>) {
  // A tap shows "Syncing" for at least MIN_SYNC_SHOWN_MS, so a sync that has nothing to do or
  // finishes at once still visibly did something.
  const [tapped, setTapped] = useState(false);
  // The pull-down spinner is for a pull-down only. Tied to every sync, the one at launch scrolled
  // the list to show the spinner, and the large title flashed open and snapped shut.
  const [pulling, setPulling] = useState(false);
  const busy = !!sync && (sync.syncing || tapped);
  const tap = async () => {
    if (!sync || busy) return;
    setTapped(true);
    also?.();
    try {
      await Promise.all([sync.onSync(), new Promise((resolve) => setTimeout(resolve, MIN_SYNC_SHOWN_MS))]);
    } finally {
      setTapped(false);
    }
  };
  const pull = async () => {
    setPulling(true);
    try { await Promise.all([sync?.onSync(), also?.()]); } finally { setPulling(false); }
  };
  return { shown: !!sync && tapped, busy, tap, pulling, pull };
}

/** "Syncing…" over the list, not in it, so the rows don't move when it comes and goes; taps pass through. */
export function SyncingPill({ top }: { top: number }) {
  const c = useTheme();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: top + space.s, left: 0, right: 0, alignItems: 'center' }}>
      <Reveal rise={-8}>
      <View accessibilityRole="progressbar" accessibilityLabel="Syncing" style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: c.surface, borderColor: c.border, borderWidth: hairline, borderRadius: radius.pill, paddingVertical: space.s, paddingHorizontal: space.m, ...lift(c, 'high') }}>
        <ActivityIndicator size="small" color={c.textSecondary} />
        <Text style={{ ...type.footnote, color: c.text }}>Syncing…</Text>
      </View>
      </Reveal>
    </View>
  );
}
