import { nextStudyDayStart, studyDayKey } from '../core/day';
import { cardHomeDeck } from '../core/deckTree';
import { Refusal } from '../core/failure';
import { newCardOrderOf } from '../core/newCardOrder';
import { ankiToday } from '../core/order';
import type { DeckOwnValues, PresetOptions } from '../core/presetOptions';
import { frankiCardReschedules, rescheduleFrankiCard } from '../core/retentionReschedule';
import { paramsForDeck } from '../core/scheduler';
import type { Card, DeckParams } from '../core/types';
import { NO_COLLECTION, type NoteStore } from './noteService';
import { readAnkiDeckNewLimit, readAnkiPreset, setAnkiDeckNewLimit, setAnkiPresetOptions, type AnkiPreset } from './presetWrites';
import { applyRetentionChange, countRetentionReschedule, retentionDecks, type RetentionResult } from './retentionWrites';

/** Why a preset's options can't be read or changed, with what to do, to show as it is. */
export class PresetRefused extends Refusal {}

/** A deck's Anki preset, as Anki options shows it. */
export interface PresetView {
  presetId: number;
  presetName: string;
  options: PresetOptions;
  /** Every deck the preset's options apply to, and what each keeps for itself. */
  decks: { name: string; own: DeckOwnValues }[];
}

/**
 * The preset a deck is studied with: the one `newCardOrderOf` (and so the queue, through
 * `paramsForDeck`) finds for it, a deck Anki doesn't have taking its nearest Anki ancestor's.
 */
async function presetIdOf(store: NoteStore, deck: string): Promise<number> {
  const id = newCardOrderOf(deck, await store.listDeckParams())?.presetId;
  if (id === undefined) throw new PresetRefused("This deck has no Anki options to change. Its cards are studied with the options of the decks they came from.");
  if (!(await store.keptCollection())) throw new PresetRefused(NO_COLLECTION);
  return id;
}

const GONE = "Anki doesn't have this deck's options anymore. Sync, then try again.";

function view(preset: AnkiPreset, params: Map<string, DeckParams>, todayKey: string): PresetView {
  return {
    presetId: preset.id,
    presetName: preset.name,
    options: preset.options,
    decks: preset.decks.map((d) => {
      const p = params.get(d.name);
      return {
        name: d.name,
        own: {
          ...d.own,
          ...(p?.newLimitToday?.day === todayKey ? { newToday: true } : {}),
          ...(p?.reviewLimitToday?.day === todayKey ? { reviewToday: true } : {}),
        },
      };
    }),
  };
}

/** A deck's preset options and the decks they apply to, read from the kept collection. */
export async function loadPreset(store: NoteStore, deck: string, now: Date = new Date()): Promise<PresetView> {
  const id = await presetIdOf(store, deck);
  const preset = await store.withSyncConnection((db) => readAnkiPreset(db, id));
  if (!preset) throw new PresetRefused(GONE);
  const [params, settings] = await Promise.all([store.listDeckParams(), store.collectionSettings()]);
  return view(preset, params, studyDayKey(now, settings.dayStartsAtHour));
}

/** The cards of Franki's own (none from Anki) in `decks` that rescheduling would move. */
async function frankiCardsIn(store: NoteStore, decks: Set<string>): Promise<Card[]> {
  const notes = new Map((await store.listNotes()).map((n) => [n.id, n]));
  return (await store.listCards()).filter((c) => {
    const note = notes.get(c.noteId);
    return !c.ankiId && !!note && decks.has(cardHomeDeck(c, note.deck)) && frankiCardReschedules(c);
  });
}

/**
 * How many cards rescheduling would move if this deck's preset changed its desired retention: the
 * review cards, not suspended and answered at least once, of every deck on the preset with no
 * retention of its own. What Save asks about, counted the way `savePreset` then moves them.
 */
export async function countRescheduled(store: NoteStore, deck: string, presetId: number): Promise<number> {
  if ((await presetIdOf(store, deck)) !== presetId) throw new PresetRefused(CHANGED);
  const { decks, anki } = await store.withSyncConnection(async (db) => ({
    decks: (await retentionDecks(db))(presetId).map((d) => d.name),
    anki: await countRetentionReschedule(db, presetId),
  }));
  return anki + (await frankiCardsIn(store, new Set(decks))).length;
}

const CHANGED = "This deck's Anki options changed while you were editing them, e.g. in a sync. Open them again to see the current ones.";

/**
 * Sets a deck's preset options: in the kept Anki collection, so sync carries them to every
 * device, and in Franki's copy of each deck using the preset (a deck's own limits and retention
 * still winning, as `buildExport` reads them), so the next session and the deck list follow at
 * once. `presetId` is the preset the screen showed: a deck moved to another preset since (a sync)
 * is refused rather than changing a preset the learner didn't see.
 *
 * A new desired retention reaches the preset's cards as Anki's deck options write it
 * (`applyRetentionChange`, in the same transaction): each studied card takes the new retention,
 * and with `reschedule` every review card is given a new due date for it, Franki's own cards too
 * (`rescheduleFrankiCard`). `refresh` then reads Franki's decks from the kept collection again
 * (`refreshFromKeptCollection`), so the cards it changed show their new dates.
 */
export async function savePreset(
  store: NoteStore, deck: string, presetId: number, options: PresetOptions,
  opts: { reschedule: boolean; refresh: () => Promise<void> }, now: Date = new Date(),
): Promise<{ rescheduled: number }> {
  if ((await presetIdOf(store, deck)) !== presetId) throw new PresetRefused(CHANGED);
  const cs = await store.collectionSettings();
  const H = cs.dayStartsAtHour;
  const today = ankiToday(now, H, cs.collectionCreated, cs.creationOffset);
  if (opts.reschedule && today === undefined) throw new PresetRefused("Franki doesn't know when your Anki collection was created. Sync once, then try again.");
  let reached: RetentionResult | undefined;
  const preset = await store.lockAnki(() => store.withSyncConnection(async (db) => {
    const saved = await setAnkiPresetOptions(db, presetId, options, now, async () => {
      reached = await applyRetentionChange(db, {
        presetId, retention: options.desiredRetention, reschedule: opts.reschedule,
        today: today ?? 0, nextDayStartSecs: Math.floor(nextStudyDayStart(now, H).getTime() / 1000),
      }, now);
    });
    return saved ? readAnkiPreset(db, presetId) : null;
  }));
  if (!preset) throw new PresetRefused(GONE);
  const params = await store.listDeckParams();
  const changed = new Map<string, DeckParams>();
  // Every deck of Franki's on the preset: the ones Anki lists, and any it leaves off (an empty Default deck).
  const own = new Map(preset.decks.map((d) => [d.name, d.own]));
  for (const [name, p] of params) {
    if (p.filtered || (p.presetId !== presetId && !own.has(name))) continue;
    const mine = own.get(name) ?? {};
    changed.set(name, {
      ...p,
      newPerDay: mine.newPerDay ?? options.newPerDay,
      reviewsPerDay: mine.reviewsPerDay ?? options.reviewsPerDay,
      desiredRetention: mine.desiredRetention ?? options.desiredRetention,
      learnSteps: options.learnSteps,
      relearnSteps: options.relearnSteps,
      maxInterval: options.maxInterval,
    });
  }
  await store.saveDeckParams(changed);
  if (!reached) return { rescheduled: 0 };
  let franki = 0;
  if (opts.reschedule) {
    const weights = paramsForDeck(deck, params)?.weights ?? [];
    for (const card of await frankiCardsIn(store, new Set(reached.decks))) {
      const moved = rescheduleFrankiCard(card, { desiredRetention: options.desiredRetention, weights, maxInterval: options.maxInterval, now, dayStartsAtHour: H });
      if (moved) { await store.saveCard(moved); franki++; }
    }
  }
  if (reached.changed > 0) await opts.refresh();
  return { rescheduled: reached.rescheduled + franki };
}

/**
 * Sets a deck's own daily new card limit, as the daily goal does: in the kept collection, so sync
 * carries it and Anki on every device studies the deck with it, then in Franki's copy of that deck
 * alone, so the deck list and the next session follow at once. The deck's preset, and the other
 * decks on it, keep theirs.
 */
export async function saveDeckNewLimit(store: NoteStore, deck: string, limit: number | null, now: Date = new Date()): Promise<void> {
  if (!(await store.keptCollection())) throw new PresetRefused(NO_COLLECTION);
  const p = (await store.listDeckParams()).get(deck);
  // null takes the deck's own limit off: it studies with its preset's again, read from the collection.
  const done = await store.lockAnki(() => store.withSyncConnection(async (db) => {
    if (!(await setAnkiDeckNewLimit(db, deck, limit, now))) return false;
    if (limit !== null) return { newPerDay: limit };
    return { newPerDay: p?.presetId === undefined ? undefined : (await readAnkiPreset(db, p.presetId))?.options.newPerDay };
  }));
  if (!done) throw new PresetRefused(`Anki doesn't have a deck called ${deck} yet. Sync with your Anki server, then try again.`);
  if (p && done.newPerDay !== undefined && p.newPerDay !== done.newPerDay) await store.saveDeckParams(new Map([[deck, { ...p, newPerDay: done.newPerDay }]]));
}

/** A deck's own daily new card limit in the collection, as the goal finds it before its first tuning: null for none of its own. */
export async function deckNewLimitOf(store: NoteStore, deck: string): Promise<number | null> {
  if (!(await store.keptCollection())) return null;
  return (await store.withSyncConnection((db) => readAnkiDeckNewLimit(db, deck))) ?? null;
}
