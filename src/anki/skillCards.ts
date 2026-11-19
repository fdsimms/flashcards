import { Refusal } from '../core/failure';
import type { AnkiLink } from '../db/ankiLink';
import type { Language } from '../reader/api';
import type { Note } from '../core/types';
import { drillOfTags, SKILL_NOTE_TYPE, SKILL_TAG, SKILLS_SUBDECK, skillDrafts, type SkillDraft, type SkillGroup } from '../tools/skills';
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
  /** How far it's got: the notes done and the notes to do. */
  onProgress?: (done: number, total: number) => void;
  now?: Date;
}

/** Adds what `groups` writes, skipping a card the deck already has. Returns the deck, how many were added, and how many were already there. */
export async function addSkillCards(store: NoteStore & Pick<AnkiLink, 'setAnkiCardStates'>, add: SkillAdd): Promise<{ deck: string; added: number; skipped: number }> {
  const now = add.now ?? new Date();
  const basic = (await store.listNoteTypes()).get(SKILL_NOTE_TYPE);
  if (!basic || !basic.fields.includes('Front') || !basic.fields.includes('Back')) {
    throw new SkillsRefused(`Your collection has no ${SKILL_NOTE_TYPE} note type with Front and Back fields, which skill cards are made of. In Anki on your computer, add one (Tools, Manage Note Types, Add, then Add: Basic), sync, and try again.`);
  }
  const drafts = skillDrafts(add.language, add.languageName, add.groups);
  if (!drafts.length) throw new SkillsRefused('There are no skill cards to add for this deck yet.');
  const deck = await ensureDeck(store, `${add.deck}::${SKILLS_SUBDECK}`, add.refresh, now);

  // A card already added (by an earlier Add, here or on another phone) is skipped, by its first field.
  const have = haveFronts(await store.listNotes());
  const suspend = new Set<string>();
  let added = 0;
  let skipped = 0;
  for (const [i, d] of drafts.entries()) {
    add.onProgress?.(i, drafts.length);
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
  add.onProgress?.(drafts.length, drafts.length);
  if (suspend.size) {
    const cards = (await store.listCards()).filter((c) => suspend.has(c.noteId));
    await setCardStates(store, cards, (s) => ({ ...s, suspended: true }), now, add.dayStartsAtHour);
  }
  return { deck, added, skipped };
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
    return paused || !drillOfTags(n.tags)?.step.after;
  });
  if (!targets.length) return 0;
  await setCardStates(store, targets, (s) => ({ ...s, suspended: paused }), now, dayStartsAtHour);
  return targets.length;
}

/** Deletes a deck's skill notes, which takes their review history. Returns how many notes went. */
export async function deleteSkillCards(store: NoteStore, deck: string, now: Date = new Date()): Promise<number> {
  const notes = skillNotesIn(await store.listNotes(), deck);
  for (const n of notes) await deleteNote(store, n.id, now);
  return notes.length;
}
