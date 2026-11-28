import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { syncLine } from '../../../anki/sync/runSync';
import { useConnectionProblem } from '../../../ui/connection';
import { answersFromLog } from '../../../wanikani/log';
import { useApp } from '../../../ui/AppContext';
import { CramCards } from '../../../ui/cram/CramCards';
import { ExtrasStrip } from '../../../ui/DailyExtras';
import { useDeckActions } from '../../../ui/DeckActions';
import { Today } from '../../../ui/Today';
import { useCrams } from '../../../ui/useCrams';
import { useDailyExtras } from '../../../ui/useDailyExtras';
import { useGrammarDueState } from '../../../ui/useGrammarDue';
import { useTodayReady } from '../../../ui/useTodayReady';
import { useTodaySummary } from '../../../ui/useTodaySummary';
import { WaniKaniDeck } from '../../../ui/WaniKaniDeck';
import { useReadWhileShown } from '../../../ui/useReadWhileShown';

/** The Today tab: the first screen, with only what's for today. */
export default function TodayRoute() {
  const router = useRouter();
  const { repo, decks, backup, ankiUnsent, syncSettings, syncing, sync, refresh, loadProblem, collapse, wanikani, reader } = useApp();
  const problem = useConnectionProblem();
  // Counts change while studying, so load them again each time this screen comes back into view.
  // `decks` starts empty until the first load from the database finishes, which is not the same as
  // having no decks: the empty state waits for it.
  const [loaded, setLoaded] = useState(false);
  useFocusEffect(useCallback(() => { refresh().finally(() => setLoaded(true)); }, [refresh]));
  // Read again when the app comes back too, or the count stays as it was when it went away.
  // `refresh` keeps to its own limit (COUNTS_EVERY_MS in useWaniKani.ts).
  useReadWhileShown(useCallback(() => { wanikani.refresh(); }, [wanikani.refresh]));
  const wanikaniAnswers = useMemo(() => answersFromLog(wanikani.log), [wanikani.log]);
  const { studied, settled: studiedSettled } = useTodaySummary(repo, decks, wanikaniAnswers);
  const openOptions = useCallback((deck: string) => router.push({ pathname: '/deck-options', params: { deck } }), [router]);
  const deckActions = useDeckActions(openOptions);
  const extras = useDailyExtras();
  const grammarDue = useGrammarDueState(reader.api, repo);
  const crams = useCrams(repo);
  // Filtered decks (Custom Study Session) hold no notes, so an empty one isn't "a deck with no words yet".
  const [filteredDecks, setFilteredDecks] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let live = true;
    repo.listDeckParams().then((all) => { if (live) setFilteredDecks(new Set([...all].filter(([, p]) => p.filtered).map(([d]) => d))); }).catch(() => undefined);
    return () => { live = false; };
  }, [repo, decks]);
  const ready = useTodayReady([loaded, studiedSettled, extras.ready, grammarDue.settled, crams.loaded]);
  return (
    <Today
      decks={decks}
      filteredDecks={filteredDecks}
      loaded={loaded}
      ready={ready}
      studied={studied}
      crams={<CramCards repo={repo} />}
      extrasStrip={<ExtrasStrip extras={extras} grammarDue={grammarDue.due} />}
      backup={backup}
      loadProblem={loadProblem ? { text: loadProblem, onRetry: refresh } : undefined}
      onImport={() => router.push('/anki')}
      onBackup={() => router.push('/backup')}
      onSettings={() => router.push({ pathname: '/settings-page', params: { page: 'today' } })}
      onLookUp={() => router.push('/look-up')}
      onOptions={openOptions}
      onDeckMenu={deckActions.menu}
      onDeckAction={deckActions.act}
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
