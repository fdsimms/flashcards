import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { syncStatusText } from '../../../anki/sync/runSync';
import { useApp } from '../../../ui/AppContext';
import { useDeckActions } from '../../../ui/DeckActions';
import { DeckList } from '../../../ui/DeckList';

/** The deck list: the first screen, and where every other one leads back to. */
export default function DecksRoute() {
  const router = useRouter();
  const { decks, backup, ankiUnsent, syncSettings, syncing, sync, refresh, collapse } = useApp();
  // Counts change while studying, so load them again each time this screen comes back into view.
  // `decks` starts empty until the first load from the database finishes, which is not the same as
  // having no decks: the empty state waits for it.
  const [loaded, setLoaded] = useState(false);
  useFocusEffect(useCallback(() => { refresh().finally(() => setLoaded(true)); }, [refresh]));
  const openOptions = useCallback((deck: string) => router.push({ pathname: '/deck-options', params: { deck } }), [router]);
  const deckActions = useDeckActions(openOptions);
  return (
    <DeckList
      decks={decks}
      loaded={loaded}
      backup={backup}
      ankiUnsent={ankiUnsent}
      onOpen={(deck) => router.push({ pathname: '/review', params: { deck } })}
      onImport={() => router.push('/anki')}
      onBackup={() => router.push('/backup')}
      onSettings={() => router.push('/settings')}
      onBrowse={() => router.push('/browse')}
      onOptions={openOptions}
      onNewDeck={deckActions.create}
      onDeckMenu={deckActions.menu}
      collapsed={collapse.collapsed}
      onToggleCollapsed={collapse.toggle}
      sync={syncSettings?.enabled ? {
        syncing,
        status: syncStatusText(syncSettings, new Date()),
        failed: !!syncSettings.lastError,
        onSync: () => sync(),
      } : undefined}
    />
  );
}
