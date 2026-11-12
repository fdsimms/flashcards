import { bytesField, decodeMessage, float, floats, int, message, messages, MessageWriter, string, uint, utf8Decode, utf8Encode, type Message } from '../protobuf';
import { parseJson, stringifyJson } from './json';
import type { DeckJson } from './protocol';

/**
 * A deck as sync sends it (Anki's older JSON form, `DeckSchema11`) turned into the row Anki keeps
 * (`decks`: the `Deck.Common` and `Deck.KindContainer` protobuf blobs), so a deck Anki changed
 * can be written in place. That happens after nearly every Anki session, since answering a card
 * bumps its deck's "studied today" counts.
 *
 * Conversions from rslib/src/decks/schema11.rs (`From<DeckSchema11> for Deck`), field numbers from
 * proto/anki/decks.proto, both in ankitects/anki. Default values are left out, as protobuf does.
 */

const COMMON = { studyCollapsed: 1, browserCollapsed: 2, lastDayStudied: 3, newStudied: 4, reviewStudied: 5, learningStudied: 6, msStudied: 7, other: 255 };
const KIND = { normal: 1, filtered: 2 };
const NORMAL = { configId: 1, extendNew: 2, extendReview: 3, description: 4, markdown: 5, reviewLimit: 6, newLimit: 7, reviewLimitToday: 8, newLimitToday: 9, desiredRetention: 10 };
const DAY_LIMIT = { limit: 1, today: 2 };
const FILTERED = { reschedule: 1, terms: 2, delays: 3, previewDelay: 4, previewHardSecs: 5, previewGoodSecs: 6, previewAgainSecs: 7 };
const TERM = { search: 1, limit: 2, order: 3 };

/** The keys the schema-11 structs read; everything else goes to `Common.other` as JSON. */
const COMMON_KEYS = ['id', 'mod', 'name', 'usn', 'lrnToday', 'revToday', 'newToday', 'timeToday', 'collapsed', 'browserCollapsed', 'desc', 'md', 'dyn', 'return'];
const NORMAL_KEYS = ['conf', 'extendNew', 'extendRev', 'reviewLimit', 'newLimit', 'reviewLimitToday', 'newLimitToday', 'desiredRetention'];
const FILTERED_KEYS = ['resched', 'terms', 'separate', 'delays', 'previewDelay', 'previewAgainSecs', 'previewHardSecs', 'previewGoodSecs'];

export interface DeckRow {
  id: number;
  /** As stored: levels joined by \x1f rather than "::". */
  name: string;
  mtime: number;
  usn: number;
  common: Uint8Array;
  kind: Uint8Array;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
};
const bool = (v: unknown): boolean => v === true || (typeof v === 'number' && v !== 0) || v === '1' || v === 'true';
/** An `Option<u32>` that falls back to None on anything unreadable (`default_on_invalid`). */
const optU32 = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);
const today = (v: unknown): { day: number; amount: number } => {
  const a = Array.isArray(v) ? v : [];
  return { day: num(a[0]), amount: num(a[1]) };
};

function writeIf(w: MessageWriter, field: number, v: number) {
  if (v !== 0) w.uint(field, v);
}

/** `Deck.Common` from the deck's JSON. */
export function deckCommon(d: DeckJson): Uint8Array {
  const lrn = today(d.lrnToday);
  const rev = today(d.revToday);
  const nw = today(d.newToday);
  const time = today(d.timeToday);
  // A count from an earlier day than the latest one is stale, so it reads as zero.
  const maxDay = Math.max(time.day, nw.day, rev.day);
  const known = new Set([...COMMON_KEYS, ...(bool(d.dyn) ? FILTERED_KEYS : NORMAL_KEYS)]);
  const other = Object.fromEntries(Object.entries(d).filter(([k]) => !known.has(k)));

  const w = new MessageWriter();
  if (bool(d.collapsed)) w.uint(COMMON.studyCollapsed, 1);
  if (bool(d.browserCollapsed)) w.uint(COMMON.browserCollapsed, 1);
  writeIf(w, COMMON.lastDayStudied, maxDay);
  writeIf(w, COMMON.newStudied, nw.day === maxDay ? nw.amount : 0);
  writeIf(w, COMMON.reviewStudied, rev.day === maxDay ? rev.amount : 0);
  writeIf(w, COMMON.learningStudied, lrn.day === maxDay ? lrn.amount : 0);
  writeIf(w, COMMON.msStudied, time.amount);
  if (Object.keys(other).length) w.bytes(COMMON.other, utf8Encode(stringifyJson(other)));
  return w.finish();
}

function dayLimit(v: unknown): Uint8Array | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { limit?: unknown; today?: unknown };
  const w = new MessageWriter();
  writeIf(w, DAY_LIMIT.limit, num(o.limit));
  writeIf(w, DAY_LIMIT.today, num(o.today));
  return w.finish();
}

/** `Deck.KindContainer` from the deck's JSON. */
export function deckKind(d: DeckJson): Uint8Array {
  const inner = new MessageWriter();
  if (bool(d.dyn)) {
    if (bool(d.resched)) inner.uint(FILTERED.reschedule, 1);
    for (const t of Array.isArray(d.terms) ? d.terms : []) {
      const [search, limit, order] = t as [unknown, unknown, unknown];
      const tw = new MessageWriter();
      if (search) tw.string(TERM.search, String(search));
      writeIf(tw, TERM.limit, Math.max(0, num(limit)));
      writeIf(tw, TERM.order, num(order));
      inner.bytes(FILTERED.terms, tw.finish());
    }
    const delays = Array.isArray(d.delays) ? d.delays.map(num) : [];
    if (delays.length) inner.packedFloats(FILTERED.delays, delays);
    writeIf(inner, FILTERED.previewDelay, num(d.previewDelay));
    writeIf(inner, FILTERED.previewHardSecs, num(d.previewHardSecs));
    writeIf(inner, FILTERED.previewGoodSecs, num(d.previewGoodSecs));
    writeIf(inner, FILTERED.previewAgainSecs, num(d.previewAgainSecs));
    return new MessageWriter().bytes(KIND.filtered, inner.finish()).finish();
  }
  writeIf(inner, NORMAL.configId, num(d.conf));
  writeIf(inner, NORMAL.extendNew, Math.max(0, num(d.extendNew)));
  writeIf(inner, NORMAL.extendReview, Math.max(0, num(d.extendRev)));
  if (typeof d.desc === 'string' && d.desc) inner.string(NORMAL.description, d.desc);
  if (bool(d.md)) inner.uint(NORMAL.markdown, 1);
  const reviewLimit = optU32(d.reviewLimit);
  const newLimit = optU32(d.newLimit);
  if (reviewLimit !== undefined) inner.uint(NORMAL.reviewLimit, reviewLimit);
  if (newLimit !== undefined) inner.uint(NORMAL.newLimit, newLimit);
  const rToday = dayLimit(d.reviewLimitToday);
  const nToday = dayLimit(d.newLimitToday);
  if (rToday) inner.bytes(NORMAL.reviewLimitToday, rToday);
  if (nToday) inner.bytes(NORMAL.newLimitToday, nToday);
  const dr = optU32(d.desiredRetention);
  if (dr !== undefined) inner.float(NORMAL.desiredRetention, dr / 100);
  return new MessageWriter().bytes(KIND.normal, inner.finish()).finish();
}

/** The stored name: "::" between levels becomes \x1f. */
export function nativeDeckName(human: string): string {
  return human.split('::').join('\x1f');
}

/** The keys `From<Deck> for DeckSchema11` writes itself; `Common.other` can't override them. */
const RESERVED_KEYS = new Set(['usn', 'revToday', 'newLimit', 'dyn', 'reviewLimit', 'newToday', 'timeToday', 'reviewLimitToday', 'extendNew', 'mod',
  'newLimitToday', 'desc', 'name', 'lrnToday', 'conf', 'browserCollapsed', 'extendRev', 'id', 'collapsed', 'desiredRetention']);

function readDayLimit(msg: Message | undefined) {
  return msg ? { limit: uint(msg, DAY_LIMIT.limit) ?? 0, today: uint(msg, DAY_LIMIT.today) ?? 0 } : null;
}

/**
 * The reverse of `deckRow`: a deck as Anki keeps it, as the JSON sync sends (rslib's
 * `From<Deck> for DeckSchema11`), so a deck changed here (collapsed on the deck list) can be sent
 * in `applyChanges` rather than forcing a full sync. Every today count carries the last day
 * studied, an unset limit is null, and `Common.other` adds the keys Anki doesn't read itself.
 */
export function deckJson(row: DeckRow): DeckJson {
  const common = decodeMessage(row.common);
  const kind = decodeMessage(row.kind);
  const day = uint(common, COMMON.lastDayStudied) ?? 0;
  const otherBytes = bytesField(common, COMMON.other);
  const otherAll = otherBytes?.length ? parseJson(utf8Decode(otherBytes)) : {};
  const other = otherAll && typeof otherAll === 'object' && !Array.isArray(otherAll)
    ? Object.fromEntries(Object.entries(otherAll).filter(([k]) => !RESERVED_KEYS.has(k))) : {};
  const normal = message(kind, KIND.normal);
  const filtered = message(kind, KIND.filtered);
  const base: DeckJson = {
    id: row.id,
    mod: row.mtime,
    name: row.name.split('\x1f').join('::'),
    usn: row.usn,
    lrnToday: [day, int(common, COMMON.learningStudied) ?? 0],
    revToday: [day, int(common, COMMON.reviewStudied) ?? 0],
    newToday: [day, int(common, COMMON.newStudied) ?? 0],
    timeToday: [day, int(common, COMMON.msStudied) ?? 0],
    collapsed: uint(common, COMMON.studyCollapsed) === 1,
    browserCollapsed: uint(common, COMMON.browserCollapsed) === 1,
    desc: (normal && string(normal, NORMAL.description)) || '',
    ...(normal && uint(normal, NORMAL.markdown) === 1 ? { md: true } : {}),
    dyn: filtered ? 1 : 0,
    ...other,
  };
  if (filtered) {
    const delays = floats(filtered, FILTERED.delays);
    return {
      ...base,
      resched: uint(filtered, FILTERED.reschedule) === 1,
      terms: messages(filtered, FILTERED.terms).map((t) => [string(t, TERM.search) ?? '', uint(t, TERM.limit) ?? 0, int(t, TERM.order) ?? 0]),
      separate: true,
      delays: delays.length ? delays : null,
      previewDelay: uint(filtered, FILTERED.previewDelay) ?? 0,
      previewAgainSecs: uint(filtered, FILTERED.previewAgainSecs) ?? 0,
      previewHardSecs: uint(filtered, FILTERED.previewHardSecs) ?? 0,
      previewGoodSecs: uint(filtered, FILTERED.previewGoodSecs) ?? 0,
    };
  }
  const n = normal ?? new Map();
  const dr = float(n, NORMAL.desiredRetention);
  return {
    ...base,
    conf: uint(n, NORMAL.configId) ?? 0,
    extendNew: uint(n, NORMAL.extendNew) ?? 0,
    extendRev: uint(n, NORMAL.extendReview) ?? 0,
    reviewLimit: uint(n, NORMAL.reviewLimit) ?? null,
    newLimit: uint(n, NORMAL.newLimit) ?? null,
    reviewLimitToday: readDayLimit(message(n, NORMAL.reviewLimitToday)),
    newLimitToday: readDayLimit(message(n, NORMAL.newLimitToday)),
    // Anki's (v * 100.0) as u32, in f32.
    desiredRetention: dr === undefined ? null : Math.trunc(Math.fround(Math.fround(dr) * 100)),
  };
}

export function deckRow(d: DeckJson): DeckRow {
  return {
    id: num(d.id),
    name: nativeDeckName(d.name),
    mtime: num(d.mod),
    usn: num(d.usn),
    common: deckCommon(d),
    kind: deckKind(d),
  };
}
