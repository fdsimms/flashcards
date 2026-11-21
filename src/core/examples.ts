import { htmlToText } from './html';
import type { Note } from './types';

/**
 * Where the learner met the word (a game, a show, a book), from the Source field: the line as it was
 * shown or said, its translation, and the title, one to a line. The title is always the last line and
 * the translation the one between, so a note of a language with no translation (the English deck) is
 * two lines. Null when the field is empty.
 */
export interface Source {
  line: string;
  translation: string;
  where: string;
}

export function sourceOf(note: Note): Source | null {
  const lines = fieldLines(note.fields.Source).filter((l) => htmlToText(l));
  if (!lines.length) return null;
  if (lines.length === 1) return { line: lines[0], translation: '', where: '' };
  return { line: lines[0], translation: lines.length > 2 ? lines.slice(1, -1).join(' ') : '', where: htmlToText(lines[lines.length - 1]) };
}

/** One example sentence of a note, each part as the note's HTML (the caller turns it into text or segments). */
export interface Example {
  context: string;
  romanized: string;
  translation: string;
  /** The word-for-word reading of the sentence, from ContextLiteral. Empty when the note gives none. */
  literal: string;
  /** What the sentence shows ("skill", "event"), from ContextLabels. Empty when the note gives none. */
  tag: string;
}

// One line of a field ends at a <br>, the end of a <div> or <p>, or a newline: Anki's editor writes any of them.
const LINE_END = /<\s*br\s*\/?>|<\/(?:div|p)>|\n/i;

/** A field's lines as HTML. Blank lines stay, so line N of one field still pairs with line N of another. */
export function fieldLines(html: string | undefined): string[] {
  const lines = (html ?? '').split(LINE_END).map((l) => l.replace(/<(?:div|p)\b[^>]*>/gi, ''));
  while (lines.length && !htmlToText(lines[lines.length - 1])) lines.pop();
  return lines;
}

/**
 * The note's example sentences. Normally one: the Context, ContextRomanized, ContextTranslation and
 * ContextLiteral fields as written. A note with something in ContextLabels has several, one per line of Context,
 * paired by line number with the same line of the other three fields. Opting in by ContextLabels
 * keeps a note whose Context already runs over two lines showing as it always has. A line of
 * Context that is blank is skipped, and a label line left blank is an example with no tag.
 */
export function examplesOf(note: Note): Example[] {
  const field = (name: string) => note.fields[name] ?? '';
  const whole: Example = { context: field('Context'), romanized: field('ContextRomanized'), translation: field('ContextTranslation'), literal: field('ContextLiteral'), tag: '' };
  if (!htmlToText(field('ContextLabels'))) return [whole];
  const [context, romanized, translation, literal, tags] = ['Context', 'ContextRomanized', 'ContextTranslation', 'ContextLiteral', 'ContextLabels'].map((n) => fieldLines(field(n)));
  const each = context
    .map((line, i): Example => ({ context: line, romanized: romanized[i] ?? '', translation: translation[i] ?? '', literal: literal[i] ?? '', tag: htmlToText(tags[i] ?? '') }))
    .filter((e) => htmlToText(e.context));
  return each.length ? each : [whole];
}
