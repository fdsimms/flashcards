import { Paths } from 'expo-file-system';
import { readJsonSafely, writeJsonSafely } from '../media/safeJson';
import { mergeRounds, parseRounds, roundOf, withCarry, withRound, type CardRound, type CardRounds } from './drillRound';
import type { DrillQuestion } from './skills';

/**
 * Each skill card's questions for the study day (drillRound.ts), kept in the documents folder: read
 * once, then held here, and every change is written straight back. A failed read or save only means a
 * card draws a fresh round, as it did before rounds were kept.
 */

const FILE = 'drill-rounds.json';

let rounds: CardRounds = {};
let loaded: Promise<void> | undefined;

/** Reads the file, once. Rounds made before it finishes are kept on top of what it holds. */
export function loadDrillRounds(): Promise<void> {
  loaded ??= readJsonSafely(Paths.document, FILE).then(
    (raw) => { rounds = mergeRounds(parseRounds(raw), rounds); },
    () => undefined,
  );
  return loaded;
}

function save(): void {
  void loadDrillRounds().then(() => {
    try { writeJsonSafely(Paths.document, FILE, rounds); } catch { /* Still held for this run. */ }
  });
}

/** The card's record for the day and step, if it has one. Empty until the file has been read. */
export const drillRoundFor = (cardId: string, day: string, stepId: string): CardRound | undefined => roundOf(rounds, cardId, day, stepId);

/** A round was drawn for the card: it's kept for the day, and saved. */
export function keepDrillRound(cardId: string, day: string, stepId: string, round: DrillQuestion[]): void {
  rounds = withRound(rounds, cardId, day, stepId, round);
  save();
}

/** The card's carried misses were set (or cleared): kept, and saved. */
export function keepDrillCarry(cardId: string, carry: DrillQuestion[]): void {
  const next = withCarry(rounds, cardId, carry);
  if (next === rounds) return; // not a skill card with a round today: nothing to keep
  rounds = next;
  save();
}

/** The card's carried misses as they are now, to put back on an undo. */
export const drillCarryOf = (cardId: string): DrillQuestion[] => rounds[cardId]?.carry ?? [];

// Read at launch, so the first card of the day already knows the round it was given.
void loadDrillRounds();
