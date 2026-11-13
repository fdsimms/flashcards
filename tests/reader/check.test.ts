import { expect, test } from 'vitest';
import type { ReaderText, TextLine, TextQuestion, Word } from '../../src/reader/api';
import { buildCheck, checkScore, CHOICES, isRight, type CheckQuestion } from '../../src/reader/check';
import { lookUp, startSession, toggleFlag } from '../../src/reader/session';

const word = (text: string, gloss: string | null, extra: Partial<Word> = {}): Word =>
  ({ text, status: 'known', gloss, stretch: false, deck: true, grammar: null, ...extra });
const space: Word = { text: ' ', status: null, gloss: null, stretch: false, deck: false, grammar: null };

function line(english: string, words: Word[], audio = true): TextLine {
  return { speaker: 'A', english, audio, words: words.flatMap((w, i) => (i ? [space, w] : [w])) };
}

const LINES: TextLine[] = [
  line('Good morning. A coffee with milk, please.', [word('Buenos', 'good'), word('días', 'days'), word('café', 'coffee')]),
  line('Sure. Anything to eat?', [word('Claro', 'sure'), word('algo', 'something'), word('comer', 'to eat')]),
  line('Yes, toast. But I am in a hurry.', [word('tostada', 'toast', { stretch: true }), word('tengo', 'I have'), word('prisa', 'hurry', { status: 'unknown', deck: false })]),
  line("Don't worry, five minutes.", [word('No', 'no'), word('preocupe', 'worry'), word('cinco', 'five')]),
  line('Sorry, I left my wallet in the car.', [word('Lucía', null, { status: 'name' }), word('cartera', 'wallet'), word('coche', 'car')]),
  line('Fine.', [word('Vale', 'fine')]),
];

const QUESTION: TextQuestion = {
  line: 2,
  question: '¿Por qué tiene prisa?',
  english: 'Why is she in a hurry?',
  choices: [
    { text: 'Su tren sale', english: 'Her train leaves' },
    { text: 'Llega tarde', english: "She's late" },
    { text: 'Cierran', english: "They're closing" },
    { text: 'Su coche', english: 'Her car' },
  ],
  answer: 0,
};

const text = (questions: TextQuestion[] = [], lines = LINES): ReaderText => ({
  id: 1, topicId: 1, title: 'En la cafetería', coverage: 0.93, stretch: ['tostada'], roles: {}, form: 'dialogue',
  language: 'es', grammar: [], lines, questions,
});

// A fixed sequence, so the order is the same every run.
function seeded(seed = 1): () => number {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

const right = (q: CheckQuestion) => (q.kind === 'text' ? q.choices[q.answer].english : q.choices[q.answer]);

test('questions about the text come first with their right answer kept, then one by ear, then words', () => {
  const session = toggleFlag(startSession(text(), 0), 'prisa');
  const check = buildCheck(text([QUESTION]), session, seeded());
  expect(check.map((q) => q.kind)).toEqual(['text', 'listen', 'word', 'word']);
  const [about, listen, marked, practiced] = check;
  expect(right(about)).toBe('Her train leaves');
  expect(about.kind === 'text' && about.choices.map((c) => c.english).sort()).toEqual(QUESTION.choices.map((c) => c.english).sort());
  // The line it's about is left to the other questions.
  expect(listen.line).not.toBe(2);
  expect(right(listen)).toBe(LINES[listen.line].english);
  expect(marked).toMatchObject({ kind: 'word', word: 'prisa', line: 2 });
  expect(right(marked)).toBe('hurry');
  expect(practiced).toMatchObject({ kind: 'word', word: 'tostada' });
  for (const q of check) {
    expect(q.choices).toHaveLength(CHOICES);
    expect(new Set(q.choices.map((c) => (typeof c === 'string' ? c : c.english))).size).toBe(CHOICES);
  }
});

test('with nothing written about the text, two lines are asked by ear', () => {
  const check = buildCheck(text(), startSession(text(), 0), seeded(7));
  const listen = check.filter((q) => q.kind === 'listen');
  expect(listen).toHaveLength(2);
  // Never a line too short to tell by ear, and never a line with no audio.
  for (const q of listen) expect(q.line).not.toBe(5);
  const silent = LINES.map((l) => ({ ...l, audio: false }));
  expect(buildCheck(text([], silent), startSession(text(), 0), seeded()).some((q) => q.kind === 'listen')).toBe(false);
});

test('words come from those marked, then looked up, then practiced, at most two, never a name', () => {
  let session = lookUp(startSession(text(), 0), 'coche');
  session = lookUp(session, 'Lucía');
  session = toggleFlag(session, 'cinco');
  const words = buildCheck(text(), session, seeded()).filter((q) => q.kind === 'word');
  expect(words.map((q) => q.kind === 'word' && q.word)).toEqual(['cinco', 'coche']);
});

test('a question that does not fit the text is left out', () => {
  const broken = [{ ...QUESTION, line: 9 }, { ...QUESTION, choices: QUESTION.choices.slice(1) }, { ...QUESTION, answer: 4 }];
  expect(buildCheck(text(broken), startSession(text(), 0), seeded()).some((q) => q.kind === 'text')).toBe(false);
});

test('a short text with too few lines to choose from asks nothing', () => {
  const short = LINES.slice(0, 2);
  expect(buildCheck(text([], short), startSession(text(), 0), seeded())).toEqual([]);
});

test('the score counts right answers of those answered, a skip as wrong', () => {
  const check = buildCheck(text([QUESTION]), startSession(text(), 0), seeded());
  const [first, second, third] = check;
  const picks = { [first.key]: first.answer, [second.key]: (second.answer + 1) % CHOICES, [third.key]: null };
  expect(isRight(first, picks)).toBe(true);
  expect(isRight(third, picks)).toBe(false);
  expect(checkScore(check, picks)).toEqual({ right: 1, asked: 3 });
});
