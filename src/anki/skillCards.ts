import { Refusal } from '../core/failure';
import type { AnkiLink } from '../db/ankiLink';
import type { Language } from '../reader/api';
import { SKILL_NOTE_TYPE, SKILL_TAG, SKILLS_SUBDECK, skillDrafts, type SkillGroup } from '../tools/skills';
import { ensureDeck } from './deckService';
import { NoteRefused, saveNote, setCardStates, type NoteStore } from './noteService';

/**
 * Adding skill cards (src/tools/skills.ts) to a deck: Basic notes in its `::Skills` subdeck, made
 * there if it isn't yet, each through `saveNote` as any note is, so Anki and sync carry them. A later
 * drill step is suspended once added, and Review releases it when the step before settles. Run only
 * from Add skill cards, after the learner has seen what it adds: that tap is the approval.
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
  const have = new Set((await store.listNotes()).filter((n) => n.model === SKILL_NOTE_TYPE && n.tags.includes(SKILL_TAG)).map((n) => n.fields.Front));
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
