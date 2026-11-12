import { NEW_PER_DAY, REVIEWS_PER_DAY } from '../core/config';
import { CUSTOM_STUDY_DECK, customStudyProblem, isLimitChange, raisedLimit, type CustomStudy } from '../core/customStudy';
import { nextStudyDayStart, studyDayKey } from '../core/day';
import { deckLimits, deckLineage } from '../core/deckTree';
import { ankiToday } from '../core/order';
import { paramsForDeck } from '../core/scheduler';
import type { DeckParams } from '../core/types';
import type { NoteStore } from './noteService';
import { buildCustomStudyDeck, CustomStudyRefused, setAnkiDayLimits } from './customStudyWrites';

/**
 * Running a custom study (src/core/customStudy.ts) for a deck: raising today's limits, in the kept
 * Anki collection when it has the deck (so sync carries it) and in Franki's own settings, or filling
 * "Custom Study Session" in the kept collection and reading it back into Franki.
 */

export type CustomStudyResult =
  | { kind: 'limits' }
  /** The deck now holding the cards, to study next. */
  | { kind: 'deck'; deck: string; moved: number };

/**
 * `refresh` reads Franki's decks from the kept collection again (`refreshFromKeptCollection`), so
 * the cards that moved show up in the session deck.
 */
export async function runCustomStudy(store: NoteStore, deck: string, study: CustomStudy, refresh: () => Promise<void>, now: Date = new Date()): Promise<CustomStudyResult> {
  const problem = customStudyProblem(study);
  if (problem) throw new CustomStudyRefused(problem);
  const cs = await store.collectionSettings();
  const H = cs.dayStartsAtHour;
  const keptCollection = await store.keptCollection();

  if (isLimitChange(study)) {
    const settings = await store.listDeckSettings();
    if (study.kind === 'moreNew' && deckLineage(deck).some((d) => settings.get(d)?.gateCap !== undefined)) {
      throw new CustomStudyRefused('This deck uses a progress gate instead of a daily new card limit. Change the gate in Deck options to let in more new cards.');
    }
    const todayKey = studyDayKey(now, H);
    const params = await store.listDeckParams();
    const current = deckLimits(paramsForDeck(deck, params), { newPerDay: NEW_PER_DAY, reviewsPerDay: REVIEWS_PER_DAY }, todayKey);
    const limit = raisedLimit(study.kind === 'moreNew' ? current.newPerDay : current.reviewsPerDay, study.count);
    if (keptCollection) {
      const day = ankiToday(now, H, cs.collectionCreated, cs.creationOffset);
      if (day === undefined) throw new CustomStudyRefused("Franki doesn't know when your Anki collection was created. Sync once, then try again.");
      await store.lockAnki(() => store.withSyncConnection((db) =>
        setAnkiDayLimits(db, deck, study.kind === 'moreNew' ? { newLimit: limit } : { reviewLimit: limit }, day, now)));
    }
    // Franki's copy, so the change shows without reading the whole collection again. A deck with no
    // settings of its own (one Anki doesn't have) starts from the ones it studies with.
    const base: DeckParams = params.get(deck) ?? paramsForDeck(deck, params) ?? { weights: [], desiredRetention: 0.9, maxInterval: 36500 };
    const today = { limit, day: todayKey };
    await store.saveDeckParams(new Map([[deck, { ...base, ...(study.kind === 'moreNew' ? { newLimitToday: today } : { reviewLimitToday: today }) }]]));
    return { kind: 'limits' };
  }

  if (!keptCollection) throw new CustomStudyRefused('This needs your Anki collection in Franki. Set up Anki first, from the Decks screen.');
  const day = ankiToday(now, H, cs.collectionCreated, cs.creationOffset);
  if (day === undefined) throw new CustomStudyRefused("Franki doesn't know when your Anki collection was created. Sync once, then try again.");
  const built = await store.lockAnki(() => store.withSyncConnection((db) => buildCustomStudyDeck(db, {
    deck, sessionDeck: CUSTOM_STUDY_DECK, study, now, ctx: { today: day, dayEndSecs: Math.floor(nextStudyDayStart(now, H).getTime() / 1000) },
  })));
  await store.lockAnki(refresh);
  return { kind: 'deck', deck: built.deck, moved: built.moved };
}
