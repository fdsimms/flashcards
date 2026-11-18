import { bytesField, decodeMessage, float, floats as readFloats, MessageWriter, string, uint, utf8Decode, utf8Encode } from '../protobuf';
import { parseJson, stringifyJson } from './json';

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

/** A float32 as the shortest decimal that reads back as it, which is how Anki's JSON writes one (0.85, not 0.8500000238). */
function f32Json(x: number | undefined): number {
  if (x === undefined) return 0;
  for (let digits = 1; digits <= 9; digits++) {
    const s = Number(x.toPrecision(digits));
    if (Math.fround(s) === x) return s;
  }
  return x;
}
const f32s = (xs: number[]) => xs.map(f32Json);

/**
 * The row Anki keeps turned back into the JSON sync sends (`DeckConfSchema11`), as
 * `From<DeckConfig> for DeckConfSchema11` in rslib/src/deckconfig/schema11.rs does: the inverse of
 * `deckConfigRow`, so a preset changed on this phone can be sent to the server. Keys only an add-on
 * knows come back from `other`. Checked against the presets Anki wrote (tests/anki/sync/deckConfigRow.test.ts).
 */
export function deckConfigJson(row: DeckConfigRow): DeckConfigJson {
  const m = decodeMessage(row.config);
  const flag = (f: number) => uint(m, f) === 1;
  const otherBytes = bytesField(m, F.other);
  const other: Record<string, unknown> = otherBytes ? obj(parseJson(utf8Decode(otherBytes))) : {};
  const { new: newOther, rev: revOther, lapse: lapseOther, ...topOther } = other;
  return {
    id: row.id,
    mod: row.mtime,
    name: row.name,
    usn: row.usn,
    maxTaken: uint(m, F.capAnswer) ?? 0,
    autoplay: !flag(F.disableAutoplay),
    timer: flag(F.showTimer) ? 1 : 0,
    replayq: !flag(F.skipQuestion),
    new: {
      bury: flag(F.buryNew),
      delays: f32s(readFloats(m, F.learnSteps)),
      initialFactor: Math.round(Math.fround(Math.fround(float(m, F.initialEase) ?? 0) * 1000)),
      ints: [uint(m, F.gradGood) ?? 0, uint(m, F.gradEasy) ?? 0, 0],
      order: (uint(m, F.insertOrder) ?? 0) === 1 ? 0 : 1,
      perDay: uint(m, F.newPerDay) ?? 0,
      ...obj(newOther),
    },
    rev: {
      bury: flag(F.buryReviews),
      ease4: f32Json(float(m, F.easyMult)),
      ivlFct: f32Json(float(m, F.ivlMult)),
      maxIvl: uint(m, F.maxIvl) ?? 0,
      perDay: uint(m, F.reviewsPerDay) ?? 0,
      hardFactor: f32Json(float(m, F.hardMult)),
      ...obj(revOther),
    },
    lapse: {
      delays: f32s(readFloats(m, F.relearnSteps)),
      leechAction: uint(m, F.leechAction) ?? 0,
      leechFails: uint(m, F.leechThreshold) ?? 0,
      minInt: uint(m, F.minLapseIvl) ?? 0,
      mult: f32Json(float(m, F.lapseMult)),
      ...obj(lapseOther),
    },
    dyn: false,
    newMix: uint(m, F.newMix) ?? 0,
    newPerDayMinimum: uint(m, F.newPerDayMin) ?? 0,
    interdayLearningMix: uint(m, F.interdayMix) ?? 0,
    reviewOrder: uint(m, F.reviewOrder) ?? 0,
    newSortOrder: uint(m, F.sortOrder) ?? 0,
    newGatherPriority: uint(m, F.gatherPriority) ?? 0,
    buryInterdayLearning: flag(F.buryInterday),
    fsrsWeights: f32s(readFloats(m, F.fsrs4)),
    fsrsParams5: f32s(readFloats(m, F.fsrs5)),
    fsrsParams6: f32s(readFloats(m, F.fsrs6)),
    desiredRetention: f32Json(float(m, F.desiredRetention)),
    ignoreRevlogsBeforeDate: string(m, F.ignoreBefore) ?? '',
    easyDaysPercentages: f32s(readFloats(m, F.easyDays)),
    stopTimerOnAnswer: flag(F.stopTimer),
    secondsToShowQuestion: f32Json(float(m, F.secsQuestion)),
    secondsToShowAnswer: f32Json(float(m, F.secsAnswer)),
    questionAction: uint(m, F.questionAction) ?? 0,
    answerAction: uint(m, F.answerAction) ?? 0,
    waitForAudio: flag(F.waitForAudio),
    sm2Retention: f32Json(float(m, F.historicalRetention)),
    weightSearch: string(m, F.paramSearch) ?? '',
    ...topOther,
  };
}
