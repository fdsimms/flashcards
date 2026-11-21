import { Paths } from 'expo-file-system';
import { readJsonSafely, writeJsonSafely } from '../media/safeJson';
import { drawUnseen, mergeSeen, parseSeen, recordSeen, seenList, type DrillSeen } from './drillSeen';

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
