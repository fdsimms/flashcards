// The fill-in slots in a text (docs/read-and-listen/architecture.md, Form quiz): a few known words the
// server flags (`Word.quiz`, server/reader/.../form_quiz.py) are drawn as a pill in the line, and a tap
// opens a sheet to type the word's form from its dictionary form. This is the app's side: which words are
// slots, the sentence around one, and the check of what was typed. Practice only: nothing here grades a
// card or reaches the scheduler, and what's typed is compared (core/typedCompare.ts) but never rated.
// Pure, so it's tested; ui/useFormQuiz.ts holds the state and ui/ReaderFormQuiz.tsx shows the sheet.
import { compareTypedAnswer } from '../core/typedCompare';
import type { Language, ReaderText, Word } from './api';
import { helperNote } from './formPrimer';

/** How a slot has ended: answered right, answered wrong and then closed, or skipped. An open one has no entry. */
export type Settled = 'right' | 'missed' | 'skipped';

/** What a slot's word is drawn as: the pill, a right answer's tint, or as the plain word. */
export type SlotView = 'open' | 'right' | null;

/** The text's flagged words are a slot only when they can be asked: a form the server named, and a dictionary form to start from. */
export function isSlotWord(word: Word): boolean {
  return word.quiz === true && !!word.lemma && !!word.form;
}

/** The slot words of a text, in order. */
export function slotWords(text: ReaderText): Word[] {
  return text.lines.flatMap((line) => line.words.filter(isSlotWord));
}

/**
 * How a slot word is drawn. Off, or a word that isn't a slot, is the plain word. While its line plays the
 * word is the plain word too, since the voice is saying it: listening first is a fair way to answer. Once
 * answered right it keeps a tint; once missed or skipped it's plain.
 */
export function slotView(word: Word, settled: Settled | undefined, enabled: boolean, linePlaying: boolean): SlotView {
  if (!enabled || !isSlotWord(word)) return null;
  if (settled === 'right') return 'right';
  if (settled) return null;
  return linePlaying ? null : 'open';
}

/**
 * The pill's width: about the word's, so the line wraps where it would have, and never under a tap
 * target. A letter is about 0.6 of the font size; a full-width one (kana, kanji) is a whole one.
 */
export function slotWidth(word: Word, fontSize: number, minWidth: number): number {
  const ems = Array.from(word.text).reduce((n, ch) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.6), 0);
  return Math.max(minWidth, Math.round(ems * fontSize));
}

/** A line's text before and after one of its words, spaces and punctuation included, for the sentence with a blank. */
export function aroundWord(words: Word[], word: Word): { before: string; after: string } | null {
  const at = words.indexOf(word);
  if (at < 0) return null;
  const join = (part: Word[]) => part.map((w) => w.text).join('');
  return { before: join(words.slice(0, at)).trimStart(), after: join(words.slice(at + 1)).trimEnd() };
}

export type FormCheck = 'empty' | 'right' | 'accents' | 'wrong';

/**
 * What was typed against the word's form in the text. Case, spacing and punctuation don't matter; accents
 * do, since the form is often told apart by them (Polish ę against e). `accents` is the right letters with
 * the marks off, which is a miss, said so. A Japanese form may also be typed as its reading (たべました
 * for 食べました), in either kana or romaji.
 */
export function checkForm(typed: string, word: Pick<Word, 'text' | 'translit'>, language?: Language): FormCheck {
  if (!typed.trim()) return 'empty';
  const japanese = language === 'ja';
  const answers = japanese && word.translit ? [word.text, word.translit] : [word.text];
  const compared = compareTypedAnswer(answers, typed.trim(), japanese ? 'ja-JP' : undefined);
  if (compared.sameWords) return 'right';
  return compared.sameLetters ? 'accents' : 'wrong';
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Why the word has the form it has, shown once it's checked: the form, and the word of its line that goes with it. */
export function formReason(word: Pick<Word, 'form'>): string {
  if (!word.form) return '';
  const note = helperNote(word.form);
  return note ? `${capital(word.form.name)}. ${note}.` : `${capital(word.form.name)}.`;
}
