import { NOTE_LANGUAGES, speechLangFor } from './cards';
import { retrievability } from './order';
import { isSkillNote } from './skillTag';
import { MATURE_DAYS } from './stats';
import type { Card, Note } from './types';

/**
 * Words you know, on Stats: for each language, how many words have been studied and about how many
 * of them would be remembered today. A word is a note in the language (its Language field, else
 * its deck's name, as its voice is chosen), counted once however many cards it has; a note with no
 * language (trivia) is no word. Skill cards are practice, not words, and a card that's suspended or
 * that its note no longer makes isn't counted, so a note with no other card isn't either.
 *
 * The estimate adds up, over the studied words, how likely each is to be recalled now by FSRS,
 * going by its best-known card: a word is known if either way of asking it would be answered.
 * Display only: nothing here schedules, grades or writes a card.
 */
export interface LanguageWords {
  /** The language's speech tag (`pl-PL`), which tells one from another. */
  tag: string;
  /** Its name in English. */
  name: string;
  /** Every word counted in the language, studied or not. */
  words: number;
  /** Words with a card that has left the new state. */
  studied: number;
  /** Words with a card whose reviews are `MATURE_DAYS` or more apart. */
  mature: number;
  /** About how many of the studied words would be remembered now. */
  estimate: number;
}

const nameOf = (tag: string): string => NOTE_LANGUAGES.find((l) => l.tag === tag)?.name ?? tag;

/**
 * Each language's words, the best known first. `cards` are the ones in view (a deck picked on
 * Stats narrows them); `weightsOf` gives a card's FSRS weights, which set how fast it's forgotten.
 */
export function wordsKnown(input: { notes: Note[]; cards: Card[]; now: Date; weightsOf: (card: Card, note: Note) => number[] }): LanguageWords[] {
  const noteOf = new Map(input.notes.map((n) => [n.id, n]));
  // Per note: whether any card is studied or mature, and its best card's chance of recall.
  const byNote = new Map<string, { note: Note; tag: string; studied: boolean; mature: boolean; recall: number }>();
  for (const card of input.cards) {
    if (card.retired || card.suspended) continue;
    const note = noteOf.get(card.noteId);
    if (!note || isSkillNote(note)) continue;
    const tag = speechLangFor(note);
    if (!tag) continue;
    const word = byNote.get(note.id) ?? { note, tag, studied: false, mature: false, recall: 0 };
    if (card.sched.state !== 0) {
      word.studied = true;
      if (card.sched.state === 2 && card.sched.scheduledDays >= MATURE_DAYS) word.mature = true;
      word.recall = Math.max(word.recall, retrievability(card, input.now, input.weightsOf(card, note)) ?? 0);
    }
    byNote.set(note.id, word);
  }
  const byLanguage = new Map<string, LanguageWords & { sum: number }>();
  for (const word of byNote.values()) {
    const l = byLanguage.get(word.tag) ?? { tag: word.tag, name: nameOf(word.tag), words: 0, studied: 0, mature: 0, estimate: 0, sum: 0 };
    l.words += 1;
    if (word.studied) { l.studied += 1; l.sum += word.recall; }
    if (word.mature) l.mature += 1;
    byLanguage.set(word.tag, l);
  }
  return [...byLanguage.values()]
    .map(({ sum, ...l }) => ({ ...l, estimate: Math.round(sum) }))
    .sort((a, b) => b.estimate - a.estimate || b.studied - a.studied || a.name.localeCompare(b.name));
}

/** The line under a language's estimate: "1,312 studied · 968 mature · 412 not started". */
export function wordsLine(l: LanguageWords): string {
  return [`${l.studied.toLocaleString()} studied`, `${l.mature.toLocaleString()} mature`, `${(l.words - l.studied).toLocaleString()} not started`].join(' · ');
}
