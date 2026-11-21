import { bytesField, decodeMessage, MessageWriter, messages, string as readString, utf8Decode, utf8Encode, type Message } from '../protobuf';
import { parseJson, stringifyJson } from './json';

/**
 * A note type as sync sends it (Anki's older JSON form, `NotetypeSchema11`) turned into the rows
 * Anki keeps: one `notetypes` row (`Notetype.Config`), one `fields` row per field
 * (`Notetype.Field.Config`) and one `templates` row per card template (`Notetype.Template.Config`),
 * as `From<NotetypeSchema11> for Notetype` in rslib/src/notetype/schema11.rs does. Field numbers
 * from proto/anki/notetypes.proto; written in field order, defaults left out, as prost.
 *
 * A template that came by sync is stored with mtime 0 and usn 0, as Anki stores it: schema 11
 * carries neither.
 *
 * `notetypeJson` is the way back, `From<Notetype> for NotetypeSchema11`: what Anki's own client
 * sends in applyChanges for a note type changed on this phone (its templates or styling).
 */

export interface NotetypeJson {
  id: number | string;
  name: string;
  mod?: number;
  usn: number;
  [key: string]: unknown;
}

export interface NotetypeRows {
  id: number;
  name: string;
  mtime: number;
  usn: number;
  config: Uint8Array;
  fields: { ord: number; name: string; config: Uint8Array }[];
  templates: { ord: number; name: string; config: Uint8Array }[];
}

const NT = { kind: 1, sortField: 2, css: 3, targetDeck: 4, latexPre: 5, latexPost: 6, latexSvg: 7, reqs: 8, stockKind: 9, originalId: 10, other: 255 };
const REQ = { cardOrd: 1, kind: 2, fieldOrds: 3 };
const FIELD = { sticky: 1, rtl: 2, font: 3, size: 4, description: 5, plainText: 6, collapsed: 7, excludeFromSearch: 8, id: 9, tag: 10, preventDeletion: 11, other: 255 };
const TEMPLATE = { qfmt: 1, afmt: 2, bqfmt: 3, bafmt: 4, did: 5, bfont: 6, bsize: 7, id: 8, other: 255 };

const NT_KEYS = new Set(['id', 'name', 'type', 'mod', 'usn', 'sortf', 'did', 'tmpls', 'flds', 'css', 'latexPre', 'latexPost', 'latexsvg', 'req', 'originalStockKind', 'originalId']);
const FIELD_KEYS = new Set(['name', 'ord', 'sticky', 'rtl', 'font', 'size', 'description', 'plainText', 'collapsed', 'excludeFromSearch', 'id', 'tag', 'preventDeletion']);
const TEMPLATE_KEYS = new Set(['name', 'ord', 'qfmt', 'afmt', 'bqfmt', 'bafmt', 'did', 'bfont', 'bsize', 'id']);
/** Schema 11 names a requirement's kind; the protobuf numbers them. */
const REQ_KIND: Record<string, number> = { none: 0, any: 1, all: 2 };

const num = (v: unknown): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
/** An optional integer (a bigint past 2^53) that reads as absent when it's missing or isn't one (`default_on_invalid`). */
const opt = (v: unknown): number | bigint | undefined => (typeof v === 'bigint' || (typeof v === 'number' && Number.isInteger(v)) ? v : undefined);
/** `deserialize_bool_from_anything`. */
const bool = (v: unknown): boolean => v === true || (typeof v === 'number' && v !== 0) || v === '1' || v === 'true';
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const other = (o: Record<string, unknown>, known: Set<string>): Uint8Array | undefined => {
  const extra = Object.fromEntries(Object.entries(o).filter(([k]) => !known.has(k)));
  return Object.keys(extra).length ? utf8Encode(stringifyJson(extra)) : undefined;
};

function u(w: MessageWriter, f: number, v: number | bigint) { if (v) w.uint(f, v); }
function s(w: MessageWriter, f: number, v: string) { if (v) w.string(f, v); }

function fieldConfig(f: Record<string, unknown>): Uint8Array {
  const w = new MessageWriter();
  if (bool(f.sticky)) w.uint(FIELD.sticky, 1);
  if (bool(f.rtl)) w.uint(FIELD.rtl, 1);
  s(w, FIELD.font, str(f.font));
  u(w, FIELD.size, num(f.size));
  s(w, FIELD.description, str(f.description));
  if (f.plainText === true) w.uint(FIELD.plainText, 1);
  if (f.collapsed === true) w.uint(FIELD.collapsed, 1);
  if (f.excludeFromSearch === true) w.uint(FIELD.excludeFromSearch, 1);
  const id = opt(f.id);
  if (id !== undefined) w.uint(FIELD.id, id);
  const tag = opt(f.tag);
  if (tag !== undefined && tag >= 0 && tag <= 0xffffffff) w.uint(FIELD.tag, tag);
  if (f.preventDeletion === true) w.uint(FIELD.preventDeletion, 1);
  const o = other(f, FIELD_KEYS);
  if (o) w.bytes(FIELD.other, o);
  return w.finish();
}

function templateConfig(t: Record<string, unknown>): Uint8Array {
  const w = new MessageWriter();
  s(w, TEMPLATE.qfmt, str(t.qfmt));
  s(w, TEMPLATE.afmt, str(t.afmt));
  s(w, TEMPLATE.bqfmt, str(t.bqfmt));
  s(w, TEMPLATE.bafmt, str(t.bafmt));
  u(w, TEMPLATE.did, opt(t.did) ?? 0);
  s(w, TEMPLATE.bfont, str(t.bfont));
  const bsize = opt(t.bsize);
  u(w, TEMPLATE.bsize, typeof bsize === 'number' && bsize >= 0 && bsize <= 255 ? bsize : 0);
  const id = opt(t.id);
  if (id !== undefined) w.uint(TEMPLATE.id, id);
  const o = other(t, TEMPLATE_KEYS);
  if (o) w.bytes(TEMPLATE.other, o);
  return w.finish();
}

export function notetypeRows(nt: NotetypeJson): NotetypeRows {
  const w = new MessageWriter();
  u(w, NT.kind, num(nt.type));
  u(w, NT.sortField, num(nt.sortf));
  s(w, NT.css, str(nt.css));
  u(w, NT.targetDeck, opt(nt.did) ?? 0);
  s(w, NT.latexPre, str(nt.latexPre));
  s(w, NT.latexPost, str(nt.latexPost));
  if (nt.latexsvg === true) w.uint(NT.latexSvg, 1);
  for (const r of Array.isArray(nt.req) ? nt.req : []) {
    const [cardOrd, kind, fieldOrds] = r as [unknown, unknown, unknown];
    const rw = new MessageWriter();
    u(rw, REQ.cardOrd, num(cardOrd));
    u(rw, REQ.kind, REQ_KIND[String(kind)] ?? 0);
    const ords = Array.isArray(fieldOrds) ? fieldOrds.map(num) : [];
    if (ords.length) rw.packedUints(REQ.fieldOrds, ords);
    w.bytes(NT.reqs, rw.finish());
  }
  u(w, NT.stockKind, num(nt.originalStockKind));
  const originalId = opt(nt.originalId);
  if (originalId !== undefined) w.uint(NT.originalId, originalId);
  const o = other(nt, NT_KEYS);
  if (o) w.bytes(NT.other, o);

  const flds = (Array.isArray(nt.flds) ? nt.flds : []) as Record<string, unknown>[];
  const tmpls = (Array.isArray(nt.tmpls) ? nt.tmpls : []) as Record<string, unknown>[];
  return {
    id: num(nt.id),
    name: nt.name,
    mtime: num(nt.mod),
    usn: num(nt.usn),
    config: w.finish(),
    // Stored in list order, whatever `ord` each claims (rslib's update_notetype_fields).
    fields: flds.map((f, ord) => ({ ord, name: str(f.name), config: fieldConfig(f) })),
    templates: tmpls.map((t, ord) => ({ ord, name: str(t.name), config: templateConfig(t) })),
  };
}

// ---- the rows back to the JSON sync sends ----

const REQ_KIND_NAME = ['none', 'any', 'all'];

/** The last varint of a field, as a signed 64-bit integer: a number, or a bigint past 2^53 as sync/json.ts keeps one. */
function varint(m: Message, f: number): number | bigint | undefined {
  const v = m.get(f)?.at(-1);
  if (!v || v.wire !== 0) return undefined;
  const n = BigInt.asIntN(64, v.value);
  return Number.isSafeInteger(Number(n)) ? Number(n) : n;
}
const n0 = (m: Message, f: number): number => Number(varint(m, f) ?? 0);
const flag = (m: Message, f: number): boolean => n0(m, f) !== 0;
const text = (m: Message, f: number): string => readString(m, f) ?? '';
/** A repeated uint32, packed or not. */
function uints(m: Message, f: number): number[] {
  const out: number[] = [];
  for (const v of m.get(f) ?? []) {
    if (v.wire === 0) out.push(Number(v.value));
    else if (v.wire === 2) {
      let n = 0, shift = 0;
      for (const b of v.value) {
        n += (b & 0x7f) * 2 ** shift;
        if (b & 0x80) shift += 7;
        else { out.push(n); n = 0; shift = 0; }
      }
    }
  }
  return out;
}
/** The add-on keys Anki keeps in `other`, put back beside the known ones (`parse_other_fields`). */
function otherKeys(m: Message, f: number): Record<string, unknown> {
  const b = bytesField(m, f);
  if (!b) return {};
  try {
    const v = parseJson(utf8Decode(b));
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** A note type's rows as the JSON Anki's sync sends (`From<Notetype> for NotetypeSchema11`). */
export function notetypeJson(rows: NotetypeRows): NotetypeJson {
  const c = decodeMessage(rows.config);
  const did = varint(c, NT.targetDeck);
  const originalStockKind = n0(c, NT.stockKind);
  const originalId = varint(c, NT.originalId);
  return {
    ...otherKeys(c, NT.other),
    id: rows.id,
    name: rows.name,
    type: n0(c, NT.kind) === 1 ? 1 : 0,
    mod: rows.mtime,
    usn: rows.usn,
    sortf: n0(c, NT.sortField),
    did: did ? did : null,
    tmpls: rows.templates.map((t) => {
      const m = decodeMessage(t.config);
      const tdid = varint(m, TEMPLATE.did);
      return {
        ...otherKeys(m, TEMPLATE.other),
        name: t.name,
        ord: t.ord,
        qfmt: text(m, TEMPLATE.qfmt),
        afmt: text(m, TEMPLATE.afmt),
        bqfmt: text(m, TEMPLATE.bqfmt),
        bafmt: text(m, TEMPLATE.bafmt),
        did: tdid ? tdid : null,
        bfont: text(m, TEMPLATE.bfont),
        bsize: n0(m, TEMPLATE.bsize),
        id: varint(m, TEMPLATE.id) ?? null,
      };
    }),
    flds: rows.fields.map((f) => {
      const m = decodeMessage(f.config);
      return {
        ...otherKeys(m, FIELD.other),
        name: f.name,
        ord: f.ord,
        sticky: flag(m, FIELD.sticky),
        rtl: flag(m, FIELD.rtl),
        font: text(m, FIELD.font),
        size: n0(m, FIELD.size),
        description: text(m, FIELD.description),
        plainText: flag(m, FIELD.plainText),
        collapsed: flag(m, FIELD.collapsed),
        excludeFromSearch: flag(m, FIELD.excludeFromSearch),
        id: varint(m, FIELD.id) ?? null,
        tag: varint(m, FIELD.tag) ?? null,
        preventDeletion: flag(m, FIELD.preventDeletion),
      };
    }),
    css: text(c, NT.css),
    latexPre: text(c, NT.latexPre),
    latexPost: text(c, NT.latexPost),
    latexsvg: flag(c, NT.latexSvg),
    req: messages(c, NT.reqs).map((r) => [n0(r, REQ.cardOrd), REQ_KIND_NAME[n0(r, REQ.kind)] ?? 'none', uints(r, REQ.fieldOrds)]),
    // skip_serializing_if = "is_default"
    ...(originalStockKind ? { originalStockKind } : {}),
    ...(originalId !== undefined ? { originalId } : {}),
  };
}
