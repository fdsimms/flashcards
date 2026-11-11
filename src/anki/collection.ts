import type { NoteType } from '../core/types';
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
const CONFIG = { fsrsParams4: 3, fsrsParams5: 5, fsrsParams6: 6, newPerDay: 9, reviewsPerDay: 10, maxInterval: 16, desiredRetention: 37 };
/** Notetype.Config and Notetype.Template.Config */
const NOTETYPE = { kind: 1, css: 3 };
const TEMPLATE = { front: 1, back: 2 };
/** Deck.KindContainer and Deck.Normal */
const KIND_NORMAL = 1;
const NORMAL = { configId: 1, reviewLimit: 6, newLimit: 7, desiredRetention: 10 };

/** Run on a scratch copy, with `PRAGMA writable_schema = ON`, before reading the collated tables. */
export const STRIP_UNICASE_SQL = "UPDATE sqlite_master SET sql = replace(sql, ' COLLATE unicase', '') WHERE sql LIKE '%COLLATE unicase%'";

/** What `buildExport` needs, by name, so both platforms read exactly the same columns. */
export const COLLECTION_QUERIES = {
  col: 'SELECT crt FROM col',
  notetypes: 'SELECT id, name, config FROM notetypes',
  fields: 'SELECT ntid, ord, name FROM fields',
  templates: 'SELECT ntid, ord, name, config FROM templates',
  notes: 'SELECT id, mid, tags, flds FROM notes',
  cards: 'SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odid, odue, data FROM cards',
  decks: 'SELECT id, name, kind FROM decks',
  deckConfigs: 'SELECT id, config FROM deck_config',
  lastReviews: 'SELECT cid, MAX(id) AS last FROM revlog GROUP BY cid',
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
  }[];
  decks: { id: Num; name: string; kind: Uint8Array }[];
  deckConfigs: { id: Num; config: Uint8Array }[];
  lastReviews: { cid: Num; last: Num }[];
}

/** float32 noise off: 0.85 is stored as 0.8500000238. */
const round = (x: number | undefined, places: number) => (x === undefined ? undefined : Number(x.toFixed(places)));

export function readDeckConfig(blob: Uint8Array): Required<Omit<AnkiDeckConfig, 'desiredRetention' | 'maxInterval'>> & AnkiDeckConfig {
  const msg = decodeMessage(blob);
  // The newest parameter set the preset has: FSRS-6, else 5, else 4. ts-fsrs migrates older ones.
  const weights = [CONFIG.fsrsParams6, CONFIG.fsrsParams5, CONFIG.fsrsParams4].map((f) => floats(msg, f)).find((w) => w.length > 0) ?? [];
  return {
    newPerDay: uint(msg, CONFIG.newPerDay) ?? 0,
    reviewsPerDay: uint(msg, CONFIG.reviewsPerDay) ?? 0,
    desiredRetention: round(float(msg, CONFIG.desiredRetention), 4),
    weights: weights.map((w) => round(w, 6)!),
    maxInterval: uint(msg, CONFIG.maxInterval),
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
export function buildExport(rows: CollectionRows): AnkiExport & { collectionCreated: number; deckConfigs: Record<string, AnkiDeckConfig>; noteTypes: NoteType[] } {
  const modelName = new Map(rows.notetypes.map((m) => [Number(m.id), m.name]));
  const fieldNames = new Map<number, string[]>();
  for (const f of [...rows.fields].sort((a, b) => Number(a.ord) - Number(b.ord))) {
    const ntid = Number(f.ntid);
    if (!fieldNames.has(ntid)) fieldNames.set(ntid, []);
    fieldNames.get(ntid)![Number(f.ord)] = f.name;
  }
  const presets = new Map(rows.deckConfigs.map((c) => [Number(c.id), readDeckConfig(c.config)]));
  const decks = new Map(rows.decks.map((d) => [Number(d.id), { name: deckName(d.name), kind: readDeckKind(d.kind) }]));
  const lastReviewMs = new Map(rows.lastReviews.map((r) => [Number(r.cid), Number(r.last)]));

  const deckConfigs: Record<string, AnkiDeckConfig> = {};
  for (const { name, kind } of decks.values()) {
    if (!kind) continue;
    const preset = presets.get(kind.configId) ?? presets.get(1);
    if (!preset) continue;
    deckConfigs[name] = {
      ...preset,
      // A deck's own limits and retention, set in Anki's deck options, win over its preset's.
      newPerDay: kind.newLimit ?? preset.newPerDay,
      reviewsPerDay: kind.reviewLimit ?? preset.reviewsPerDay,
      desiredRetention: kind.desiredRetention ?? preset.desiredRetention,
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
      ord: Number(c.ord),
      type: Number(c.type),
      // Buried (-2, -3) is a today-only state; read it as the card's ordinary queue.
      queue: Number(c.queue) < -1 ? Number(c.type) : Number(c.queue),
      due: Number(inFiltered && Number(c.odue) !== 0 ? c.odue : c.due),
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

  return { collectionCreated: Number(rows.col.crt), notes, cards, deckConfigs, noteTypes };
}
