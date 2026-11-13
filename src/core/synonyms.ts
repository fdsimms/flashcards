import { isOmnilanguage, speechLangFor } from './cards';
import { headword, withoutArticle } from './forms';
import { htmlToText } from './html';
import type { Note } from './types';

/**
 * Synonyms: Omnilanguage notes in one language with the same Meaning (esperar and aguardar, both
 * "to wait"; WaniKani's 大きい and 大きな, both "big"). A reverse card shows only the meaning, so
 * without help the learner can't tell which of them is wanted, and gives the other one. The
 * reverse card's front says which (`wantedLine`): the note's own part of speech and register
 * when they set it apart, else the other words it isn't ("Not: aguardar").
 */

/** How many of the other words "Not:" names before counting the rest. */
const MAX_NAMED = 3;

/** The note's language, as `lookalikes.ts` takes it: its speech tag, else its deck's top two levels. */
function language(note: Note): string {
  return speechLangFor(note) ?? note.deck.split('::').slice(0, 2).join('::');
}

/**
 * A Meaning as the set of meanings it lists: markup stripped, lower case, split on ";", "," and
 * line breaks, each one trimmed with its spaces collapsed.
 */
export function meaningSet(meaning: string): Set<string> {
  const parts = htmlToText(meaning).toLocaleLowerCase().split(/[;,\n]/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return new Set(parts);
}

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));

/** Two Meanings are the same when their sets of meanings are equal or one holds the other ("to wait" and "to wait; to hope"). */
export function sameMeaning(a: Set<string>, b: Set<string>): boolean {
  return a.size > 0 && b.size > 0 && (isSubset(a, b) || isSubset(b, a));
}

/** The word as "Not:" names it: the Entry as text, without its article. */
export function bareEntry(note: Note): string {
  return withoutArticle(headword(note));
}

/**
 * Each Omnilanguage note's synonyms, by note id: the other notes in its language whose Meaning is
 * the same (`sameMeaning`). A note with the same word (a duplicate or a homograph) isn't one: it
 * asks for the same answer. Notes with none aren't in the map.
 */
export function synonymIndex(notes: Iterable<Note>): Map<string, Note[]> {
  type Entry = { note: Note; meanings: Set<string>; word: string };
  // By language, then by each meaning listed: two notes with the same Meaning share at least one.
  const byLang = new Map<string, Map<string, Entry[]>>();
  const entries: { lang: string; e: Entry }[] = [];
  for (const note of notes) {
    if (!isOmnilanguage(note)) continue;
    const meanings = meaningSet(note.fields.Meaning ?? '');
    if (!meanings.size) continue;
    const lang = language(note);
    const e = { note, meanings, word: bareEntry(note).toLocaleLowerCase() };
    entries.push({ lang, e });
    const byMeaning = byLang.get(lang) ?? byLang.set(lang, new Map()).get(lang)!;
    for (const m of meanings) (byMeaning.get(m) ?? byMeaning.set(m, []).get(m)!).push(e);
  }
  const out = new Map<string, Note[]>();
  for (const { lang, e } of entries) {
    const seen = new Set<string>([e.note.id]);
    const found: Note[] = [];
    for (const m of e.meanings) {
      for (const o of byLang.get(lang)!.get(m)!) {
        if (seen.has(o.note.id)) continue;
        seen.add(o.note.id);
        if (o.word !== e.word && sameMeaning(e.meanings, o.meanings)) found.push(o.note);
      }
    }
    if (found.length) out.set(e.note.id, found);
  }
  return out;
}

/** The note's part of speech, register and dialect, as written. */
function tagsOf(note: Note): string[] {
  return ['PartOfSpeech', 'Register', 'Dialect'].map((f) => htmlToText(note.fields[f] ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/**
 * The line on a reverse card's front that says which word is wanted, given the note's synonyms:
 * its own part of speech and register ("verb · formal") when no synonym has all of them too, so
 * they rule every other one out; otherwise the synonyms' words ("Not: aguardar"), which names
 * words that aren't the answer and so gives nothing away. Undefined with no synonyms.
 */
export function wantedLine(note: Note, synonyms: readonly Note[] | undefined): string | undefined {
  if (!synonyms?.length) return undefined;
  const own = tagsOf(note);
  const lower = (tags: string[]) => new Set(tags.map((t) => t.toLocaleLowerCase()));
  const ownSet = lower(own);
  if (own.length && synonyms.every((s) => !isSubset(ownSet, lower(tagsOf(s))))) return own.join(' · ');
  const self = bareEntry(note).toLocaleLowerCase();
  const words: string[] = [];
  for (const s of synonyms) {
    const w = bareEntry(s);
    if (w && w.toLocaleLowerCase() !== self && !words.some((x) => x.toLocaleLowerCase() === w.toLocaleLowerCase())) words.push(w);
  }
  if (!words.length) return undefined;
  words.sort((a, b) => a.localeCompare(b));
  const named = words.slice(0, MAX_NAMED).join(', ');
  const rest = words.length - MAX_NAMED;
  return rest > 0 ? `Not: ${named}, and ${rest} more` : `Not: ${named}`;
}

/** Each note's `wantedLine`, by note id, for the notes that have one. Built once per session. */
export function wantedLines(notes: Iterable<Note>): Map<string, string> {
  const list = [...notes];
  const byId = new Map(list.map((n) => [n.id, n]));
  const out = new Map<string, string>();
  for (const [id, synonyms] of synonymIndex(list)) {
    const line = wantedLine(byId.get(id)!, synonyms);
    if (line) out.set(id, line);
  }
  return out;
}
