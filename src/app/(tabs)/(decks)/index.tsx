import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { syncStatusText } from '../../../anki/sync/runSync';
import { quickAddDecks } from '../../../reader/noteQueue';
import { useApp } from '../../../ui/AppContext';
import { useDeckActions } from '../../../ui/DeckActions';
import { DeckList } from '../../../ui/DeckList';
import { WaniKaniDeck } from '../../../ui/WaniKaniDeck';

/** The deck list: the first screen, and where every other one leads back to. */
export default function DecksRoute() {
  const router = useRouter();
  const { decks, backup, ankiUnsent, syncSettings, syncing, sync, refresh, loadProblem, collapse, wanikani, reader } = useApp();
  // Counts change while studying, so load them again each time this screen comes back into view.
  // `decks` starts empty until the first load from the database finishes, which is not the same as
  // having no decks: the empty state waits for it.
  const [loaded, setLoaded] = useState(false);
  useFocusEffect(useCallback(() => { refresh().finally(() => setLoaded(true)); wanikani.refresh(); }, [refresh, wanikani.refresh]));
  const openOptions = useCallback((deck: string) => router.push({ pathname: '/deck-options', params: { deck } }), [router]);
  const deckActions = useDeckActions(openOptions);
  return (
    <DeckList
      decks={decks}
      loaded={loaded}
      backup={backup}
      loadProblem={loadProblem ? { text: loadProblem, onRetry: refresh } : undefined}
      ankiUnsent={ankiUnsent}
      onOpen={(deck) => router.push({ pathname: '/review', params: { deck } })}
      onImport={() => router.push('/anki')}
      onBackup={() => router.push('/backup')}
      onSettings={() => router.push('/settings')}
      onBrowse={() => router.push('/browse')}
      onStats={() => router.push('/stats')}
      onOptions={openOptions}
      onNewDeck={deckActions.create}
      onQuickAdd={reader.api && quickAddDecks(reader.settings?.decks, decks.map((d) => d.deck)).length ? () => router.push('/read-quick-add') : undefined}
      onDeckMenu={deckActions.menu}
      onMoveDeck={deckActions.move}
      collapsed={collapse.collapsed}
      onToggleCollapsed={collapse.toggle}
      extra={wanikani.on ? {
        due: wanikani.counts?.reviews ?? 0,
        fresh: wanikani.counts?.lessons ?? 0,
        refresh: () => wanikani.refresh(true),
        node: <WaniKaniDeck wanikani={wanikani} onOpen={() => router.push('/wanikani')} onOptions={() => router.push('/wanikani-settings')} />,
      } : undefined}
      sync={syncSettings?.enabled ? {
        syncing,
        status: syncStatusText(syncSettings, new Date()),
        failed: !!syncSettings.lastError,
        onSync: () => sync(),
      } : undefined}
    />
  );
}
