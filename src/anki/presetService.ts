import { studyDayKey } from '../core/day';
import { Refusal } from '../core/failure';
import { newCardOrderOf } from '../core/newCardOrder';
import type { DeckOwnValues, PresetOptions } from '../core/presetOptions';
import type { DeckParams } from '../core/types';
import { NO_COLLECTION, type NoteStore } from './noteService';
import { readAnkiPreset, setAnkiPresetOptions, type AnkiPreset } from './presetWrites';

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

/**
 * Sets a deck's preset options: in the kept Anki collection, so sync carries them to every
 * device, and in Franki's copy of each deck using the preset (a deck's own limits and retention
 * still winning, as `buildExport` reads them), so the next session and the deck list follow at
 * once. `presetId` is the preset the screen showed: a deck moved to another preset since (a sync)
 * is refused rather than changing a preset the learner didn't see.
 */
export async function savePreset(store: NoteStore, deck: string, presetId: number, options: PresetOptions, now: Date = new Date()): Promise<void> {
  if ((await presetIdOf(store, deck)) !== presetId) throw new PresetRefused("This deck's Anki options changed while you were editing them, e.g. in a sync. Open them again to see the current ones.");
  const preset = await store.lockAnki(() => store.withSyncConnection(async (db) => (await setAnkiPresetOptions(db, presetId, options, now)) ? readAnkiPreset(db, presetId) : null));
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
}
