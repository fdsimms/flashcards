import { MessageWriter, utf8Encode } from '../protobuf';
import { stringifyJson } from './json';

/**
 * Deck options as sync sends them (Anki's older JSON form, `DeckConfSchema11`) turned into the
 * row Anki keeps (`deck_config`, its `DeckConfig.Config` protobuf), as
 * `From<DeckConfSchema11> for DeckConfig` in rslib/src/deckconfig/schema11.rs does. Field
 * numbers from proto/anki/deck_config.proto; written in field order, defaults left out, as prost.
 */

export interface DeckConfigJson {
  id: number | string;
  name: string;
  mod?: number | string;
  usn: number;
  [key: string]: unknown;
}

export interface DeckConfigRow {
  id: number;
  name: string;
  mtime: number;
  usn: number;
  config: Uint8Array;
}

const F = {
  learnSteps: 1, relearnSteps: 2, fsrs4: 3, easyDays: 4, fsrs5: 5, fsrs6: 6, newPerDay: 9, reviewsPerDay: 10,
  initialEase: 11, easyMult: 12, hardMult: 13, lapseMult: 14, ivlMult: 15, maxIvl: 16, minLapseIvl: 17,
  gradGood: 18, gradEasy: 19, insertOrder: 20, leechAction: 21, leechThreshold: 22, disableAutoplay: 23,
  capAnswer: 24, showTimer: 25, skipQuestion: 26, buryNew: 27, buryReviews: 28, buryInterday: 29, newMix: 30,
  interdayMix: 31, sortOrder: 32, reviewOrder: 33, gatherPriority: 34, newPerDayMin: 35, questionAction: 36,
  desiredRetention: 37, stopTimer: 38, historicalRetention: 40, secsQuestion: 41, secsAnswer: 42,
  answerAction: 43, waitForAudio: 44, paramSearch: 45, ignoreBefore: 46, other: 255,
};

/** The JSON keys each schema-11 struct reads; any others are kept in `other`, as Anki keeps them. */
const TOP_KEYS = new Set([
  'id', 'mod', 'name', 'usn', 'maxTaken', 'autoplay', 'timer', 'replayq', 'new', 'rev', 'lapse', 'dyn', 'newMix',
  'newPerDayMinimum', 'interdayLearningMix', 'reviewOrder', 'newSortOrder', 'newGatherPriority',
  'buryInterdayLearning', 'fsrsWeights', 'fsrsParams5', 'fsrsParams6', 'desiredRetention',
  'ignoreRevlogsBeforeDate', 'easyDaysPercentages', 'stopTimerOnAnswer', 'secondsToShowQuestion',
  'secondsToShowAnswer', 'questionAction', 'answerAction', 'waitForAudio', 'sm2Retention', 'weightSearch',
]);
const NEW_KEYS = new Set(['bury', 'delays', 'initialFactor', 'ints', 'order', 'perDay']);
const REV_KEYS = new Set(['bury', 'ease4', 'ivlFct', 'maxIvl', 'perDay', 'hardFactor']);
const LAPSE_KEYS = new Set(['delays', 'leechAction', 'leechFails', 'minInt', 'mult']);

const num = (v: unknown, dflt = 0): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
};
const bool = (v: unknown, dflt = false): boolean => (v === undefined || v === null ? dflt : v === true || v === 1 || v === '1' || v === 'true');
const floats = (v: unknown): number[] => (Array.isArray(v) && v.every((x) => typeof x === 'number') ? v as number[] : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const rest = (o: Record<string, unknown>, known: Set<string>) => Object.fromEntries(Object.entries(o).filter(([k]) => !known.has(k)));

function u(w: MessageWriter, f: number, v: number) { if (v) w.uint(f, v); }
function fl(w: MessageWriter, f: number, v: number) { if (v !== 0) w.float(f, v); }
function fls(w: MessageWriter, f: number, v: number[]) { if (v.length) w.packedFloats(f, v); }

export function deckConfigRow(c: DeckConfigJson): DeckConfigRow {
  const nw = obj(c.new);
  const rev = obj(c.rev);
  const lapse = obj(c.lapse);
  const ints = Array.isArray(nw.ints) && nw.ints.length >= 2 ? nw.ints.map((x) => num(x)) : [1, 4];
  const other: Record<string, unknown> = rest(c, TOP_KEYS);
  for (const [key, part, known] of [['new', nw, NEW_KEYS], ['rev', rev, REV_KEYS], ['lapse', lapse, LAPSE_KEYS]] as const) {
    const extra = rest(part, known);
    if (Object.keys(extra).length) other[key] = extra;
  }

  const w = new MessageWriter();
  fls(w, F.learnSteps, nw.delays === undefined ? [1, 10] : floats(nw.delays));
  fls(w, F.relearnSteps, lapse.delays === undefined ? [10] : floats(lapse.delays));
  fls(w, F.fsrs4, floats(c.fsrsWeights));
  fls(w, F.easyDays, floats(c.easyDaysPercentages));
  fls(w, F.fsrs5, floats(c.fsrsParams5));
  fls(w, F.fsrs6, floats(c.fsrsParams6));
  u(w, F.newPerDay, num(nw.perDay, 20));
  u(w, F.reviewsPerDay, num(rev.perDay, 200));
  fl(w, F.initialEase, Math.fround(num(nw.initialFactor, 2500)) / 1000);
  fl(w, F.easyMult, num(rev.ease4, 1.3));
  fl(w, F.hardMult, num(rev.hardFactor, 1.2));
  fl(w, F.lapseMult, num(lapse.mult));
  fl(w, F.ivlMult, num(rev.ivlFct, 1));
  u(w, F.maxIvl, num(rev.maxIvl, 36500));
  u(w, F.minLapseIvl, num(lapse.minInt, 1));
  u(w, F.gradGood, ints[0]);
  u(w, F.gradEasy, ints[1]);
  // Schema 11 has 0 random, 1 due; the protobuf has 0 due, 1 random.
  u(w, F.insertOrder, num(nw.order, 1) === 0 ? 1 : 0);
  u(w, F.leechAction, num(lapse.leechAction, 1));
  u(w, F.leechThreshold, num(lapse.leechFails, 8));
  if (!bool(c.autoplay, true)) w.uint(F.disableAutoplay, 1);
  u(w, F.capAnswer, Math.max(0, num(c.maxTaken, 60)));
  if (num(c.timer) !== 0) w.uint(F.showTimer, 1);
  if (!bool(c.replayq)) w.uint(F.skipQuestion, 1);
  if (bool(nw.bury)) w.uint(F.buryNew, 1);
  if (bool(rev.bury)) w.uint(F.buryReviews, 1);
  if (bool(c.buryInterdayLearning)) w.uint(F.buryInterday, 1);
  u(w, F.newMix, num(c.newMix));
  u(w, F.interdayMix, num(c.interdayLearningMix));
  u(w, F.sortOrder, num(c.newSortOrder));
  u(w, F.reviewOrder, num(c.reviewOrder));
  u(w, F.gatherPriority, num(c.newGatherPriority));
  u(w, F.newPerDayMin, num(c.newPerDayMinimum));
  u(w, F.questionAction, num(c.questionAction));
  fl(w, F.desiredRetention, num(c.desiredRetention));
  if (bool(c.stopTimerOnAnswer)) w.uint(F.stopTimer, 1);
  fl(w, F.historicalRetention, num(c.sm2Retention));
  fl(w, F.secsQuestion, num(c.secondsToShowQuestion));
  fl(w, F.secsAnswer, num(c.secondsToShowAnswer));
  u(w, F.answerAction, num(c.answerAction));
  if (bool(c.waitForAudio, true)) w.uint(F.waitForAudio, 1);
  if (typeof c.weightSearch === 'string' && c.weightSearch) w.string(F.paramSearch, c.weightSearch);
  if (typeof c.ignoreRevlogsBeforeDate === 'string' && c.ignoreRevlogsBeforeDate) w.string(F.ignoreBefore, c.ignoreRevlogsBeforeDate);
  if (Object.keys(other).length) w.bytes(F.other, utf8Encode(stringifyJson(other)));
  return { id: num(c.id), name: c.name, mtime: num(c.mod), usn: num(c.usn), config: w.finish() };
}
