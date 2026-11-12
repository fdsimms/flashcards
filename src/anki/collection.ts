import { DEFAULT_COLLECTION_SETTINGS as COLLECTION_DEFAULTS } from '../core/config';
import type { CollectionSettings, NoteType } from '../core/types';
import type { AnkiDeckConfig, AnkiExport } from '../import/ankiJson';
import { decodeMessage, float, floats, message, string, uint } from './protobuf';

/**
 * Reads an Anki collection (SQLite, schema 18) into the shape the importer takes (`AnkiExport`).
 * Pure functions over rows and blobs: the phone runs `COLLECTION_QUERIES` with expo-sqlite, the
 * tests with Node's SQLite on a collection Anki itself wrote (tests/fixtures/anki/).
 *
 * Where the formats come from, so a change in Anki can be checked against its source:
 * - Tables and columns: rslib/src/storage/ in ankitects/anki. Notes keep fields in `flds`
 *   separated by \x1f; deck names separate levels with \x1f where the UI shows "::".
 * - `cards.data` is JSON (rslib CardData): `s` stability, `d` difficulty, `lrt` last review
 *   (unix seconds).
 * - Blobs are protobuf: `decks.kind` is Deck.KindContainer, `deck_config.config` is
 *   DeckConfig.Config, `notetypes.config` Notetype.Config, `templates.config`
 *   Notetype.Template.Config (proto/anki/decks.proto, deck_config.proto, notetypes.proto). Only
 *   the field numbers below are read.
 *
 * Three tables (fields, templates, notetypes) declare Anki's own `unicase` collation, which
 * neither the phone's SQLite nor Node's can register, and SQLite refuses to read them without it.
 * So they are read from a scratch copy whose schema has the collation removed
 * (`STRIP_UNICASE_SQL`); the collection Franki keeps is never changed that way.
 */

/** DeckConfig.Config */
const CONFIG = {
  learnSteps: 1, relearnSteps: 2, fsrsParams4: 3, easyDays: 4, fsrsParams5: 5, fsrsParams6: 6, newPerDay: 9, reviewsPerDay: 10,
  maxInterval: 16, leechAction: 21, leechThreshold: 22, buryNew: 27, buryReviews: 28, buryInterdayLearning: 29,
  newMix: 30, interdayLearningMix: 31, newSortOrder: 32, reviewOrder: 33, newGatherPriority: 34, desiredRetention: 37,
};
/** Notetype.Config and Notetype.Template.Config */
const NOTETYPE = { kind: 1, css: 3 };
const TEMPLATE = { front: 1, back: 2 };
/** Deck.KindContainer and Deck.Normal */
const KIND_NORMAL = 1;
const KIND_FILTERED = 2;
const NORMAL = { configId: 1, reviewLimit: 6, newLimit: 7, reviewLimitToday: 8, newLimitToday: 9, desiredRetention: 10 };
/** Deck.Normal.DayLimit */
const DAY_LIMIT = { limit: 1, today: 2 };
/** Deck.Filtered */
const FILTERED = { reschedule: 1, previewHardSecs: 5, previewGoodSecs: 6, previewAgainSecs: 7 };

/** Run on a scratch copy, with `PRAGMA writable_schema = ON`, before reading the collated tables. */
export const STRIP_UNICASE_SQL = "UPDATE sqlite_master SET sql = replace(sql, ' COLLATE unicase', '') WHERE sql LIKE '%COLLATE unicase%'";

/** What `buildExport` needs, by name, so both platforms read exactly the same columns. */
export const COLLECTION_QUERIES = {
  col: 'SELECT crt FROM col',
  notetypes: 'SELECT id, name, config FROM notetypes',
  fields: 'SELECT ntid, ord, name FROM fields',
  templates: 'SELECT ntid, ord, name, config FROM templates',
  notes: 'SELECT id, mid, tags, flds FROM notes',
  cards: 'SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left, odid, odue, data, mod, flags FROM cards',
  decks: 'SELECT id, name, kind FROM decks',
  deckConfigs: 'SELECT id, config FROM deck_config',
  lastReviews: 'SELECT cid, MAX(id) AS last FROM revlog GROUP BY cid',
  config: "SELECT key, val FROM config WHERE key IN ('rollover', 'collapseTime', 'newCardsIgnoreReviewLimit', 'applyAllParentLimits', 'creationOffset', 'loadBalancerEnabled')",
} as const;

type Num = number | bigint;
export interface CollectionRows {
  col: { crt: Num };
  notetypes: { id: Num; name: string; config?: Uint8Array }[];
  fields: { ntid: Num; ord: Num; name: string }[];
  templates?: { ntid: Num; ord: Num; name: string; config: Uint8Array }[];
  notes: { id: Num; mid: Num; tags: string; flds: string }[];
  cards: {
    id: Num; nid: Num; did: Num; ord: Num; type: Num; queue: Num; due: Num; ivl: Num;
    factor: Num; reps: Num; lapses: Num; odid: Num; odue: Num; data: string | null;
    /** When the card last changed (unix seconds): for a buried card, when it was buried. */
    mod?: Num;
    /** Learning steps left (`left % 1000`). */
    left?: Num;
    /** The card's flag in its low 3 bits (0 none, 1 red ... 7 purple). */
    flags?: Num;
  }[];
  decks: { id: Num; name: string; kind: Uint8Array }[];
  deckConfigs: { id: Num; config: Uint8Array }[];
  lastReviews: { cid: Num; last: Num }[];
  /** Collection config values (JSON), for `collectionSettings`. Missing reads as Anki's defaults. */
  config?: { key: string; val: Uint8Array | string }[];
}

/** float32 noise off: 0.85 is stored as 0.8500000238. */
const round = (x: number | undefined, places: number) => (x === undefined ? undefined : Number(x.toFixed(places)));

export function readDeckConfig(blob: Uint8Array): Required<Omit<AnkiDeckConfig, 'desiredRetention' | 'maxInterval' | 'newLimitToday' | 'reviewLimitToday' | 'filtered' | 'presetId'>> & AnkiDeckConfig {
  const msg = decodeMessage(blob);
  // The newest parameter set the preset has: FSRS-6, else 5, else 4. ts-fsrs migrates older ones.
  const weights = [CONFIG.fsrsParams6, CONFIG.fsrsParams5, CONFIG.fsrsParams4].map((f) => floats(msg, f)).find((w) => w.length > 0) ?? [];
  return {
    newPerDay: uint(msg, CONFIG.newPerDay) ?? 0,
    reviewsPerDay: uint(msg, CONFIG.reviewsPerDay) ?? 0,
    desiredRetention: round(float(msg, CONFIG.desiredRetention), 4),
    weights: weights.map((w) => round(w, 6)!),
    maxInterval: uint(msg, CONFIG.maxInterval),
    // bools and enums, which proto3 leaves out when false or 0
    buryNew: uint(msg, CONFIG.buryNew) === 1,
    buryReviews: uint(msg, CONFIG.buryReviews) === 1,
    buryInterdayLearning: uint(msg, CONFIG.buryInterdayLearning) === 1,
    learnSteps: floats(msg, CONFIG.learnSteps).map((m) => round(m, 4)!),
    relearnSteps: floats(msg, CONFIG.relearnSteps).map((m) => round(m, 4)!),
    leechAction: uint(msg, CONFIG.leechAction) ?? 0,
    leechThreshold: uint(msg, CONFIG.leechThreshold) ?? 0,
    newMix: uint(msg, CONFIG.newMix) ?? 0,
    interdayLearningMix: uint(msg, CONFIG.interdayLearningMix) ?? 0,
    newSortOrder: uint(msg, CONFIG.newSortOrder) ?? 0,
    reviewOrder: uint(msg, CONFIG.reviewOrder) ?? 0,
    newGatherPriority: uint(msg, CONFIG.newGatherPriority) ?? 0,
    easyDays: floats(msg, CONFIG.easyDays),
  };
}

/** A deck's preset id and its own overrides. Undefined for a filtered deck, which has no preset. */
export function readDeckKind(blob: Uint8Array) {
  const normal = message(decodeMessage(blob), KIND_NORMAL);
  if (!normal) return undefined;
  return {
    configId: uint(normal, NORMAL.configId) ?? 1,
    newLimit: uint(normal, NORMAL.newLimit),
    reviewLimit: uint(normal, NORMAL.reviewLimit),
    desiredRetention: round(float(normal, NORMAL.desiredRetention), 4),
    newLimitToday: dayLimit(message(normal, NORMAL.newLimitToday)),
    reviewLimitToday: dayLimit(message(normal, NORMAL.reviewLimitToday)),
  };
}

/** A today-only limit: the limit, and the Anki day number (days since the collection's creation) it's for. */
function dayLimit(msg: ReturnType<typeof message>) {
  return msg ? { limit: uint(msg, DAY_LIMIT.limit) ?? 0, today: uint(msg, DAY_LIMIT.today) ?? 0 } : undefined;
}

/** A filtered deck's settings. Undefined for a normal deck. */
export function readFilteredDeck(blob: Uint8Array): { reschedule: boolean; previewSecs: { again: number; hard: number; good: number } } | undefined {
  const filtered = message(decodeMessage(blob), KIND_FILTERED);
  if (!filtered) return undefined;
  return {
    reschedule: uint(filtered, FILTERED.reschedule) === 1,
    previewSecs: {
      again: uint(filtered, FILTERED.previewAgainSecs) ?? 0,
      hard: uint(filtered, FILTERED.previewHardSecs) ?? 0,
      good: uint(filtered, FILTERED.previewGoodSecs) ?? 0,
    },
  };
}

/** The collection-wide settings Franki schedules by, from the collection's config rows. */
export function collectionSettings(config: CollectionRows['config'], collectionCreated?: number): CollectionSettings {
  const values = new Map<string, unknown>();
  for (const row of config ?? []) {
    const text = typeof row.val === 'string' ? row.val : String.fromCharCode(...row.val);
    try { values.set(row.key, JSON.parse(text)); } catch { /* not JSON: keep the default */ }
  }
  const num = (key: string) => (typeof values.get(key) === 'number' ? (values.get(key) as number) : undefined);
  const bool = (key: string) => (typeof values.get(key) === 'boolean' ? (values.get(key) as boolean) : undefined);
  return {
    dayStartsAtHour: num('rollover') ?? COLLECTION_DEFAULTS.dayStartsAtHour,
    // Anki keeps the learn-ahead limit in seconds.
    learnAheadMinutes: num('collapseTime') !== undefined ? num('collapseTime')! / 60 : COLLECTION_DEFAULTS.learnAheadMinutes,
    newCardsIgnoreReviewLimit: bool('newCardsIgnoreReviewLimit') ?? COLLECTION_DEFAULTS.newCardsIgnoreReviewLimit,
    applyAllParentLimits: bool('applyAllParentLimits') ?? COLLECTION_DEFAULTS.applyAllParentLimits,
    ...(collectionCreated !== undefined ? { collectionCreated } : {}),
    ...(num('creationOffset') !== undefined ? { creationOffset: num('creationOffset') } : {}),
    loadBalancer: bool('loadBalancerEnabled') ?? true,
  };
}

export function readNotetypeConfig(blob: Uint8Array): { kind: 'normal' | 'cloze'; css: string } {
  const msg = decodeMessage(blob);
  return { kind: uint(msg, NOTETYPE.kind) === 1 ? 'cloze' : 'normal', css: string(msg, NOTETYPE.css) ?? '' };
}

export function readTemplateConfig(blob: Uint8Array): { front: string; back: string } {
  const msg = decodeMessage(blob);
  return { front: string(msg, TEMPLATE.front) ?? '', back: string(msg, TEMPLATE.back) ?? '' };
}

const deckName = (raw: string) => raw.split('\x1f').join('::');

/** The importer's input from a collection's rows. */
export function buildExport(rows: CollectionRows): AnkiExport & {
  collectionCreated: number; deckConfigs: Record<string, AnkiDeckConfig>; noteTypes: NoteType[]; collectionSettings: CollectionSettings;
} {
  const modelName = new Map(rows.notetypes.map((m) => [Number(m.id), m.name]));
  const fieldNames = new Map<number, string[]>();
  for (const f of [...rows.fields].sort((a, b) => Number(a.ord) - Number(b.ord))) {
    const ntid = Number(f.ntid);
    if (!fieldNames.has(ntid)) fieldNames.set(ntid, []);
    fieldNames.get(ntid)![Number(f.ord)] = f.name;
  }
  const presets = new Map(rows.deckConfigs.map((c) => [Number(c.id), readDeckConfig(c.config)]));
  const decks = new Map(rows.decks.map((d) => [Number(d.id), { name: deckName(d.name), kind: readDeckKind(d.kind), filtered: readFilteredDeck(d.kind) }]));
  const lastReviewMs = new Map(rows.lastReviews.map((r) => [Number(r.cid), Number(r.last)]));

  const deckConfigs: Record<string, AnkiDeckConfig> = {};
  for (const { name, kind, filtered } of decks.values()) {
    if (filtered) deckConfigs[name] = { filtered };
    if (!kind) continue;
    const preset = presets.get(kind.configId) ?? presets.get(1);
    if (!preset) continue;
    deckConfigs[name] = {
      ...preset,
      // A deck's own limits and retention, set in Anki's deck options, win over its preset's.
      newPerDay: kind.newLimit ?? preset.newPerDay,
      reviewsPerDay: kind.reviewLimit ?? preset.reviewsPerDay,
      desiredRetention: kind.desiredRetention ?? preset.desiredRetention,
      presetId: presets.has(kind.configId) ? kind.configId : 1,
      newLimitToday: kind.newLimitToday,
      reviewLimitToday: kind.reviewLimitToday,
    };
  }

  const notes = rows.notes.map((n) => {
    const names = fieldNames.get(Number(n.mid)) ?? [];
    const fields: Record<string, string> = {};
    String(n.flds).split('\x1f').forEach((v, i) => { fields[names[i] ?? `Field ${i + 1}`] = v; });
    return {
      noteId: String(n.id),
      modelName: modelName.get(Number(n.mid)) ?? 'Unknown',
      tags: String(n.tags).trim().split(/\s+/).filter(Boolean),
      fields,
    };
  });

  const cards = rows.cards.map((c) => {
    // A card borrowed into a filtered deck keeps its home deck and real due in odid / odue.
    const inFiltered = Number(c.odid) !== 0;
    const did = inFiltered ? Number(c.odid) : Number(c.did);
    let data: { s?: unknown; d?: unknown; lrt?: unknown } = {};
    try { data = c.data ? JSON.parse(c.data) : {}; } catch { /* old or custom data: no memory state */ }
    const fromRevlog = lastReviewMs.get(Number(c.id));
    return {
      cardId: String(c.id),
      note: String(c.nid),
      deckName: decks.get(did)?.name ?? 'Default',
      filteredDeckName: inFiltered ? decks.get(Number(c.did))?.name : undefined,
      filteredDue: inFiltered ? Number(c.due) : undefined,
      previewDue: Number(c.queue) === 4 ? Number(c.due) : undefined,
      mod: c.mod !== undefined ? Number(c.mod) : undefined,
      flag: c.flags !== undefined ? Number(c.flags) & 7 : undefined,
      ord: Number(c.ord),
      type: Number(c.type),
      // Buried (-2, -3) is a today-only state: read it as the card's ordinary queue, and keep
      // when it was buried so the queue can hold it back until the next study day (isBuried).
      queue: Number(c.queue) < -1 ? Number(c.type) : Number(c.queue),
      buriedAt: Number(c.queue) < -1 && c.mod !== undefined ? Number(c.mod) : undefined,
      due: Number(inFiltered && Number(c.odue) !== 0 ? c.odue : c.due),
      // A new card's due is its position in the new-card order (odue while it's in a filtered deck).
      position: Number(c.type) === 0 ? Number(inFiltered && Number(c.odue) !== 0 ? c.odue : c.due) : undefined,
      stepsLeft: c.left !== undefined && (Number(c.type) === 1 || Number(c.type) === 3) ? Number(c.left) % 1000 : undefined,
      interval: Number(c.ivl),
      factor: Number(c.factor),
      reps: Number(c.reps),
      lapses: Number(c.lapses),
      memoryState: typeof data.s === 'number' && typeof data.d === 'number' ? { stability: data.s, difficulty: data.d } : undefined,
      lastReview: typeof data.lrt === 'number' ? data.lrt : fromRevlog !== undefined ? Math.floor(fromRevlog / 1000) : undefined,
    };
  });

  // Note types in use, with their templates and CSS, so the app renders their cards as Anki does.
  const used = new Set(rows.notes.map((n) => Number(n.mid)));
  const noteTypes: NoteType[] = [];
  for (const m of rows.notetypes) {
    const id = Number(m.id);
    if (!used.has(id) || !m.config) continue;
    const { kind, css } = readNotetypeConfig(m.config);
    const templates = (rows.templates ?? [])
      .filter((t) => Number(t.ntid) === id)
      .sort((a, b) => Number(a.ord) - Number(b.ord))
      .map((t) => ({ ord: Number(t.ord), name: t.name, ...readTemplateConfig(t.config) }));
    noteTypes.push({ name: m.name, kind, css, fields: (fieldNames.get(id) ?? []).filter(Boolean), templates });
  }

  return { collectionCreated: Number(rows.col.crt), notes, cards, deckConfigs, noteTypes, collectionSettings: collectionSettings(rows.config, Number(rows.col.crt)) };
}
