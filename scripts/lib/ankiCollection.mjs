// Reads an Anki collection (collection.anki2, schema 18) into the JSON the app imports
// (`AnkiExport` in src/import/ankiJson.ts). `exportCollection` reads a file; everything under it
// is pure functions over rows and blobs. tests/scripts/ankiCollection.test.ts runs it on a real
// collection Anki wrote (tests/fixtures/anki/).
//
// Where the formats come from, so a change in Anki can be checked against the source:
// - Tables and columns: rslib/src/storage/ in ankitects/anki. Notes keep fields in `flds`
//   separated by \x1f; deck names separate levels with \x1f where the UI shows "::".
// - `cards.data` is JSON (rslib CardData): `s` stability, `d` difficulty, `lrt` last review
//   (unix seconds).
// - `decks.kind` is the protobuf Deck.KindContainer and `deck_config.config` is
//   DeckConfig.Config, both in proto/anki/decks.proto and proto/anki/deck_config.proto. Only the
//   field numbers below are read; everything else in the blob is skipped.

import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Field numbers in DeckConfig.Config (proto/anki/deck_config.proto). */
const CONFIG = {
  fsrsParams4: 3,
  fsrsParams5: 5,
  fsrsParams6: 6,
  newPerDay: 9,
  reviewsPerDay: 10,
  maxInterval: 16,
  desiredRetention: 37,
};

/** Field numbers in Deck.KindContainer and Deck.Normal (proto/anki/decks.proto). */
const KIND_NORMAL = 1;

const NORMAL = { configId: 1, reviewLimit: 6, newLimit: 7, desiredRetention: 10 };

/**
 * Decodes one protobuf message into field number -> values, without a schema. Each value is a
 * `{ wire, value }`: a BigInt for varints (wire 0), a Uint8Array for length-delimited fields
 * (wire 2, which is also how packed repeated floats arrive), and the raw bytes for fixed 32/64
 * bit fields (wire 5 / wire 1). Readers below interpret them by the field's declared type.
 */
export function decodeMessage(bytes) {
  const out = new Map();
  let i = 0;
  const varint = () => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= bytes.length) throw new Error('truncated varint');
      const b = bytes[i++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
  };
  while (i < bytes.length) {
    const key = Number(varint());
    const field = key >>> 3;
    const wire = key & 7;
    let value;
    if (wire === 0) value = varint();
    else if (wire === 1) { value = bytes.subarray(i, i + 8); i += 8; }
    else if (wire === 2) { const len = Number(varint()); value = bytes.subarray(i, i + len); i += len; }
    else if (wire === 5) { value = bytes.subarray(i, i + 4); i += 4; }
    else throw new Error(`unsupported wire type ${wire}`);
    if (!out.has(field)) out.set(field, []);
    out.get(field).push({ wire, value });
  }
  return out;
}

const f32 = (b) => new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);

function uint(msg, field) {
  const v = msg.get(field)?.at(-1);
  return v && v.wire === 0 ? Number(v.value) : undefined;
}

function float(msg, field) {
  const v = msg.get(field)?.at(-1);
  return v && v.wire === 5 ? f32(v.value) : undefined;
}

/** A repeated float, packed (one length-delimited run) or not (one fixed32 per value). */
function floats(msg, field) {
  const out = [];
  for (const v of msg.get(field) ?? []) {
    if (v.wire === 5) out.push(f32(v.value));
    else if (v.wire === 2) for (let j = 0; j + 4 <= v.value.length; j += 4) out.push(f32(v.value.subarray(j, j + 4)));
  }
  return out;
}

function message(msg, field) {
  const v = msg.get(field)?.at(-1);
  return v && v.wire === 2 ? decodeMessage(v.value) : undefined;
}

/** float32 noise off: 0.85 is stored as 0.8500000238. */
const round = (x, places) => (x === undefined ? undefined : Number(x.toFixed(places)));

/** A deck preset's settings from its `deck_config.config` blob. */
export function readDeckConfig(blob) {
  const msg = decodeMessage(blob);
  // The newest parameter set the preset has: FSRS-6, else 5, else 4. ts-fsrs migrates older ones.
  const weights = [CONFIG.fsrsParams6, CONFIG.fsrsParams5, CONFIG.fsrsParams4]
    .map((f) => floats(msg, f))
    .find((w) => w.length > 0) ?? [];
  return {
    newPerDay: uint(msg, CONFIG.newPerDay) ?? 0,
    reviewsPerDay: uint(msg, CONFIG.reviewsPerDay) ?? 0,
    desiredRetention: round(float(msg, CONFIG.desiredRetention), 4),
    weights: weights.map((w) => round(w, 6)),
    maxInterval: uint(msg, CONFIG.maxInterval),
  };
}

/**
 * A deck's preset id and its own overrides, from its `decks.kind` blob. Undefined for a
 * filtered deck, which has no preset: its cards are exported under their home deck.
 */
export function readDeckKind(blob) {
  const normal = message(decodeMessage(blob), KIND_NORMAL);
  if (!normal) return undefined;
  return {
    configId: uint(normal, NORMAL.configId) ?? 1,
    newLimit: uint(normal, NORMAL.newLimit),
    reviewLimit: uint(normal, NORMAL.reviewLimit),
    desiredRetention: round(float(normal, NORMAL.desiredRetention), 4),
  };
}

const deckName = (raw) => raw.split('\x1f').join('::');

/**
 * The import file from a collection's rows.
 *
 * @param rows.col          the `col` row ({ crt })
 * @param rows.notetypes    [{ id, name }]
 * @param rows.fields       [{ ntid, ord, name }]
 * @param rows.notes        [{ id, mid, tags, flds }]
 * @param rows.cards        [{ id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odid, odue, data }]
 * @param rows.decks        [{ id, name, kind }]  (kind as bytes)
 * @param rows.deckConfigs  [{ id, config }]      (config as bytes)
 * @param rows.lastReviews  [{ cid, last }]       (max revlog id per card, ms)
 * @returns {import('../../src/import/ankiJson').AnkiExport & { collectionCreated: number, deckConfigs: Record<string, import('../../src/import/ankiJson').AnkiDeckConfig> }}
 */
export function buildExport(rows) {
  const modelName = new Map(rows.notetypes.map((m) => [Number(m.id), m.name]));
  const fieldNames = new Map();
  for (const f of [...rows.fields].sort((a, b) => a.ord - b.ord)) {
    const ntid = Number(f.ntid);
    if (!fieldNames.has(ntid)) fieldNames.set(ntid, []);
    fieldNames.get(ntid)[f.ord] = f.name;
  }
  const presets = new Map(rows.deckConfigs.map((c) => [Number(c.id), readDeckConfig(c.config)]));
  const decks = new Map(rows.decks.map((d) => [Number(d.id), { name: deckName(d.name), kind: readDeckKind(d.kind) }]));
  const lastReviewMs = new Map(rows.lastReviews.map((r) => [Number(r.cid), Number(r.last)]));

  /** @type {Record<string, import('../../src/import/ankiJson').AnkiDeckConfig>} */
  const deckConfigs = {};
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
    const values = String(n.flds).split('\x1f');
    const fields = {};
    values.forEach((v, i) => { fields[names[i] ?? `Field ${i + 1}`] = v; });
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
    let data = {};
    try { data = c.data ? JSON.parse(c.data) : {}; } catch { /* old or custom data: no memory state */ }
    const fromRevlog = lastReviewMs.get(Number(c.id));
    return {
      cardId: String(c.id),
      note: String(c.nid),
      deckName: decks.get(did)?.name ?? 'Default',
      ord: Number(c.ord),
      type: Number(c.type),
      // Buried (-2, -3) is a today-only state; export it as the card's ordinary queue.
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

  return { collectionCreated: Number(rows.col.crt), notes, cards, deckConfigs };
}

/**
 * Exports the collection at `path`. Reads a private copy with Anki's custom `unicase` collation
 * removed from the schema: Node's SQLite can't register collations, and the tables that declare
 * it (fields, templates, notetypes) refuse every query without it. The original is never opened.
 */
/** @returns {Promise<ReturnType<typeof buildExport>>} */
export async function exportCollection(path) {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'anki-export-'));
  try {
    const copy = join(dir, 'collection.anki2');
    copyFileSync(path, copy);
    // Pages Anki hasn't checkpointed yet live in the -wal file; SQLite folds them in on open.
    if (existsSync(`${path}-wal`) && statSync(`${path}-wal`).size > 0) copyFileSync(`${path}-wal`, `${copy}-wal`);
    const rw = new DatabaseSync(copy);
    rw.exec('PRAGMA writable_schema = ON');
    rw.prepare("UPDATE sqlite_master SET sql = replace(sql, ' COLLATE unicase', '') WHERE sql LIKE '%COLLATE unicase%'").run();
    rw.close();

    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      const all = (sql) => db.prepare(sql).all();
      return buildExport({
        col: db.prepare('SELECT crt FROM col').get(),
        notetypes: all('SELECT id, name FROM notetypes'),
        fields: all('SELECT ntid, ord, name FROM fields'),
        notes: all('SELECT id, mid, tags, flds FROM notes'),
        cards: all('SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odid, odue, data FROM cards'),
        decks: all('SELECT id, name, kind FROM decks'),
        deckConfigs: all('SELECT id, config FROM deck_config'),
        lastReviews: all('SELECT cid, MAX(id) AS last FROM revlog GROUP BY cid'),
      });
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
