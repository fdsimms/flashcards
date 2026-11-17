import { isOmnilanguage } from './cards';
import { htmlToText } from './html';
import { readerLanguageOf } from './leechHint';
import { missedCardText } from './missedCard';
import type { CardKind, Note, NoteType } from './types';
import type { Language } from '../reader/api';

/**
 * Asking Claude about the card on screen. The question is typed by the learner and only sent then;
 * what Claude answers is shown, never graded or scheduled. The card goes as plain text so any note
 * type can be asked about, not only Omnilanguage.
 */

/** The card as Claude is told about it. */
export interface CardForClaude {
  /** The note's language when Read & Listen writes in it; other note types may not say. */
  language?: Language;
  front: string;
  back: string;
  /** The note's example sentence and mnemonic, when it has them. */
  details: string;
}

export interface AskTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Quick questions offered under an answer; tapping one sends it. */
export const SUGGESTED_QUESTIONS = ['Give me another example', 'How is this used?', 'What is a similar word?'] as const;

const LINE = (label: string, html: string | undefined) => {
  const text = htmlToText(html ?? '').replace(/\s+/g, ' ').trim();
  return text ? `${label}${text}` : '';
};

/**
 * The card's front and back as text. An Omnilanguage note is its word and meaning (with the
 * transliteration), whichever way the card asks; any other note type is what its template renders.
 * Undefined when there's nothing to say about the card (a template with no text).
 */
export function cardForClaude(note: Note, noteType: NoteType | undefined, kind: CardKind): CardForClaude | undefined {
  if (isOmnilanguage(note)) {
    const entry = LINE('', note.fields.Entry);
    const meaning = LINE('', note.fields.Meaning);
    if (!entry || !meaning) return undefined;
    const translit = LINE('', note.fields.Transliteration || note.fields.KanaReading);
    return {
      language: readerLanguageOf(note),
      front: translit ? `${entry} (${translit})` : entry,
      back: meaning,
      details: [LINE('Example: ', note.fields.Context), LINE('Mnemonic: ', note.fields.Mnemonic)].filter(Boolean).join('\n'),
    };
  }
  const text = missedCardText(note, noteType, kind);
  return text ? { language: readerLanguageOf(note), front: text.question, back: text.answer, details: '' } : undefined;
}

/** The conversation as the server takes it: the new question added last. */
export function withQuestion(turns: AskTurn[], question: string): AskTurn[] {
  return [...turns, { role: 'user', content: question.trim() }];
}

/** The card as a message to paste or open in another chat. */
export function cardMessage(card: CardForClaude): string {
  const lines = ["I'm reviewing a flashcard."];
  lines.push(`Front: ${card.front}`, `Back: ${card.back}`);
  if (card.details) lines.push(card.details);
  return lines.join('\n');
}

/** Long enough for a card and a question, short enough for a link to open reliably. */
const MAX_LINK_CHARS = 1800;

/**
 * A claude.ai link that opens a new chat with the card and the question typed so far in the
 * message box, for asking in the Claude app instead of through this server's key. The text is
 * cut to a length links open reliably at, and ends with "My question:" for the learner to finish
 * when none is typed yet.
 */
export function claudeChatLink(card: CardForClaude, question: string): string {
  const ask = question.trim() || '';
  const tail = `\n\nMy question: ${ask}`;
  const head = cardMessage(card).slice(0, Math.max(0, MAX_LINK_CHARS - tail.length));
  return `https://claude.ai/new?q=${encodeURIComponent(head + tail)}`;
}
