import { compare, ratedEase, ratedSpan, type CardStateWord, type Glob, type SearchNode } from './ankiSearch';

/**
 * A search (src/core/ankiSearch.ts) run on the Anki collection's own rows, as Anki's search runs it
 * (rslib's search/sqlwriter.rs): what a filtered deck gathers, so the deck Franki builds is the one
 * Anki or AnkiMobile builds when it rebuilds it. Browse reads Franki's own copy of the cards instead,
 * with plain words looser than this (`matchesSearch`).
 *
 * Where Anki uses SQLite's LIKE (a plain word, a field search), case is ignored for ASCII letters
 * only, and the text is the field as stored, HTML and all. Where it uses its regexp function (deck,
 * tag, note type names) case is ignored for every letter. A field Anki's note type leaves out of
 * plain-word searches is still searched here: Franki doesn't read that field option.
 */

export interface AnkiSearchRow {
  id: number;
  nid: number;
  did: number;
  odid: number;
  ord: number;
  type: number;
  queue: number;
  due: number;
  odue: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  flags: number;
  /** The card's `data` JSON (`s`, `d`, `dr`, `decay`, `lrt`). */
  data: string;
  mod: number;
  /** The note's fields joined by \x1f, as stored, and its sort field. */
  flds: string;
  sfld: string;
  /** The note's tags as stored: space-separated with a space at each end. */
  tags: string;
  notetype: string;
  fieldNames: string[];
  /** The card's deck and, in a filtered deck, its home deck, as "A::B". */
  deckName: string;
  homeDeckName?: string;
  /** The card's review log (id in ms, button), for `rated:`. */
  revlog: { id: number; ease: number }[];
}

/** The moment a search is run at, as Anki's timing gives it. */
export interface AnkiSearchTiming {
  /** Anki's day number today. */
  today: number;
  /** When the next study day starts, and now (unix seconds). */
  nextDayAt: number;
  now: number;
  /** The collection's learn ahead limit, in seconds (`is:due` takes steps due within it). */
  learnAheadSecs: number;
}

const QUEUE = { suspended: -1, schedBuried: -2, userBuried: -3, newQ: 0, learn: 1, review: 2, dayLearn: 3, preview: 4 };

/** ASCII letters lowercased, others as they are: SQLite's LIKE ignores case for ASCII only. */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** A glob as SQLite's LIKE reads Anki's (`to_sql`): `*` any run of characters, `_` one. */
function likeRegex(g: Glob, anchored: boolean): RegExp {
  const src = asciiLower(g.source);
  return new RegExp(anchored ? `^${src}$` : src, 's');
}
const like = (re: RegExp, text: string) => re.test(asciiLower(text));

/** A glob's regex source with its wildcards read as `cls` (Anki's `to_custom_re`), e.g. a tag's `\S`. */
function withWildcard(source: string, cls: string): string {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { out += c + (source[i + 1] ?? ''); i++; continue; }
    if (c === '.' && source[i + 1] === '*') { out += `${cls}*`; i++; continue; }
    if (c === '.') { out += cls; continue; }
    out += c;
  }
  return out;
}

function cardData(row: AnkiSearchRow): { s?: number; d?: number; dr?: number; decay?: number; lrt?: number } {
  try { const d = row.data ? JSON.parse(row.data) : {}; return d && typeof d === 'object' ? d : {}; } catch { return {}; }
}

const FSRS5_DEFAULT_DECAY = 0.5;
const f32 = Math.fround;

/** FSRS's chance of recall `days` after the last answer, in f32 as fsrs-rs computes it (`current_retrievability`). */
function currentRetrievability(stability: number, days: number, decay: number): number {
  const d = f32(-decay);
  const factor = f32(f32(Math.pow(f32(0.9), f32(1 / d))) - 1);
  return f32(Math.pow(f32(1 + f32(f32(factor * f32(days)) / f32(stability))), d));
}

/** Rust's `(x as u32).saturating_sub(y as u32)` for the i64s Anki has. */
const u32 = (x: number) => (Math.trunc(x) >>> 0);
const satSub = (a: number, b: number) => Math.max(0, u32(a) - u32(b));

/**
 * A card's retrievability now, as Anki's `extract_fsrs_retrievability` works it out: from the last
 * answer's time when the card keeps it, else from its due and interval; undefined with no memory state.
 */
export function rowRetrievability(row: AnkiSearchRow, t: AnkiSearchTiming): number | undefined {
  const data = cardData(row);
  if (!row.data || typeof data.s !== 'number' || typeof data.d !== 'number') return undefined;
  const due = row.odue !== 0 ? row.odue : row.due;
  let secs: number;
  if (typeof data.lrt === 'number') secs = satSub(t.now, data.lrt);
  else if (due > 365_000) secs = satSub(t.now, satSub(due, row.ivl));
  else secs = satSub(t.today, satSub(due, row.ivl)) * 86_400;
  return currentRetrievability(data.s, f32(secs / 86_400), data.decay ?? FSRS5_DEFAULT_DECAY);
}

/**
 * Anki's "Relative overdueness" key, lowest first (`extract_fsrs_relative_retrievability`): how far
 * recall has fallen against how far the desired retention lets it, or without FSRS data the days
 * since the last answer over the interval.
 */
export function rowRelativeOverdueness(row: AnkiSearchRow, t: AnkiSearchTiming): number {
  const due = row.odue !== 0 ? row.odue : row.due;
  const elapsed = due > 365_000 ? satSub(t.now, due) : satSub(t.today, due - row.ivl) * 86_400;
  const data = cardData(row);
  if (row.data && typeof data.s === 'number' && typeof data.d === 'number' && typeof data.dr === 'number') {
    const dr = Math.max(f32(data.dr), 0.0001);
    const decay = data.decay ?? FSRS5_DEFAULT_DECAY;
    const secs = typeof data.lrt === 'number' ? satSub(t.now, data.lrt) : elapsed;
    const r = Math.max(currentRetrievability(data.s, f32(secs / 86_400), decay), 0.0001);
    return f32(-f32(f32(Math.pow(f32(r), f32(-1 / decay))) - 1) / f32(f32(Math.pow(dr, f32(-1 / decay))) - 1));
  }
  const days = Math.floor(elapsed / 86_400);
  return f32(-f32(days + 0.001) / Math.max(row.ivl, 1));
}

/** Whether a card's row matches the search. */
export function matchesAnkiRow(node: SearchNode, row: AnkiSearchRow, t: AnkiSearchTiming): boolean {
  switch (node.kind) {
    case 'and': return node.parts.every((p) => matchesAnkiRow(p, row, t));
    case 'or': return node.parts.some((p) => matchesAnkiRow(p, row, t));
    case 'not': return !matchesAnkiRow(node.part, row, t);
    case 'text': {
      const re = likeRegex(node.glob, false);
      return like(re, row.sfld) || like(re, row.flds);
    }
    case 'deck': {
      const name = node.glob.text.toLowerCase();
      if (!node.glob.wild && name === 'filtered') return row.odid !== 0;
      if (node.glob.text === '*') return true;
      const re = new RegExp(`^${node.glob.source}($|::)`, 'iu');
      return re.test(row.deckName) || (row.odid !== 0 && !!row.homeDeckName && re.test(row.homeDeckName));
    }
    case 'tag': {
      if (node.glob.text === '*') return true;
      if (/\s/.test(node.glob.text)) return false;
      return new RegExp(`.* ${withWildcard(node.glob.source, '\\S')}(::| ).*`, 'iu').test(row.tags);
    }
    case 'noTags': return row.tags.trim() === '';
    case 'note': return new RegExp(`^${node.glob.source}$`, 'iu').test(row.notetype);
    case 'field': {
      const fieldRe = new RegExp(`^${node.field.source}$`, 'iu');
      const valueRe = likeRegex(node.value, true);
      const values = row.flds.split('\x1f');
      return row.fieldNames.some((name, i) => fieldRe.test(name) && like(valueRe, values[i] ?? ''));
    }
    case 'added': return row.id > (t.nextDayAt - 86_400 * node.days) * 1000;
    case 'flag': return (row.flags & 7) === node.flag;
    case 'is': return rowIs(node.state, row, t);
    case 'rated': return row.revlog.some((r) => ratedEase(r.ease, node.ease) && ratedSpan(r.id, node.op, node.days, t.nextDayAt * 1000));
    case 'prop': return rowProp(node, row, t);
  }
}

function rowIs(state: CardStateWord, row: AnkiSearchRow, t: AnkiSearchTiming): boolean {
  switch (state) {
    case 'new': return row.type === 0;
    case 'review': return row.type === 2 || row.type === 3;
    case 'learn': return row.type === 1 || row.type === 3;
    case 'buried': return row.queue === QUEUE.schedBuried || row.queue === QUEUE.userBuried;
    case 'buried-manually': return row.queue === QUEUE.userBuried;
    case 'buried-sibling': return row.queue === QUEUE.schedBuried;
    case 'suspended': return row.queue === QUEUE.suspended;
    case 'due':
      return ((row.queue === QUEUE.review || row.queue === QUEUE.dayLearn) && row.due <= t.today)
        || ((row.queue === QUEUE.learn || row.queue === QUEUE.preview) && row.due <= t.now + t.learnAheadSecs);
  }
}

function rowProp(node: Extract<SearchNode, { kind: 'prop' }>, row: AnkiSearchRow, t: AnkiSearchTiming): boolean {
  const { op, value } = node;
  const due = row.odue !== 0 ? row.odue : row.due;
  switch (node.prop) {
    case 'due':
      return ((row.queue === QUEUE.review || row.queue === QUEUE.dayLearn) && compare(due, op, value + t.today))
        || ((row.queue === QUEUE.learn || row.queue === QUEUE.preview) && compare(Math.trunc((due - t.nextDayAt) / 86_400), op, value));
    case 'pos': return row.type === 0 && compare(due, op, value);
    case 'ivl': return compare(row.ivl, op, value);
    case 'reps': return compare(row.reps, op, value);
    case 'lapses': return compare(row.lapses, op, value);
    case 'ease': return compare(row.factor, op, Math.trunc(f32(value) * 1000));
    case 's': { const s = cardData(row).s; return typeof s === 'number' && compare(s, op, value); }
    case 'd': { const d = cardData(row).d; return typeof d === 'number' && compare(d, op, value * 9 + 1); }
    case 'r': {
      if (row.type === 0) return false;
      const r = rowRetrievability(row, t);
      return r !== undefined && compare(r, op, value);
    }
  }
}
