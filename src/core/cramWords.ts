import type { CramPhrasesRequest, CramWordsRequest, Language } from '../reader/api';
import { registerChoice, type RegisterLevel } from '../reader/registerLevel';
import type { Particle } from '../reader/lessons';
import { textKey, themeTopic, type Cram, type CramPhrase } from './cram';
import { wordKey } from './cramThemes';
import { headword } from './forms';
import type { LessonWordCandidate } from './lessonWords';
import { readerLanguageOf } from './leechHint';
import type { Note } from './types';

/**
 * Suggest words, on a cram's page: Claude names words for what the cram is for (server cram_words.py),
 * and this works out what each would do. A word the deck already has is tagged into the cram; one it
 * lacks goes to the note queue for Claude to write a card, which the learner approves. Nothing here
 * writes a note or grades a card.
 */

/** The longest focus the field takes (the server's `MAX_TEXT`). */
export const SUGGEST_FOCUS_CHARS = 200;
/** The most words sent to be left out (the server's `MAX_EXCLUDED`): the newest. */
export const SUGGEST_EXCLUDE_MAX = 150;
/** What really happened, cut to what the server takes. */
const FACTS_CHARS = 400;

/** One suggested word: what Claude gave, and the deck's note for it when the deck has one. */
export interface SuggestedWord {
  candidate: LessonWordCandidate;
  /** The note in the language with this word, not yet in the cram; absent for a word that needs a card. */
  note?: Note;
}

/** The words Claude is told to leave out: the cram's own, the ones already asked for, and those already shown, the newest kept. */
export function wordsToLeaveOut(cram: Pick<Cram, 'requested'>, inCram: Note[], shown: LessonWordCandidate[]): string[] {
  const all = [...inCram.map((n) => headword(n)), ...(cram.requested ?? []).map((r) => r.text), ...shown.map((w) => w.text)]
    .map((w) => w.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return [...new Set(all)].slice(-SUGGEST_EXCLUDE_MAX);
}

/** What to send: the cram's own subject (nothing for an untitled cram, whose stand-in name says nothing), what happened, the learner's steer and what to leave out. */
export function cramWordsRequest(language: Language, cram: Pick<Cram, 'name' | 'untitled' | 'facts'>, focus: string, exclude: string[]): CramWordsRequest {
  return {
    language,
    topic: themeTopic(cram),
    facts: (cram.facts ?? '').replace(/\s+/g, ' ').trim().slice(0, FACTS_CHARS),
    focus: focus.replace(/\s+/g, ' ').trim().slice(0, SUGGEST_FOCUS_CHARS),
    exclude,
  };
}

/**
 * Each candidate with the deck's note for it, matched by its word among the notes in `language`
 * (the way a theme's deck words are). A word whose note is already in the cram, or that is already
 * being written for it, or that repeats an earlier one, is left out.
 */
export function suggestedWords(candidates: LessonWordCandidate[], notes: Note[], cram: Pick<Cram, 'requested'>, inCram: Note[], language: Language): SuggestedWord[] {
  const inCramIds = new Set(inCram.map((n) => n.id));
  const asked = new Set((cram.requested ?? []).map((r) => textKey(r.text)));
  const byWord = new Map<string, Note>();
  for (const n of notes) {
    if (readerLanguageOf(n) !== language) continue;
    const key = wordKey(headword(n));
    if (key && !byWord.has(key)) byWord.set(key, n);
  }
  const seen = new Set<string>();
  const out: SuggestedWord[] = [];
  for (const candidate of candidates) {
    const key = wordKey(candidate.text);
    if (!key || seen.has(key) || asked.has(textKey(candidate.text))) continue;
    seen.add(key);
    const note = byWord.get(key);
    if (note && inCramIds.has(note.id)) continue;
    out.push({ candidate, note });
  }
  return out;
}

/** What Add will do with the checked words, for its button and the line under it: "Add 3 words" and "1 from your deck. 2 new cards for Claude to write." */
export function addSummary(checked: SuggestedWord[]): { label: string; detail: string } {
  const have = checked.filter((w) => w.note).length;
  const fresh = checked.length - have;
  const parts = [have ? `${have} from your deck.` : '', fresh ? `${fresh === 1 ? '1 new card' : `${fresh} new cards`} for Claude to write.` : ''].filter(Boolean);
  return { label: checked.length === 1 ? 'Add 1 word' : `Add ${checked.length} words`, detail: parts.join(' ') };
}

/** How many of the cram's words are sent for the phrases to use (the server's `MAX_WORDS`), the shakiest first as the caller orders them. */
export const SUGGEST_PHRASE_WORDS = 40;
/** How many phrases already on the cram or shown are sent to be left out (the server's `MAX_EXCLUDED`): the newest. */
export const SUGGEST_PHRASE_EXCLUDE = 100;

/** The phrases Claude is told to leave out: the cram's own and the ones already shown, once each, the newest kept. */
export function phrasesToLeaveOut(cram: Pick<Cram, 'phrases'>, shown: { text: string }[]): string[] {
  const all = [...(cram.phrases ?? []).map((p) => p.text), ...shown.map((p) => p.text)].map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Set(all)].slice(-SUGGEST_PHRASE_EXCLUDE);
}

/** What Phrases mode sends: the cram's subject and what happened, the learner's steer, the cram's words (text and meaning) to build from, what to leave out, and, as for talking points, the cram's own register and the Thai learner's polite ending. */
export function cramPhrasesRequest(
  language: Language,
  cram: Pick<Cram, 'name' | 'untitled' | 'facts' | 'register' | 'phrases'>,
  focus: string,
  words: { text: string; english: string }[],
  shown: CramPhrase[],
  particle?: Particle,
): CramPhrasesRequest {
  return {
    language,
    topic: themeTopic(cram),
    facts: (cram.facts ?? '').replace(/\s+/g, ' ').trim().slice(0, FACTS_CHARS),
    focus: focus.replace(/\s+/g, ' ').trim().slice(0, SUGGEST_FOCUS_CHARS),
    words: words.slice(0, SUGGEST_PHRASE_WORDS).map((w) => ({ text: w.text, english: w.english })),
    exclude: phrasesToLeaveOut(cram, shown),
    ...registerChoice(cram.register as RegisterLevel | undefined),
    ...(language === 'th' && particle ? { particle } : {}),
  };
}
