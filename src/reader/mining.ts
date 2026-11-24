import { htmlToText } from '../core/html';
import type { Note } from '../core/types';
import { isNoForm } from '../core/wordGrammar';
import type { AspectPair, GlossLanguage, Language, Word } from './api';

/**
 * A word's IPA and where it's from, as the server sends them (both absent from a server older than IPA), and its
 * `translit`: a Japanese word's reading in kana (a Thai word's romanization, which isn't used here).
 */
export type Pronunciation = Partial<Pick<Word, 'ipa' | 'ipa_source' | 'translit'>>;

// Adding a marked word, a phrase selected in the reader or a word from the vocabulary check to the deck ("mining"). Each one is a new note made in Franki's note editor,
// where saving it is the approval step (brief, design principle 13). There is no daily cap: how many new cards come up
// is the deck's own new-cards-per-day limit. Pure, so it's tested.

/** A new note for the note editor to start from. */
export type MinedNote = { deck: string; model: string; fields: Record<string, string>; fieldNotes?: Record<string, string>; tags?: string[] };

/** The languages whose verbs come in aspect pairs, kept as two linked notes (server/reader aspect.py asks only for these). */
export const ASPECT_LANGUAGES: Language[] = ['ru', 'pl'];

/** Whether `language` is one whose verbs come in aspect pairs (a gloss-only language is not). */
export function hasAspectPairs(language: GlossLanguage): language is Language {
  return (ASPECT_LANGUAGES as GlossLanguage[]).includes(language);
}

const AI_NOTE = 'Written by AI. Check it before saving.';

/**
 * The new note a marked word or a selected phrase starts as, for the note editor: it and its meaning, in the language's deck.
 * With the word's IPA, the Pronunciation field starts as it, to check before saving. The editor leaves out a field the note
 * type doesn't have, so a collection with no Pronunciation field simply doesn't show it.
 * With an aspect pair (a Russian or Polish verb), the AspectPartner field starts as the partner and the note is tagged
 * perfective or imperfective, as the deck's verbs are. A Japanese word's reading starts KanaReading, as the note queue
 * writes it (note_queue.py), unless the word is already all kana.
 */
export function minedNote(
  word: string,
  gloss: string | null,
  deck: string,
  pronunciation?: Pronunciation,
  aspect?: AspectPair | null,
  language?: GlossLanguage,
): MinedNote {
  const ipa = pronunciation?.ipa;
  const pair = aspect?.partner && aspect.aspect ? { partner: aspect.partner, aspect: aspect.aspect } : null;
  const reading = language === 'ja' && pronunciation?.translit && pronunciation.translit !== word ? pronunciation.translit : null;
  return {
    deck,
    model: 'Omnilanguage',
    fields: {
      Entry: word,
      Meaning: gloss ?? '',
      ...(ipa ? { Pronunciation: ipa } : {}),
      ...(reading ? { KanaReading: reading } : {}),
      ...(pair ? { AspectPartner: pair.partner } : {}),
    },
    // IPA and an aspect pair written by AI aren't checked against anything, so the editor says so under the field.
    ...((ipa && pronunciation?.ipa_source === 'ai') || pair ? {
      fieldNotes: {
        ...(ipa && pronunciation?.ipa_source === 'ai' ? { Pronunciation: AI_NOTE } : {}),
        ...(pair ? { AspectPartner: AI_NOTE } : {}),
      },
    } : {}),
    ...(pair ? { tags: [pair.aspect] } : {}),
  };
}

// An aspect pair is two linked notes, one per verb, each tagged with its own aspect and with AspectPartner holding the other.
// After one is saved, the other is added or linked back (pairFollowUp), so the pair is linked both ways whichever was added first.

const OTHER_ASPECT = { perfective: 'imperfective', imperfective: 'perfective' } as const;
const ASPECT_TAGS: string[] = Object.keys(OTHER_ASPECT);

/** A field as plain text, for comparing two verbs written the same way. */
function textOf(value: string | undefined): string {
  return htmlToText(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

const sameVerb = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** What to offer after saving one half of a pair. */
export type PairFollowUp =
  /** The partner isn't in the deck: a new note for it, pointing back. */
  | { kind: 'add'; partner: string; aspect?: 'perfective' | 'imperfective'; target: MinedNote }
  /** The partner is in the deck without a link back: the fields and tags to save it with. */
  | { kind: 'link'; partner: string; word: string; note: Note; fields: Record<string, string>; tags: string[] };

/**
 * What to offer after `saved` (a note just saved with an AspectPartner) to make the pair whole, or null when there's
 * nothing to do: no partner, or the partner is already linked back. A partner that lists some other verb is left as it
 * is, since that's the owner's own entry. `partnerMeaning` is the server's suggested meaning for a partner that has to be added.
 */
export function pairFollowUp(saved: Note, notes: Note[], partnerMeaning?: string | null): PairFollowUp | null {
  const partner = textOf(saved.fields.AspectPartner);
  const word = textOf(saved.fields.Entry);
  // "-" says the verb has no partner: nothing to add or link.
  if (!partner || isNoForm(partner) || !word || sameVerb(partner, word)) return null;
  const own = saved.tags.find((t): t is keyof typeof OTHER_ASPECT => t in OTHER_ASPECT);
  const other = own ? OTHER_ASPECT[own] : undefined;
  const found = notes.find((n) => n.id !== saved.id && n.model === saved.model && sameVerb(textOf(n.fields.Entry), partner));
  if (!found) {
    const language = saved.fields.Language;
    return {
      kind: 'add',
      partner,
      aspect: other,
      target: {
        deck: saved.deck,
        model: saved.model,
        fields: { Entry: partner, Meaning: partnerMeaning ?? '', AspectPartner: word, ...(language ? { Language: language } : {}) },
        ...(partnerMeaning ? { fieldNotes: { Meaning: AI_NOTE } } : {}),
        ...(other ? { tags: [other] } : {}),
      },
    };
  }
  // Already linked back, or listing some other verb: either way there's nothing to change.
  if (textOf(found.fields.AspectPartner)) return null;
  // Tagged only when it has no aspect tag yet; one it already has is the owner's.
  const tags = found.tags.some((t) => ASPECT_TAGS.includes(t)) || !other ? found.tags : [...found.tags, other];
  return { kind: 'link', partner, word, note: found, fields: { ...found.fields, AspectPartner: word }, tags };
}
