import { htmlToText } from './html';
import { renderTemplateCard } from './template';
import { withoutTts } from './tts';
import type { CardKind, Note, NoteType } from './types';

/** A missed card as the session end's list shows it: what was asked and what the answer was. */
export interface MissedCardText {
  question: string;
  answer: string;
  /** The card type's name, only when the note type has more than one (so it says which card). */
  cardName?: string;
}

const ANSWER_RULE = /<hr id=["']?answer["']?\s*\/?>/i;

/** A side's text as one line; a side with only a picture says so rather than showing nothing. */
function sideText(html: string): string {
  const text = htmlToText(withoutTts(html)).replace(/\s+/g, ' ').trim();
  return text || (/<img\b/i.test(html) ? 'Picture' : '');
}

/**
 * The question and answer of a missed card of an Anki note type (every type but Omnilanguage, whose
 * rows show the word and its meaning instead), as its template renders them. A back that repeats
 * the front ({{FrontSide}}) is cut at Anki's answer line so only the answer is left. Undefined when
 * the card has no template to render or a side comes out empty or the same as the other, so the
 * caller falls back.
 */
export function missedCardText(note: Note, noteType: NoteType | undefined, kind: CardKind): MissedCardText | undefined {
  if (!noteType || !kind.startsWith('t')) return undefined;
  const ord = Number(kind.slice(1));
  const { front, back } = renderTemplateCard(note, noteType, ord);
  const question = sideText(front);
  const answer = sideText(back.split(ANSWER_RULE).pop() ?? back);
  // A card whose two sides read the same has its question and answer told apart by CSS (a template
  // that shows a whole table and hides parts), which text can't see: the caller falls back.
  if (!question || !answer || question === answer) return undefined;
  const cardName = noteType.kind === 'normal' && noteType.templates.length > 1
    ? noteType.templates.find((t) => t.ord === ord)?.name
    : undefined;
  return { question, answer, cardName };
}
