// The check after reading (docs/read-and-listen/architecture.md, Client, Check what you understood):
// a few multiple-choice questions on the text just read, before it's rated. Three kinds:
// - text: what happens in it, written by Claude with the text (TextQuestion), in the text's language
//   with its English;
// - listen: a line played with its words hidden, to pick its English from four of the text's lines;
// - word: what a word looked up, marked unknown or practiced means, from four of the text's glosses.
// The last two are built here from what the text already has, so they cost nothing. Nothing is
// graded: the score goes with the reading's log, where a poor one makes the next text a little easier.
// Pure, so it's tested; ReaderCheck.tsx shows it.
import type { ReaderText, TextLine, Word } from './api';
import type { Session } from './session';

export type CheckQuestion =
  | { kind: 'text'; key: string; line: number; question: string; english: string; choices: { text: string; english: string }[]; answer: number }
  | { kind: 'listen'; key: string; line: number; choices: string[]; answer: number }
  | { kind: 'word'; key: string; line: number; word: string; choices: string[]; answer: number };

export const CHOICES = 4;
const TEXT_QUESTIONS = 2;
const WORD_QUESTIONS = 2;
// A line to listen for has at least this many words, so it isn't a lone "Yes."
const LISTEN_MIN_WORDS = 3;

/** A random number in [0, 1), injected so tests can pin the order. */
export type Random = () => number;

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The right choice and the wrong ones in a random order, with where the right one landed. */
function withAnswer<T>(right: T, wrong: T[], random: Random): { choices: T[]; answer: number } {
  const choices = shuffled([right, ...wrong], random);
  return { choices, answer: choices.indexOf(right) };
}

const fold = (s: string) => s.trim().toLocaleLowerCase();
const isWord = (w: Word) => w.status !== null;

function textQuestions(text: ReaderText, random: Random): CheckQuestion[] {
  const out: CheckQuestion[] = [];
  for (const q of text.questions ?? []) {
    if (out.length === TEXT_QUESTIONS) break;
    if (!text.lines[q.line] || q.choices.length !== CHOICES || !q.choices[q.answer]) continue;
    const right = q.choices[q.answer];
    const { choices, answer } = withAnswer(right, q.choices.filter((c) => c !== right), random);
    out.push({ kind: 'text', key: `text:${q.line}:${q.question}`, line: q.line, question: q.question, english: q.english, choices, answer });
  }
  return out;
}

function listenQuestions(lines: TextLine[], count: number, avoid: Set<number>, random: Random): CheckQuestion[] {
  // Every line's English, once each: a line that reads like another can't be told apart from it.
  const english = new Map<string, number>();
  lines.forEach((l, i) => { const e = fold(l.english); english.set(e, english.has(e) ? -1 : i); });
  const distinct = [...english.entries()].filter(([, i]) => i >= 0).map(([, i]) => i);
  if (distinct.length < CHOICES) return [];
  const fits = (i: number) => lines[i].audio && lines[i].words.filter(isWord).length >= LISTEN_MIN_WORDS;
  // Lines no other question is about come first, so the check covers more of the text.
  const order = shuffled(distinct.filter(fits), random).sort((a, b) => Number(avoid.has(a)) - Number(avoid.has(b)));
  return order.slice(0, count).map((line) => {
    const wrong = shuffled(distinct.filter((i) => i !== line), random).slice(0, CHOICES - 1).map((i) => lines[i].english.trim());
    const { choices, answer } = withAnswer(lines[line].english.trim(), wrong, random);
    return { kind: 'listen' as const, key: `listen:${line}`, line, choices, answer };
  });
}

function wordQuestions(text: ReaderText, session: Session, random: Random): CheckQuestion[] {
  // Each word's first appearance with a gloss, and every gloss in the text, once each.
  const found = new Map<string, { word: string; gloss: string; line: number }>();
  const glosses = new Map<string, string>();
  text.lines.forEach((l, line) => l.words.forEach((w) => {
    if (!isWord(w) || w.status === 'name' || !w.gloss?.trim()) return;
    if (!found.has(fold(w.text))) found.set(fold(w.text), { word: w.text, gloss: w.gloss.trim(), line });
    if (!glosses.has(fold(w.gloss))) glosses.set(fold(w.gloss), w.gloss.trim());
  }));
  const practiced = text.lines.flatMap((l) => l.words.filter((w) => w.stretch && isWord(w)).map((w) => w.text));
  // Marked unknown first, then looked up, then the practice words.
  const wanted = [...new Set([...session.flagged, ...session.glossed, ...practiced].map(fold))];
  const out: CheckQuestion[] = [];
  for (const key of wanted) {
    if (out.length === WORD_QUESTIONS) break;
    const w = found.get(key);
    if (!w || out.some((q) => q.kind === 'word' && fold(q.choices[q.answer]) === fold(w.gloss))) continue;
    const others = [...glosses.entries()].filter(([g]) => g !== fold(w.gloss) && g !== key).map(([, g]) => g);
    if (others.length < CHOICES - 1) break;
    const { choices, answer } = withAnswer(w.gloss, shuffled(others, random).slice(0, CHOICES - 1), random);
    out.push({ kind: 'word', key: `word:${key}`, line: w.line, word: w.word, choices, answer });
  }
  return out;
}

/**
 * The check for a text, in the order it's asked: what happens (up to two), listening (one, or two
 * when there's nothing about what happens), then words (up to two). Empty when the text has nothing
 * to ask about, and then no check is offered.
 */
export function buildCheck(text: ReaderText, session: Session, random: Random = Math.random): CheckQuestion[] {
  const about = textQuestions(text, random);
  const listen = listenQuestions(text.lines, about.length ? 1 : 2, new Set(about.map((q) => q.line)), random);
  return [...about, ...listen, ...wordQuestions(text, session, random)];
}

/** What was picked for each question, by key; null for "I don't know". */
export type CheckPicks = Record<string, number | null>;

export function isRight(q: CheckQuestion, picks: CheckPicks): boolean {
  return picks[q.key] === q.answer;
}

/** Right of asked, over the questions answered (or skipped) so far. */
export function checkScore(questions: CheckQuestion[], picks: CheckPicks): { right: number; asked: number } {
  const asked = questions.filter((q) => q.key in picks);
  return { right: asked.filter((q) => isRight(q, picks)).length, asked: asked.length };
}
