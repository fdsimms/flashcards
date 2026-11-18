import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { isInDeck } from '../core/deckTree';
import { activeMode } from '../core/vacation';
import { decksWaiting, dismissOn, lowDecks, parseDismissals, runwayText, type Dismissals, type LowDeck } from '../reader/newWords';
import { quickAddDecks } from '../reader/noteQueue';
import { useApp } from './AppContext';
import { deckShortName } from './deckShortName';
import { haptic } from './haptics';
import type { NextStep } from './ReviewNextSteps';
import { useHeldWords } from './held';
import { useNoteQueue } from './useNoteQueue';
import { useStudyToday, useVacationPrefs } from './vacationPrefs';

/**
 * The language decks running low on new cards (src/reader/newWords.ts), for Today's card and the
 * finished session's row, and the Suggested words screen they open. Only with Read & Listen on: its
 * server suggests the words and its note queue fills them in. A card dismissed on Today stays hidden
 * for the rest of the study day; that's kept in the Keychain, as this phone's own.
 */

const KEY = 'newWords.dismissed';

let dismissals: Dismissals = {};
let loaded: Promise<void> | undefined;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  loaded ??= SecureStore.getItemAsync(KEY).catch(() => null).then((raw) => {
    dismissals = parseDismissals(raw);
    for (const l of listeners) l();
  });
  return loaded;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Hides `deck`'s card until the next study day. Shown at once; a failed save only means it comes back after a relaunch. */
async function dismiss(deck: string, today: string): Promise<void> {
  dismissals = dismissOn(dismissals, deck, today);
  for (const l of listeners) l();
  await SecureStore.setItemAsync(KEY, JSON.stringify(dismissals)).catch(() => undefined);
}

export function useNewWords(): { low: LowDeck[]; dismiss: (deck: string) => void; open: (deck: LowDeck) => void } {
  const router = useRouter();
  const { decks, reader } = useApp();
  const { queue } = useNoteQueue(reader.api);
  const held = useHeldWords();
  const vacation = useVacationPrefs();
  const { today } = useStudyToday();
  const dismissed = useSyncExternalStore(subscribe, () => dismissals);
  useEffect(() => { void load(); }, []);

  const low = useMemo(() => {
    if (!reader.api || !reader.settings) return [];
    return lowDecks({
      options: quickAddDecks(reader.settings.decks, decks.map((d) => d.deck)),
      rows: decks,
      waiting: decksWaiting(queue?.items ?? [], held),
      dismissed: (deck) => dismissed[deck] === today,
      onVacation: !!vacation && activeMode(vacation, today) !== 'off',
    });
  }, [reader.api, reader.settings, decks, queue, held, dismissed, today, vacation]);

  const open = useCallback((d: LowDeck) => {
    haptic.tap();
    router.push({ pathname: '/read-new-words', params: { deck: d.deck, language: d.language, perDay: String(d.perDay) } });
  }, [router]);

  return { low, dismiss: (deck) => { haptic.tap(); void dismiss(deck, today); }, open };
}

/**
 * The finished session's "Keep going" row for a language deck running low: the deck studied, one
 * under it, or the one it's in. Null when none is. Takes the row's colors from the screen.
 */
export function useNewWordsStep(deck: string, color: string): NextStep | null {
  const { low, open } = useNewWords();
  const found = low.find((d) => isInDeck(d.deck, deck) || isInDeck(deck, d.deck));
  if (!found) return null;
  return {
    key: 'new-words',
    label: 'Add new words',
    detail: `${runwayText(found.left, found.perDay)} in ${deckShortName(found.deck)}`,
    icon: { name: 'plus', color },
    onPress: () => open(found),
  };
}
