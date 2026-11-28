import { NOTE_GONE, Refusal } from '../core/failure';
import type { AnkiLink } from '../db/ankiLink';
import type { Language } from '../reader/api';
import type { Note, NoteType } from '../core/types';
import { headword } from '../core/forms';
import { setAsideOf, SKILL_COVERED_TAG, SKILL_STOPPED_TAG } from '../core/skillTag';
import { drillOfTags, stepWaits, SKILL_NOTE_TYPE, SKILL_TAG, SKILLS_SUBDECK, skillDrafts, skillWordDrafts, type SkillDraft, type SkillGroup } from '../tools/skills';
import { knownAmong } from '../tools/knownWords';
import { SKILL_WORD_NOTE_TYPE, type SkillWordDraft } from '../tools/skillWords';
import { ensureDeck } from './deckService';
import { deleteNote, NoteRefused, saveNote, setCardStates, type NoteStore } from './noteService';

/**
 * Adding skill cards (src/tools/skills.ts) to a deck: Basic notes in its `::Skills` subdeck, made
 * there if it isn't yet, each through `saveNote` as any note is, so Anki and sync carry them. A later
 * drill step is suspended once added, and Review releases it when the step before settles. Run only
 * from Add now, after the learner has seen what it adds: that tap is the approval. The MCP's hourly job
 * (server/mcp/franki_mcp/skills.py) adds the same cards for a deck whose automatic switch is on, which
 * is its approval (skillSettings.ts).
 */

/** Skill cards that can't be added, with the reason to show. */
export class SkillsRefused extends Refusal {}

export interface SkillAdd {
  deck: string;
  language: Language;
  languageName: string;
  groups: SkillGroup[];
  dayStartsAtHour: number;
  /** Reads Franki's decks from the kept collection again, after a deck is made there. */
  refresh: () => Promise<void>;
  /** How far it's got: the notes done and the notes to do, skill cards and words together. */
  onProgress?: (done: number, total: number) => void;
  now?: Date;
}

/**
 * The words `groups` need that the deck lacks. A word the deck has already, studied or not, in any
 * subdeck, is left alone (`knownAmong` reads "luty, miesiąc" as having "luty"), so a skill never
 * duplicates a word the learner added themselves.
 */
export const missingWordDrafts = (notes: Iterable<Note>, deck: string, language: Language, groups: SkillGroup[]): SkillWordDraft[] => {
  const drafts = skillWordDrafts(language, groups);
  if (!drafts.length) return [];
  const have = [...notes].filter((n) => !n.tags.includes(SKILL_TAG) && (n.deck === deck || n.deck.startsWith(`${deck}::`))).map((n) => headword(n));
  const known = knownAmong(drafts.map((d) => d.fields.Entry), have);
  return drafts.filter((_, i) => !known[i]);
};

/** Whether the words a skill needs can be written: the collection has the note type they're written in, with the fields they use. */
export const canWriteWords = (type: NoteType | undefined): type is NoteType => !!type && type.fields.includes('Entry') && type.fields.includes('Meaning');

/**
 * Adds what `groups` writes, skipping a card the deck already has, and the words those skills need that
 * the deck lacks (`missingWordDrafts`), as ordinary notes in the same `::Skills` subdeck. Returns the
 * deck, how many cards and how many words were added, how many words couldn't be (the collection has no
 * note type to write them in), and how many cards were already there.
 */
export async function addSkillCards(store: NoteStore & Pick<AnkiLink, 'setAnkiCardStates'>, add: SkillAdd): Promise<{ deck: string; added: number; words: number; wordsSkipped: number; skipped: number }> {
  const now = add.now ?? new Date();
  const basic = (await store.listNoteTypes()).get(SKILL_NOTE_TYPE);
  if (!basic || !basic.fields.includes('Front') || !basic.fields.includes('Back')) {
    throw new SkillsRefused(`Skill cards need a ${SKILL_NOTE_TYPE} note type with Front and Back fields, and your collection doesn't have one. In Anki on your computer, add one (Tools, Manage Note Types, Add, then Add: Basic), sync, and try again.`);
  }
  const drafts = skillDrafts(add.language, add.languageName, add.groups);
  if (!drafts.length) throw new SkillsRefused('There are no skill cards to add for this deck yet.');
  const wanted = missingWordDrafts(await store.listNotes(), add.deck, add.language, add.groups);
  const wordType = wanted.length ? (await store.listNoteTypes()).get(SKILL_WORD_NOTE_TYPE) : undefined;
  // Without the note type the words are written in, the cards are added and the words reported as not added: the steps that wait for them come in once the learner knows them.
  const wordDrafts = canWriteWords(wordType) ? wanted : [];
  const wordsSkipped = wanted.length - wordDrafts.length;
  const deck = await ensureDeck(store, `${add.deck}::${SKILLS_SUBDECK}`, add.refresh, now);

  // A card already added (by an earlier Add, here or on another phone) is skipped, by its first field.
  const have = haveFronts(await store.listNotes());
  const suspend = new Set<string>();
  let added = 0;
  let skipped = 0;
  for (const [i, d] of drafts.entries()) {
    add.onProgress?.(i, drafts.length + wordDrafts.length);
    if (have.has(d.fields.Front)) { skipped++; continue; }
    try {
      const note = await saveNote(store, { deck, model: SKILL_NOTE_TYPE, fields: { ...emptyFields(basic.fields), ...d.fields }, tags: d.tags }, now);
      added++;
      if (d.suspended) suspend.add(note.id);
    } catch (e) {
      // Another note of the type with the same first field: it's there already in all but its tags.
      if (e instanceof NoteRefused) { skipped++; continue; }
      throw e;
    }
  }
  // The words, which the skills above are asked in: the months for dates. Tagged so Review brings some up each day.
  let words = 0;
  let refused = 0;
  for (const [i, d] of wordDrafts.entries()) {
    add.onProgress?.(drafts.length + i, drafts.length + wordDrafts.length);
    try {
      await saveNote(store, { deck, model: SKILL_WORD_NOTE_TYPE, fields: { ...emptyFields(wordType!.fields), ...d.fields }, tags: d.tags, allowDuplicate: true }, now);
      words++;
    } catch (e) {
      // Refused for another reason (such as a note that makes no cards): said, not dropped.
      if (e instanceof NoteRefused) { refused++; continue; }
      throw e;
    }
  }
  add.onProgress?.(drafts.length + wordDrafts.length, drafts.length + wordDrafts.length);
  if (suspend.size) {
    const cards = (await store.listCards()).filter((c) => suspend.has(c.noteId));
    await setCardStates(store, cards, (s) => ({ ...s, suspended: true }), now, add.dayStartsAtHour);
  }
  return { deck, added, words, wordsSkipped: wordsSkipped + refused, skipped };
}

/** A note type's fields, each empty, so a Basic with extra fields still gets all of them. */
function emptyFields(fields: string[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f, '']));
}

/** The first fields of the skill cards already in the collection, which is how a card counts as added. */
export const haveFronts = (notes: Iterable<Note>): Set<string> =>
  new Set([...notes].filter((n) => n.model === SKILL_NOTE_TYPE && n.tags.includes(SKILL_TAG)).map((n) => n.fields.Front));

/** What adding `groups` would still write: the cards the deck hasn't got. The server's daily job works out the same (skills.py). */
export const missingDrafts = (notes: Iterable<Note>, language: Language, languageName: string, groups: SkillGroup[]): SkillDraft[] => {
  const have = haveFronts(notes);
  return skillDrafts(language, languageName, groups).filter((d) => !have.has(d.fields.Front));
};

/** The skill notes in a deck and the decks under it. */
const skillNotesIn = (notes: Iterable<Note>, deck: string): Note[] =>
  [...notes].filter((n) => n.tags.includes(SKILL_TAG) && (n.deck === deck || n.deck.startsWith(`${deck}::`)));

/**
 * Pauses or resumes a deck's skill cards. Pausing suspends every one. Resuming unsuspends those that
 * aren't a later drill step: a step waiting on the one before stays suspended, and Review releases it
 * once that has settled (`useSkillRelease`), so a skill resumes where its ladder was. The server's
 * `set_skill_cards` does the same. Returns how many cards changed.
 */
export async function setSkillsPaused(store: NoteStore & Pick<AnkiLink, 'setAnkiCardStates'>, deck: string, paused: boolean, now: Date, dayStartsAtHour: number): Promise<number> {
  const notes = new Map(skillNotesIn(await store.listNotes(), deck).map((n) => [n.id, n]));
  const targets = (await store.listCards()).filter((c) => {
    const n = notes.get(c.noteId);
    if (!n || c.retired || !!c.suspended === paused) return false;
    const drill = drillOfTags(n.tags);
    // A step stopped or covered (`setAsideOf`) stays suspended through a resume.
    return paused || (!setAsideOf(n.tags) && (!drill || !stepWaits(drill.step, drill.language)));
  });
  if (!targets.length) return 0;
  await setCardStates(store, targets, (s) => ({ ...s, suspended: paused }), now, dayStartsAtHour);
  return targets.length;
}

/**
 * Sets a drill step aside or brings it back: Stop practicing tags its note `skill::stopped` and suspends
 * its card; Start again takes off that tag and `skill::covered` and unsuspends it, unless the deck's
 * skill cards are paused (then it waits for the resume like the rest). The tag is saved first, through
 * `saveNote`, so a card left suspended by a failed second write is still one the ladder passes by.
 * Returns the note as saved.
 */
export async function setStepStopped(
  store: NoteStore & Pick<AnkiLink, 'setAnkiCardStates'>, noteId: string, stop: boolean, paused: boolean, now: Date, dayStartsAtHour: number,
): Promise<Note> {
  const note = await store.getNote(noteId);
  if (!note) throw new NoteRefused(NOTE_GONE);
  const others = note.tags.filter((t) => t !== SKILL_STOPPED_TAG && t !== SKILL_COVERED_TAG);
  const saved = await saveNote(store, { id: note.id, deck: note.deck, model: note.model, fields: note.fields, tags: stop ? [...others, SKILL_STOPPED_TAG] : others }, now);
  const suspend = stop || paused;
  const cards = (await store.listCards()).filter((c) => c.noteId === note.id && !c.retired && !!c.suspended !== suspend);
  if (cards.length) {
    const { ankiError } = await setCardStates(store, cards, (st) => ({ ...st, suspended: suspend }), now, dayStartsAtHour);
    if (ankiError) throw ankiError;
  }
  return saved;
}

/** Deletes a deck's skill notes, which takes their review history. Returns how many notes went. */
export async function deleteSkillCards(store: NoteStore, deck: string, now: Date = new Date()): Promise<number> {
  const notes = skillNotesIn(await store.listNotes(), deck);
  for (const n of notes) await deleteNote(store, n.id, now);
  return notes.length;
}
