import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import React, { useCallback } from 'react';
import { syncStatusText } from '../anki/sync/runSync';
import { useApp } from '../ui/AppContext';
import { DeckList } from '../ui/DeckList';

/** The deck list: the first screen, and where every other one leads back to. */
export default function DecksRoute() {
  const router = useRouter();
  const { decks, backup, ankiUnsent, syncSettings, syncing, sync, refresh, readerApi, collapse } = useApp();
  // Counts change while studying, so load them again each time this screen comes back into view.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  return (
    <DeckList
      decks={decks}
      backup={backup}
      ankiUnsent={ankiUnsent}
      onOpen={(deck) => router.push({ pathname: '/review', params: { deck } })}
      onImport={() => router.push('/anki')}
      onBackup={() => router.push('/backup')}
      onSettings={() => router.push('/settings')}
      onBrowse={() => router.push('/browse')}
      onOptions={(deck) => router.push({ pathname: '/deck-options', params: { deck } })}
      collapsed={collapse.collapsed}
      onToggleCollapsed={collapse.toggle}
      onRead={readerApi ? () => router.push('/read') : undefined}
      sync={syncSettings?.enabled ? {
        syncing,
        status: syncStatusText(syncSettings, new Date()),
        failed: !!syncSettings.lastError,
        onSync: () => { sync(); },
      } : undefined}
    />
  );
}
