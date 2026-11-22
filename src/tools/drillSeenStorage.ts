import { Paths } from 'expo-file-system';
import { readJsonSafely, writeJsonSafely } from '../media/safeJson';
import { drawUnseen, forgetSeen, mergeSeen, missedList, parseSeen, recordSeen, seenList, type DrillSeen } from './drillSeen';

/**
 * The questions skill drills have asked lately (drillSeen.ts), kept in the documents folder: read
 * once, then held here, and each question asked is written straight back. A failed read or save
 * only means a step's questions come round from the start again.
 */

const FILE = 'drill-seen.json';

let seen: DrillSeen = {};
let loaded: Promise<void> | undefined;

/** Reads the file, once. Questions recorded before it finishes are kept on top of what it holds. */
export function loadDrillSeen(): Promise<void> {
  loaded ??= readJsonSafely(Paths.document, FILE).then(
    (raw) => { seen = mergeSeen(parseSeen(raw), seen); },
    () => undefined,
  );
  return loaded;
}

/** The keys a step has asked lately, least recent first: empty until the file has been read. */
export const drillSeenFor = (language: string, stepId: string): readonly string[] => seen[seenList(language, stepId)] ?? [];

/** A question was asked: it's remembered now, and saved. */
export function noteDrillAsked(language: string, stepId: string, key: string): void {
  seen = recordSeen(seen, seenList(language, stepId), key);
  save();
}

/** The months (1 to 12) a dates step missed lately and hasn't had right since, oldest miss first. */
export const drillMissedMonths = (language: string, stepId: string): number[] =>
  (seen[missedList(language, stepId)] ?? []).map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);

/** A dates question was marked: a miss puts its month on the step's missed list, a right answer takes it off. */
export function noteDrillMonth(language: string, stepId: string, month: number, right: boolean): void {
  const list = missedList(language, stepId);
  seen = right ? forgetSeen(seen, list, String(month)) : recordSeen(seen, list, String(month));
  save();
}

function save(): void {
  void loadDrillSeen().then(() => {
    try { writeJsonSafely(Paths.document, FILE, seen); } catch { /* Still held for this run. */ }
  });
}

/**
 * A question from `draw` that the tool or drill hasn't asked lately, remembered as asked: for the
 * draws that don't go through a tool's `pick` (useMarks.ts), such as the first question on opening.
 */
export function drawFromBag<T>(language: string, list: string, draw: () => T, keyOf: (q: T) => string): T {
  const picked = drawUnseen(draw, keyOf, drillSeenFor(language, list));
  noteDrillAsked(language, list, keyOf(picked));
  return picked;
}

// Read at launch, so the first question of a tool or drill already knows what was asked lately.
void loadDrillSeen();
