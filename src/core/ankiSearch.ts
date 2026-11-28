import { noteAddedAt } from './cram';
import { addCalendarDays, nextStudyDayStart, studyDayStart } from './day';
import { htmlToText } from './html';
import { isBuried } from './queue';
import type { Card, Note } from './types';

/**
 * Anki's search syntax, read and checked against a note and its cards: what Browse's search box
 * takes. Anki's own parser is in Rust (rslib/src/search), which the MCP's `find_notes` uses; there
 * is no TypeScript one to share, so this follows its rules as Anki's manual states them:
 *
 * - Words are and-ed (`dog cat`); `or` between two searches matches either, and binds looser than
 *   and (`a b or c` is `(a b) or c`); `-` in front of a search negates it; parentheses group.
 *   `"..."` keeps spaces in one search (`"a dog"`, `"deck:Thai words"`, `deck:"Thai words"`).
 * - `*` matches any run of characters and `_` any one; a backslash takes either literally, as it
 *   does `"`, `:`, `(`, `)` and `-`.
 * - `deck:Polski` is that deck and its subdecks, `tag:verb` that tag and its child tags
 *   (`verb::*`), `tag:none` a note with no tags, `note:Basic` the note type; all case aside.
 * - `is:due` / `new` / `learn` / `review` / `suspended` / `buried`, `flag:0` (no flag) to `flag:7`,
 *   `added:N` (added in the last N study days, today being 1).
 * - Any other `name:value` is a field search: the field's whole text is `value` (`front:dog`; use
 *   `front:*dog*` for a field containing it), case aside; `front:` alone is an empty field.
 *
 * Browse lists notes, so as in the notes mode of Anki's browser a note matches when one of its
 * cards matches the whole search: `is:new flag:1` needs one card both new and red-flagged. A
 * retired card (a kind the note no longer makes) counts for nothing.
 *
 * Two places differ from Anki on purpose. A plain word searches as Browse always has (any field as
 * text, a tag or the deck name, accents aside; `textMatches` in noteEditing.ts), where Anki looks
 * at fields only and with accents. And a field search compares the field as text, not its HTML.
 * The searches Anki has that this doesn't read (`rated:`, `prop:` and the rest of
 * `UNSUPPORTED`) are refused with a message rather than read as a field.
 */

/** A pattern as typed: its text with escapes taken off, and as a regular expression's source. */
export interface Glob {
  /** The text, escapes resolved; wildcards left as the characters they were. */
  text: string;
  /** Whether it holds an unescaped `*` or `_`. */
  wild: boolean;
  /** A regular expression source for it, unanchored: `*` as `.*`, `_` as `.`. */
  source: string;
}

export type CardStateWord = 'due' | 'new' | 'learn' | 'review' | 'suspended' | 'buried' | 'buried-manually' | 'buried-sibling';

/** A comparison in a `prop:` or Anki's own form of `rated:`. */
export type CompareOp = '<' | '<=' | '>' | '>=' | '=' | '!=';

/** The card properties `prop:` compares (Anki's parse_prop): interval, due, reps, lapses, ease, new-card position, FSRS stability, difficulty and retrievability. */
export type PropName = 'ivl' | 'due' | 'reps' | 'lapses' | 'ease' | 'pos' | 's' | 'd' | 'r';

export type SearchNode =
  | { kind: 'and' | 'or'; parts: SearchNode[] }
  | { kind: 'not'; part: SearchNode }
  | { kind: 'text'; glob: Glob }
  | { kind: 'deck' | 'tag' | 'note'; glob: Glob }
  | { kind: 'noTags' }
  | { kind: 'field'; field: Glob; value: Glob }
  | { kind: 'is'; state: CardStateWord }
  | { kind: 'flag'; flag: number }
  | { kind: 'added'; days: number }
  /**
   * Answered in a span of days, as Anki's `write_rated(op, days, ease)` reads it: an answer whose time
   * compares by `op` with the start of the study day `days` from the next one (`rated:7` is `>` with
   * -7). `ease` is a button (1-4), any button, or a manual reschedule (Set Due Date, Forget: `resched:`).
   */
  | { kind: 'rated'; op: CompareOp; days: number; ease: number | 'any' | 'manual' }
  | { kind: 'prop'; prop: PropName; op: CompareOp; value: number };

/** A search read: its tree (none when nothing was typed), or why it couldn't be read. */
export type ParsedSearch = { ok: true; node?: SearchNode } | { ok: false; error: string };

const STATES: CardStateWord[] = ['due', 'new', 'learn', 'review', 'suspended', 'buried', 'buried-manually', 'buried-sibling'];

/** Anki's searches this doesn't read yet; refused by name instead of being searched as a field. */
export const UNSUPPORTED = ['re', 'nc', 'w', 'dupe', 'cid', 'nid', 'mid', 'did', 'card', 'introduced', 'edited', 'preset'];

/** Whole numbers only, as Anki parses these (u32, or i32 for due). */
const WHOLE_PROPS = new Set<PropName>(['ivl', 'reps', 'lapses', 'pos']);

/** An answer button in `rated:N:B`: 1 to 4, or any when there's none. */
function answerButton(text: string | undefined, example: string): number | 'any' {
  if (text === undefined) return 'any';
  if (!/^[1-4]$/.test(text)) throw new SearchError(`The answer button in ${example} is 1 (Again) to 4 (Easy).`);
  return Number(text);
}

/** `prop:<name><op><value>`, as Anki's parse_prop reads it. */
function propNode(text: string): SearchNode {
  const m = /^(ivl|due|reps|lapses|ease|pos|rated|resched|s|d|r)(<=|>=|!=|=|<|>)(.*)$/i.exec(text);
  if (!m) throw new SearchError('prop: takes a property, a comparison and a number, e.g. prop:ivl>=21 or prop:due<=3.');
  const name = m[1].toLowerCase();
  const op = m[2] as CompareOp;
  const num = m[3];
  if (name === 'rated' || name === 'resched') {
    const [d, button] = num.split(':', 2);
    if (!/^-?\d+$/.test(d)) throw new SearchError(`prop:${name} takes a number of days, e.g. prop:${name}>-7.`);
    if (name === 'resched' && button !== undefined) throw new SearchError('prop:resched takes a number of days, e.g. prop:resched>-7.');
    return { kind: 'rated', op, days: Number(d), ease: name === 'resched' ? 'manual' : answerButton(button, `prop:rated${op}${num}`) };
  }
  const prop = name as PropName;
  const pattern = WHOLE_PROPS.has(prop) ? /^\d+$/ : prop === 'due' ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
  if (!pattern.test(num)) throw new SearchError(`prop:${prop} needs a ${WHOLE_PROPS.has(prop) || prop === 'due' ? 'whole number' : 'number'} after ${op}, e.g. prop:${prop}${op}${prop === 'due' ? '1' : prop === 'r' || prop === 'd' ? '0.9' : prop === 'ease' ? '2.5' : '3'}.`);
  return { kind: 'prop', prop, op, value: Number(num) };
}

class SearchError extends Error {}

type Token = { kind: 'open' } | { kind: 'close' } | { kind: 'not' } | { kind: 'word'; raw: string; quoted: boolean };

/**
 * The search split into words, parentheses and `-`. A word's raw text keeps its backslash escapes
 * (taken off later, once it's known where a `:` splits it) and loses its quotes.
 */
function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const isSpace = (ch: string) => /\s/.test(ch);
  while (i < input.length) {
    const ch = input[i];
    if (isSpace(ch)) { i++; continue; }
    if (ch === '(') { out.push({ kind: 'open' }); i++; continue; }
    if (ch === ')') { out.push({ kind: 'close' }); i++; continue; }
    if (ch === '-' && i + 1 < input.length && !isSpace(input[i + 1])) { out.push({ kind: 'not' }); i++; continue; }
    if (ch === '-') throw new SearchError('"-" needs a search right after it, e.g. -tag:leech.');
    let raw = '';
    let quoted = false;
    while (i < input.length) {
      const c = input[i];
      if (c === '\\' && i + 1 < input.length) { raw += c + input[i + 1]; i += 2; continue; }
      if (c === '"') {
        quoted = true;
        i++;
        let closed = false;
        while (i < input.length) {
          const q = input[i];
          if (q === '\\' && i + 1 < input.length) { raw += q + input[i + 1]; i += 2; continue; }
          if (q === '"') { closed = true; i++; break; }
          raw += q;
          i++;
        }
        if (!closed) throw new SearchError('A quote has no closing quote. Add one at the end of the phrase.');
        continue;
      }
      if (isSpace(c) || c === '(' || c === ')') break;
      raw += c;
      i++;
    }
    out.push({ kind: 'word', raw, quoted });
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A raw piece of a word as a pattern: escapes resolved, unescaped `*` and `_` as wildcards. */
export function glob(raw: string): Glob {
  let text = '';
  let source = '';
  let wild = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length) {
      text += raw[i + 1];
      source += escapeRegExp(raw[i + 1]);
      i++;
    } else if (c === '*' || c === '_') {
      text += c;
      source += c === '*' ? '.*' : '.';
      wild = true;
    } else {
      text += c;
      source += escapeRegExp(c);
    }
  }
  return { text, wild, source };
}

/** Where a word's first unescaped `:` is, or -1. */
function colonAt(raw: string): number {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\') { i++; continue; }
    if (raw[i] === ':') return i;
  }
  return -1;
}

function leaf(raw: string): SearchNode {
  const colon = colonAt(raw);
  if (colon <= 0) return { kind: 'text', glob: glob(raw) };
  const key = glob(raw.slice(0, colon));
  const valueRaw = raw.slice(colon + 1);
  const value = glob(valueRaw);
  const name = key.text.toLowerCase();
  if (UNSUPPORTED.includes(name)) throw new SearchError(`Franki can't search by ${name}: yet. Take it out to search by the rest.`);
  if (name === 'rated' || name === 'resched') {
    const [d, button, extra] = value.text.split(':');
    if (!/^\d+$/.test(d ?? '') || extra !== undefined || (name === 'resched' && button !== undefined)) {
      throw new SearchError(name === 'rated' ? 'rated: takes a number of days and an optional answer button, e.g. rated:7 or rated:7:1.' : 'resched: takes a number of days, e.g. resched:7.');
    }
    const days = Math.max(1, Number(d));
    return { kind: 'rated', op: '>', days: -days, ease: name === 'resched' ? 'manual' : answerButton(button, `rated:${value.text}`) };
  }
  if (name === 'prop') return propNode(value.text);
  if (name === 'deck' || name === 'note' || name === 'tag') {
    if (!value.text) {
      const example = name === 'deck' ? 'a deck name, e.g. deck:Polski' : name === 'tag' ? 'a tag, e.g. tag:verb' : 'a note type, e.g. note:Basic';
      throw new SearchError(`${name}: needs ${example}.`);
    }
    if (name === 'tag' && value.text.toLowerCase() === 'none' && !value.wild) return { kind: 'noTags' };
    return { kind: name, glob: value };
  }
  if (name === 'is') {
    const state = value.text.toLowerCase() as CardStateWord;
    if (!STATES.includes(state)) throw new SearchError('is: takes due, new, learn, review, suspended, buried, buried-manually or buried-sibling.');
    return { kind: 'is', state };
  }
  if (name === 'flag') {
    if (!/^[0-7]$/.test(value.text)) throw new SearchError('flag: takes a number from 0 (no flag) to 7.');
    return { kind: 'flag', flag: Number(value.text) };
  }
  if (name === 'added') {
    if (!/^\d+$/.test(value.text) || Number(value.text) < 1) throw new SearchError('added: takes a number of days, e.g. added:7.');
    return { kind: 'added', days: Number(value.text) };
  }
  return { kind: 'field', field: key, value };
}

/** Reads a search typed in Anki's syntax. Nothing but spaces reads as no search at all. */
export function parseSearch(input: string): ParsedSearch {
  try {
    const tokens = tokenize(input);
    let at = 0;
    const isOp = (t: Token | undefined, op: 'or' | 'and') => t?.kind === 'word' && !t.quoted && t.raw.toLowerCase() === op;
    const orNeedsBothSides = () => new SearchError('"or" needs a search on each side, e.g. tag:verb or tag:noun.');

    const unary = (): SearchNode => {
      const t = tokens[at];
      if (!t) throw new SearchError('"-" needs a search right after it, e.g. -tag:leech.');
      if (t.kind === 'not') {
        at++;
        if (!tokens[at] || tokens[at].kind === 'close' || isOp(tokens[at], 'or')) throw new SearchError('"-" needs a search right after it, e.g. -tag:leech.');
        return { kind: 'not', part: unary() };
      }
      if (t.kind === 'open') {
        at++;
        if (tokens[at]?.kind === 'close') throw new SearchError('"()" has nothing inside. Put a search between them, or take them out.');
        const inner = orExpr();
        if (tokens[at]?.kind !== 'close') throw new SearchError('A "(" has no ")" to close it. Add one, or take the "(" out.');
        at++;
        return inner;
      }
      if (t.kind === 'close') throw new SearchError('A ")" has no "(" before it. Take it out, or add the "(".');
      at++;
      return leaf(t.raw);
    };

    const andExpr = (): SearchNode => {
      const parts: SearchNode[] = [];
      while (at < tokens.length && tokens[at].kind !== 'close' && !isOp(tokens[at], 'or')) {
        if (isOp(tokens[at], 'and')) {
          if (!parts.length) throw new SearchError('"and" needs a search on each side, e.g. tag:verb and is:new.');
          at++;
          if (at >= tokens.length || tokens[at].kind === 'close' || isOp(tokens[at], 'or') || isOp(tokens[at], 'and')) {
            throw new SearchError('"and" needs a search on each side, e.g. tag:verb and is:new.');
          }
          continue;
        }
        parts.push(unary());
      }
      if (!parts.length) throw orNeedsBothSides();
      return parts.length === 1 ? parts[0] : { kind: 'and', parts };
    };

    const orExpr = (): SearchNode => {
      const parts = [andExpr()];
      while (isOp(tokens[at], 'or')) {
        at++;
        if (at >= tokens.length || tokens[at].kind === 'close' || isOp(tokens[at], 'or')) throw orNeedsBothSides();
        parts.push(andExpr());
      }
      return parts.length === 1 ? parts[0] : { kind: 'or', parts };
    };

    if (!tokens.length) return { ok: true };
    const node = orExpr();
    if (at < tokens.length) throw new SearchError('A ")" has no "(" before it. Take it out, or add the "(".');
    return { ok: true, node };
  } catch (e) {
    if (e instanceof SearchError) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * The plain words of a search that a note is meant to hold (not under a `-`, and without
 * wildcards): what Browse ranks its results by, closest match first.
 */
export function rankedWords(node: SearchNode | undefined): string[] {
  if (!node) return [];
  if (node.kind === 'and' || node.kind === 'or') return node.parts.flatMap(rankedWords);
  if (node.kind === 'text' && !node.glob.wild) return [node.glob.text];
  return [];
}

export interface SearchContext {
  now: Date;
  dayStartsAtHour: number;
  /** Whether a note holds a plain word of the search (`text`), as Browse matches one. */
  textMatches: (note: Note, text: Glob) => boolean;
  /** A card's answers (time in ms, button pressed), for `rated:`; without it nothing was answered. */
  answersOf?: (card: Card) => { at: number; ease: number }[];
  /** A card's retrievability now, for `prop:r`; undefined when it has no memory state. */
  retrievabilityOf?: (card: Card) => number | undefined;
}

/**
 * The parts of a search Browse can't answer from Franki's own copy of a card, with the reason: Anki's
 * ease (FSRS doesn't keep one), manual reschedules (`resched:`, which Franki's answers don't log) and
 * which kind of bury a card is under. A filtered deck reads them from the collection
 * (`matchesAnkiRow`, ankiRowSearch.ts), so only Browse refuses them.
 */
export function browseProblem(node: SearchNode | undefined): string | undefined {
  if (!node) return undefined;
  switch (node.kind) {
    case 'and': case 'or': for (const p of node.parts) { const e = browseProblem(p); if (e) return e; } return undefined;
    case 'not': return browseProblem(node.part);
    case 'prop': return node.prop === 'ease' ? "Browse can't search by prop:ease: Franki schedules with FSRS, which keeps no ease. A filtered deck can use it." : undefined;
    case 'rated': return node.ease === 'manual' ? "Browse can't search by resched: yet. A filtered deck can use it." : undefined;
    case 'is': return node.state === 'buried-manually' || node.state === 'buried-sibling'
      ? `Browse can't search by is:${node.state} yet. Use is:buried, or a filtered deck.` : undefined;
    default: return undefined;
  }
}

/** Whether a search reads cards' answers (`rated:`), so a caller loads them only then. */
export function readsAnswers(node: SearchNode | undefined): boolean {
  if (!node) return false;
  if (node.kind === 'and' || node.kind === 'or') return node.parts.some(readsAnswers);
  if (node.kind === 'not') return readsAnswers(node.part);
  return node.kind === 'rated';
}

/** `a op b`. */
export function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case '=': return a === b;
    case '!=': return a !== b;
  }
}

/**
 * Whether an answer at `atMs` falls in `rated:`'s span, as Anki's write_rated compares the review
 * log's id with the start of the study day `days` days from the next one (`nextDayAtMs`).
 */
export function ratedSpan(atMs: number, op: CompareOp, days: number, nextDayAtMs: number): boolean {
  const target = nextDayAtMs + 86_400_000 * days;
  const dayBefore = nextDayAtMs + 86_400_000 * (days - 1);
  switch (op) {
    case '>': return atMs >= target;
    case '>=': return atMs >= dayBefore;
    case '<': return atMs < dayBefore;
    case '<=': return atMs < target;
    case '=': return atMs >= dayBefore && atMs <= target - 1;
    case '!=': return !(atMs >= dayBefore && atMs <= target - 1);
  }
}

/** Whether a button pressed matches `rated:`'s: that button, any (not a manual reschedule), or a manual reschedule. */
export const ratedEase = (ease: number, want: number | 'any' | 'manual') => (want === 'any' ? ease > 0 : want === 'manual' ? ease === 0 : ease === want);

const whole = (g: Glob) => new RegExp(`^${g.source}$`, 'isu');
/** A deck's or tag's name, or one under it (`Polski` holds `Polski::Odmiana`). */
const withChildren = (g: Glob) => new RegExp(`^${g.source}(::.*)?$`, 'isu');

/**
 * Whether a note (its cards' search: one of its live cards matches the whole search) matches. A
 * note with no live card is checked once with no card, so a search about cards finds nothing in
 * it and its negation finds it.
 */
export function matchesSearch(node: SearchNode, note: Note, cards: readonly Card[], ctx: SearchContext): boolean {
  const live = cards.filter((c) => !c.retired);
  if (!live.length) return evaluate(node, note, undefined, ctx);
  return live.some((card) => evaluate(node, note, card, ctx));
}

function evaluate(node: SearchNode, note: Note, card: Card | undefined, ctx: SearchContext): boolean {
  switch (node.kind) {
    case 'and': return node.parts.every((p) => evaluate(p, note, card, ctx));
    case 'or': return node.parts.some((p) => evaluate(p, note, card, ctx));
    case 'not': return !evaluate(node.part, note, card, ctx);
    case 'text': return ctx.textMatches(note, node.glob);
    case 'deck': {
      const re = withChildren(node.glob);
      // A card in an Anki filtered deck is in that deck and still in its home deck, as Anki's deck: reads both.
      const decks = card ? [card.deck ?? note.deck, card.filteredDeck] : [note.deck];
      return decks.some((d) => !!d && re.test(d));
    }
    case 'tag': {
      const re = withChildren(node.glob);
      return note.tags.some((t) => re.test(t));
    }
    case 'noTags': return note.tags.length === 0;
    case 'note': return whole(node.glob).test(note.model);
    case 'field': {
      const name = whole(node.field);
      const value = whole(node.value);
      return Object.entries(note.fields).some(([k, v]) => name.test(k) && value.test(htmlToText(v).trim()));
    }
    case 'added': {
      const since = studyDayStart(addCalendarDays(ctx.now, -(node.days - 1)), ctx.dayStartsAtHour).getTime();
      return noteAddedAt(note) >= since;
    }
    case 'flag': return !!card && (card.flag ?? 0) === node.flag;
    case 'is': return !!card && cardIs(node.state, card, ctx);
    case 'rated': {
      if (!card || !ctx.answersOf) return false;
      const next = nextStudyDayStart(ctx.now, ctx.dayStartsAtHour).getTime();
      return ctx.answersOf(card).some((a) => ratedEase(a.ease, node.ease) && ratedSpan(a.at, node.op, node.days, next));
    }
    case 'prop': return !!card && cardProp(node, card, ctx);
  }
}

/** `prop:` on Franki's copy of a card, read as Anki reads the same columns (sqlwriter.rs, write_prop). */
function cardProp(node: Extract<SearchNode, { kind: 'prop' }>, card: Card, ctx: SearchContext): boolean {
  const s = card.sched;
  const { op, value } = node;
  switch (node.prop) {
    case 'ivl': return compare(s.state === 2 || s.state === 3 ? s.scheduledDays : 0, op, value);
    case 'reps': return compare(s.reps, op, value);
    case 'lapses': return compare(s.lapses, op, value);
    case 'pos': return s.state === 0 && card.position !== undefined && compare(card.position, op, value);
    case 'due': {
      if (card.suspended || s.state === 0) return false;
      const due = new Date(s.due);
      // A review (or a step on a later day) by study days from today; a step today by whole days from the next day's start, as Anki's integer division gives.
      if (s.state === 2 || (s.state !== 1 && s.state !== 3)) {
        const days = Math.round((studyDayStart(due, ctx.dayStartsAtHour).getTime() - studyDayStart(ctx.now, ctx.dayStartsAtHour).getTime()) / 86_400_000);
        return compare(days, op, value);
      }
      return compare(Math.trunc((due.getTime() - nextStudyDayStart(ctx.now, ctx.dayStartsAtHour).getTime()) / 86_400_000), op, value);
    }
    case 's': return s.state !== 0 && compare(s.stability, op, value);
    case 'd': return s.state !== 0 && compare(s.difficulty, op, value * 9 + 1);
    case 'r': {
      if (s.state === 0) return false;
      const r = ctx.retrievabilityOf?.(card);
      return r !== undefined && compare(r, op, value);
    }
    case 'ease': return false; // refused in Browse (browseProblem)
  }
}

/**
 * A card's state as Anki's `is:` reads it. `new`, `learn` and `review` are the card's type, so a
 * suspended new card is still new (Anki's `is:new`, unlike Browse's New chip). `due` is a card that
 * can be studied today: not suspended or buried, a review or step due before the next study day
 * starts (the Due today chip's rule, `matchesNoteFilter`). `review` includes relearning cards, as
 * Anki's does.
 */
function cardIs(state: CardStateWord, card: Card, ctx: SearchContext): boolean {
  const s = card.sched.state;
  switch (state) {
    case 'new': return s === 0;
    case 'learn': return s === 1 || s === 3;
    case 'review': return s === 2 || s === 3;
    case 'suspended': return card.suspended;
    case 'buried': case 'buried-manually': case 'buried-sibling': return !card.suspended && isBuried(card, ctx.now, ctx.dayStartsAtHour);
    case 'due': {
      if (card.suspended || s === 0 || isBuried(card, ctx.now, ctx.dayStartsAtHour)) return false;
      return new Date(card.sched.due).getTime() < nextStudyDayStart(ctx.now, ctx.dayStartsAtHour).getTime();
    }
  }
}
