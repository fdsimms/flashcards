import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { syncLine } from '../../../anki/sync/runSync';
import { useConnectionProblem } from '../../../ui/connection';
import { useApp } from '../../../ui/AppContext';
import { useDeckActions } from '../../../ui/DeckActions';
import { DeckList } from '../../../ui/DeckList';
import { WaniKaniDeck } from '../../../ui/WaniKaniDeck';
import { useReadWhileShown } from '../../../ui/useReadWhileShown';

/** The Decks tab: every deck, to study, organize and edit. What's for today is on Today. */
export default function DecksRoute() {
  const router = useRouter();
  const { decks, backup, ankiUnsent, syncSettings, syncing, sync, refresh, loadProblem, collapse, wanikani } = useApp();
  const problem = useConnectionProblem();
  // Counts change while studying, so load them again each time this screen comes back into view.
  // `decks` starts empty until the first load from the database finishes, which is not the same as
  // having no decks: the empty state waits for it.
  const [loaded, setLoaded] = useState(false);
  useFocusEffect(useCallback(() => { refresh().finally(() => setLoaded(true)); }, [refresh]));
  // Read again when the app comes back too, or the count stays as it was when it went away.
  // `refresh` keeps to its own limit (COUNTS_EVERY_MS in useWaniKani.ts).
  useReadWhileShown(useCallback(() => { wanikani.refresh(); }, [wanikani.refresh]));
  const openOptions = useCallback((deck: string) => router.push({ pathname: '/deck-options', params: { deck } }), [router]);
  const deckActions = useDeckActions(openOptions);
  return (
    <DeckList
      decks={decks}
      loaded={loaded}
      backup={backup}
      loadProblem={loadProblem ? { text: loadProblem, onRetry: refresh } : undefined}
      ankiUnsent={ankiUnsent}
      onImport={() => router.push('/anki')}
      onSettings={() => router.push({ pathname: '/settings-page', params: { page: 'decks' } })}
      onBrowse={() => router.push('/browse')}
      onStats={() => router.push('/stats')}
      onOptions={openOptions}
      onNewDeck={deckActions.create}
      onQuickAdd={() => router.push('/quick-add')}
      onDeckMenu={deckActions.menu}
      onDeckAction={deckActions.act}
      onMoveDeck={deckActions.move}
      collapsed={collapse.collapsed}
      onToggleCollapsed={collapse.toggle}
      extra={wanikani.on ? {
        due: wanikani.counts?.reviews ?? 0,
        fresh: wanikani.counts?.lessons ?? 0,
        refresh: () => wanikani.refresh(true),
        node: <WaniKaniDeck wanikani={wanikani} onOpen={() => router.push('/wanikani')} onOptions={() => router.push('/wanikani-settings')} onStats={() => router.push('/wanikani-stats')} />,
      } : undefined}
      sync={syncSettings?.enabled ? {
        syncing,
        ...syncLine(syncSettings, { problem, unsent: ankiUnsent }, new Date()),
        onSync: () => sync(),
      } : undefined}
    />
  );
}
