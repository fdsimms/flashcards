import { isOmnilanguage, speechLangFor } from './cards';
import { inheritedSetting } from './deckTree';
import type { Card, DeckSettings, Note } from './types';

/**
 * The aspect check on a Russian or Polish verb's front: "Imperfective or perfective?", answered
 * with a tap before Show answer, or skipped. It is a check, never a rating: Review only outlines
 * Hard after a wrong pick, and the learner still presses the rating (nothing feeds FSRS but the
 * answer button, as for a skill card's drill).
 */

export type Aspect = 'perfective' | 'imperfective';

export const ASPECT_LANGUAGES = ['ru', 'pl'];

/** The rating outlined after a wrong pick: Hard (2). */
export const ASPECT_MISS_RATING = 2;

/**
 * The aspect to ask about, when this card is the front of a Russian or Polish verb note tagged with
 * exactly one aspect (the tags the deck and Add to deck write). Undefined for anything else: other
 * languages, nouns, a verb tagged both, and the reverse and audio cards, whose front doesn't show the verb.
 */
export function aspectToCheck(note: Note, card: Pick<Card, 'kind'>): Aspect | undefined {
  if (card.kind !== 'forward' || !hasAspectLanguage(note)) return undefined;
  const tags = new Set(note.tags.map((t) => t.toLowerCase()));
  const found = (['perfective', 'imperfective'] as const).filter((a) => tags.has(a));
  return found.length === 1 ? found[0] : undefined;
}

/** Whether a note is in a language whose verbs have an aspect to ask about (`ASPECT_LANGUAGES`). */
function hasAspectLanguage(note: Note): boolean {
  return isOmnilanguage(note) && ASPECT_LANGUAGES.includes(speechLangFor(note)?.split('-')[0] ?? '');
}

/**
 * Whether the aspect check can ever apply in a deck: some note in it or its subdecks is in Russian or
 * Polish. Deck options hides the setting otherwise, so a Toki Pona deck isn't offered it.
 */
export function deckHasAspectLanguage(deck: string, notes: Iterable<Note>): boolean {
  for (const n of notes) {
    if ((n.deck === deck || n.deck.startsWith(`${deck}::`)) && hasAspectLanguage(n)) return true;
  }
  return false;
}

/** Whether a deck asks it (its own setting, else its nearest ancestor's, else on). */
export function aspectCheckOn(deck: string, all: Map<string, DeckSettings>): boolean {
  return inheritedSetting(deck, all, 'aspectCheck') ?? true;
}

/** What a pick comes to: whether it was right, and the line shown for it. */
export function aspectVerdict(aspect: Aspect, pick: Aspect): { right: boolean; text: string } {
  const right = pick === aspect;
  const name = aspect[0].toUpperCase() + aspect.slice(1);
  return { right, text: right ? `${name}: correct` : `It's ${aspect}` };
}
