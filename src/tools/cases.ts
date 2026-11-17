import { isOmnilanguage, speechLangFor } from '../core/cards';
import { checkAnswer, formsOf, headword, type Verdict } from '../core/forms';
import { htmlToText } from '../core/html';
import type { Note } from '../core/types';
import type { Language } from '../reader/api';
import { GERMAN_CASES } from './german/cases';
import { GREEK_CASES } from './greek/cases';
import { POLISH_CASES } from './polish/cases';
import { RUSSIAN_CASES } from './russian/cases';

/**
 * Which case: the case a preposition or a verb takes (bez: the genitive), picked from the
 * language's cases, then a studied noun put in it ("bez ___", ten czas: czasu). The second step's
 * noun and its form come from the note's Forms field (src/core/forms.ts, `accusative · singular:
 * ptaka`), so it's asked only for nouns whose cases are listed; with none, the answer says so.
 * Nothing here grades or writes a card: a word missing from the deck is offered to the note
 * editor, where saving is the approval.
 */

/** A case a word can take, as the Forms field's groups name it. */
export type GovernedCase = 'genitive' | 'dative' | 'accusative' | 'instrumental' | 'locative' | 'prepositional';

/** A preposition, verb or phrase and the case that follows it. */
export interface Governor {
  /** As said before the noun: "bez", "dzwonić do". */
  word: string;
  meaning: string;
  kind: 'preposition' | 'verb' | 'phrase';
  case: GovernedCase;
  /** What tells it apart from the same word taking another case: "motion", "location". */
  sense?: string;
  /** Only a person makes sense after it (pomagać, być as a role), so step 2 draws people. */
  person?: true;
  /** The word as the deck writes it when that isn't `word` ("dzwonić" for "dzwonić do"). */
  entry?: string;
}

export interface CaseLanguage {
  /** The cases its words take, in the order the choices show them. */
  cases: GovernedCase[];
  governors: Governor[];
}

export const CASE_LANGUAGES: Partial<Record<Language, CaseLanguage>> = {
  pl: POLISH_CASES,
  ru: RUSSIAN_CASES,
  de: GERMAN_CASES,
  el: GREEK_CASES,
};

/** Tags that mark a noun as a person, for a word only a person follows. */
const PERSON_TAGS = ['people', 'person', 'family', 'profession'];

/** A governor's id, for the marks and for asking it again: its word, and its sense where it has one. */
export const governorId = (g: Governor): string => (g.sense ? `${g.word} (${g.sense})` : g.word);

/** How a governor is shown: "na (motion)". */
export const governorLabel = governorId;

export const caseName = (c: GovernedCase): string => c[0].toUpperCase() + c.slice(1);

/** One noun the second step can put in a case: its note and each case's form. */
export interface CaseNoun {
  note: Note;
  headword: string;
  meaning: string;
  person: boolean;
  /** Accepted answers by case: the singular, or the plural for a noun with no singular. */
  forms: Partial<Record<GovernedCase, string[]>>;
}

const lang = (note: Note) => speechLangFor(note)?.split('-')[0];
const text = (html: string | undefined) => htmlToText(html ?? '').replace(/\s+/g, ' ').trim();

/**
 * The nouns being studied in `language` whose Forms field lists a case (`studied`: note ids with
 * a card past new). A case's singular is taken, else its plural (te buty).
 */
export function caseNouns(notes: Iterable<Note>, studied: ReadonlySet<string>, language: Language): CaseNoun[] {
  const cases = new Set<string>(CASE_LANGUAGES[language]?.cases ?? []);
  const out: CaseNoun[] = [];
  for (const note of notes) {
    if (!isOmnilanguage(note) || !studied.has(note.id) || lang(note) !== language) continue;
    const forms: CaseNoun['forms'] = {};
    for (const f of formsOf(note).forms) {
      if (!cases.has(f.group)) continue;
      const c = f.group as GovernedCase;
      if (f.label === 'singular' || (f.label === 'plural' && !forms[c])) forms[c] = f.answers;
    }
    if (!Object.keys(forms).length) continue;
    out.push({
      note,
      headword: headword(note),
      meaning: text(note.fields.Meaning),
      person: note.tags.some((t) => PERSON_TAGS.includes(t.toLowerCase())),
      forms,
    });
  }
  return out;
}

/** A noun for a governor's second step, or none when no studied noun has that case listed. */
export function nounFor(g: Governor, nouns: CaseNoun[], random: () => number = Math.random): CaseNoun | undefined {
  const fit = nouns.filter((n) => n.forms[g.case] && (!g.person || n.person));
  return fit.length ? fit[Math.floor(random() * fit.length)] : undefined;
}

/** The next governor, never the one just asked (`previous`, by id) while there's another. */
export function drawGovernor(language: CaseLanguage, previous: string | undefined, random: () => number = Math.random): Governor {
  const pool = language.governors.length > 1 ? language.governors.filter((g) => governorId(g) !== previous) : language.governors;
  return pool[Math.floor(random() * pool.length)];
}

/** The patterns a question is marked under (marks.ts): the word itself, and its case. */
export const casePatterns = (g: Governor): string[] => [`word:${governorId(g)}`, `case:${g.case}`];

/** The typed noun against its form in the governor's case. */
export function checkCaseForm(typed: string, g: Governor, noun: CaseNoun): Verdict {
  return checkAnswer(typed, noun.forms[g.case] ?? []);
}

/**
 * The answer's rule: "bez takes the genitive.", with the sense where the word takes more than one
 * case ("na takes the accusative for motion."), and up to four other words of the same kind that
 * take it.
 */
export function caseRule(language: CaseLanguage, g: Governor): string {
  const head = `${g.word} takes the ${g.case}${g.sense ? ` for ${g.sense}` : ''}.`;
  const also = [...new Set(language.governors
    .filter((o) => o.case === g.case && o.kind === g.kind && o.word !== g.word)
    .map((o) => o.word))].slice(0, 4);
  return also.length ? `${head} So do ${also.join(', ')}.` : head;
}

/** The word as a deck entry would hold it, for finding it there. */
const entryOf = (g: Governor) => (g.entry ?? g.word).toLocaleLowerCase();

/** Whether `language`'s notes hold the governor as an entry ("dzwonić / zadzwonić" holds dzwonić). */
export function inDeck(g: Governor, notes: Iterable<Note>, language: Language): boolean {
  const want = entryOf(g);
  for (const note of notes) {
    if (!isOmnilanguage(note) || lang(note) !== language) continue;
    if (text(note.fields.Entry).toLocaleLowerCase().split(/\s*\/\s*/).includes(want)) return true;
  }
  return false;
}

/** The deck most of `language`'s notes are in, for a note added from here; none when it has no notes. */
export function languageDeck(notes: Iterable<Note>, language: Language): string | undefined {
  const counts = new Map<string, number>();
  for (const note of notes) if (isOmnilanguage(note) && lang(note) === language) counts.set(note.deck, (counts.get(note.deck) ?? 0) + 1);
  let best: string | undefined;
  for (const [deck, n] of counts) if (!best || n > counts.get(best)!) best = deck;
  return best;
}

/**
 * The note the editor opens with for a governor not in the deck: its entry, meaning and case, and
 * every case the same entry takes ("Takes the accusative for motion, the locative for location."),
 * since one note stands for both senses.
 */
export function governorNote(language: CaseLanguage, g: Governor, languageField: string): { fields: Record<string, string>; tags: string[] } {
  const same = language.governors.filter((o) => entryOf(o) === entryOf(g));
  const takes = same.map((o) => `the ${o.case}${o.sense ? ` for ${o.sense}` : ''}`).join(', ');
  return {
    fields: {
      Entry: g.entry ?? g.word,
      Meaning: same.map((o) => o.meaning).filter((m, i, all) => all.indexOf(m) === i).join('; '),
      Language: languageField,
      PartOfSpeech: g.kind,
      Notes: `Takes ${takes}.`,
    },
    tags: [g.kind],
  };
}
