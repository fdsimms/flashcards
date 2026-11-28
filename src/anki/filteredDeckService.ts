import type { AnkiSearchTiming } from '../core/ankiRowSearch';
import { nextStudyDayStart } from '../core/day';
import { filteredDeckProblem, type FilteredDeckConfig } from '../core/filteredDeck';
import { ankiToday } from '../core/order';
import { DeckRefused } from './deckService';
import { emptyAnkiFilteredDeck, filteredDeckId, readFilteredDeck, rebuildAnkiFilteredDeck, saveFilteredDeck } from './filteredDeckWrites';
import { NO_COLLECTION, type NoteStore } from './noteService';

/**
 * Making, changing, rebuilding and emptying a filtered deck (src/anki/filteredDeckWrites.ts) from
 * the app: in the kept collection, under the lock, then Franki's decks read in again (`refresh`,
 * `refreshFromKeptCollection`) so the cards that moved show where they are, as Custom Study does.
 * A filtered deck needs the collection: without one each is refused.
 */

async function ready(store: NoteStore, now: Date): Promise<{ timing: AnkiSearchTiming; knownFields: Map<string, string[]> }> {
  if (!(await store.keptCollection())) throw new DeckRefused(NO_COLLECTION);
  const cs = await store.collectionSettings();
  const today = ankiToday(now, cs.dayStartsAtHour, cs.collectionCreated, cs.creationOffset);
  if (today === undefined) throw new DeckRefused("Franki doesn't know when your Anki collection was created. Sync once, then try again.");
  const knownFields = new Map([...(await store.listNoteTypes()).values()].map((t) => [t.name, t.fields]));
  return {
    timing: {
      today, nextDayAt: Math.floor(nextStudyDayStart(now, cs.dayStartsAtHour).getTime() / 1000),
      now: Math.floor(now.getTime() / 1000), learnAheadSecs: Math.round(cs.learnAheadMinutes * 60),
    },
    knownFields,
  };
}

const GONE = "Anki doesn't have this filtered deck anymore. Sync, then try again.";

/** A filtered deck's settings, for its options. */
export async function loadFilteredDeck(store: NoteStore, deck: string): Promise<FilteredDeckConfig> {
  if (!(await store.keptCollection())) throw new DeckRefused(NO_COLLECTION);
  const found = await store.withSyncConnection(async (db) => {
    const id = await filteredDeckId(db, deck);
    return id === undefined ? undefined : readFilteredDeck(db, id);
  });
  if (!found) throw new DeckRefused(GONE);
  return found.config;
}

/**
 * Makes a filtered deck, or with `existing` (its name) changes that one, and builds it. Returns its
 * name as stored and how many cards went in. A search that gathers nothing is refused, changing nothing.
 */
export async function saveFilteredDeckFor(
  store: NoteStore, existing: string | undefined, config: FilteredDeckConfig, refresh: () => Promise<void>, now: Date = new Date(),
): Promise<{ name: string; count: number }> {
  const problem = filteredDeckProblem(config);
  if (problem) throw new DeckRefused(problem);
  const { timing, knownFields } = await ready(store, now);
  const saved = await store.lockAnki(() => store.withSyncConnection(async (db) => {
    const deckId = existing === undefined ? undefined : await filteredDeckId(db, existing);
    if (existing !== undefined && deckId === undefined) throw new DeckRefused(GONE);
    return saveFilteredDeck(db, { deckId, config, timing, knownFields, now });
  }));
  await store.lockAnki(refresh);
  return { name: saved.name, count: saved.count };
}

/** Rebuilds a filtered deck as it's set (Anki's Rebuild). Returns how many cards went in. */
export async function rebuildFilteredDeck(store: NoteStore, deck: string, refresh: () => Promise<void>, now: Date = new Date()): Promise<number> {
  const { timing, knownFields } = await ready(store, now);
  const count = await store.lockAnki(() => store.withSyncConnection(async (db) => {
    const id = await filteredDeckId(db, deck);
    if (id === undefined) throw new DeckRefused(GONE);
    return rebuildAnkiFilteredDeck(db, id, timing, knownFields, now);
  }));
  await store.lockAnki(refresh);
  return count;
}

/** Sends a filtered deck's cards back to their own decks (Anki's Empty). Returns how many went. */
export async function emptyFilteredDeckNamed(store: NoteStore, deck: string, refresh: () => Promise<void>, now: Date = new Date()): Promise<number> {
  if (!(await store.keptCollection())) throw new DeckRefused(NO_COLLECTION);
  const count = await store.lockAnki(() => store.withSyncConnection(async (db) => {
    const id = await filteredDeckId(db, deck);
    if (id === undefined) throw new DeckRefused(GONE);
    return emptyAnkiFilteredDeck(db, id, now);
  }));
  await store.lockAnki(refresh);
  return count;
}
