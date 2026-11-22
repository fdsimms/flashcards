/**
 * Read & Listen never grades a card from exposure and never adds one without an approval step
 * (CLAUDE.md, Read & Listen). Its code, logic, screens and routes alike, imports nothing that
 * answers, schedules or writes cards and notes: not the scheduler, not the Anki writeback, not the
 * repo.
 *
 * Besides the files named below, every screen, hook and route that imports from `src/reader/` is
 * scanned, so one living outside `src/ui/reader/` (a shared hook like Add to deck) is checked
 * without anyone remembering to add it. The ones that may import a writer are named in `EXEMPT`
 * with the reason, the way a coverage test names what it leaves out.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const READER = join(ROOT, 'src', 'reader');
const UI = join(ROOT, 'src', 'ui');
const UI_READER = join(UI, 'reader');
const ROUTES = join(ROOT, 'src', 'app');
const READ_TAB = join(ROUTES, '(tabs)', '(read)');
// Anything that answers, schedules or writes cards and notes.
const FORBIDDEN = /from '[^']*(core\/scheduler|core\/session|anki\/writeback|anki\/noteWrites|anki\/noteService|db\/[a-zA-Z]+)'/;
// A screen, hook or route that uses something from src/reader/.
const USES_READER = /from '(\.\.\/)+reader\//;

/** Files that import from src/reader/ and may import a writer, by group, with the reason. Paths from the repo root. */
const EXEMPT: Record<string, string[]> = {
  // The review screen is the answer button: grading is its job. It uses Read & Listen's practice
  // and production checks, which never rate (CLAUDE.md, "Nothing feeds FSRS but the answer button").
  'the review screen': ['src/ui/Review.tsx', 'src/ui/SessionMisses.tsx'],
  // Practice's screens and the voice settings, which use Read & Listen's server (the grammar
  // catalog, recordings, voices) and import only the Repo type, for the repo they're handed.
  // The tools' own logic is held to the rule by tests/tools/noGrading.test.ts.
  'Practice, voices and speaking, which import only the Repo type': [
    'src/ui/FormsDrill.tsx', 'src/ui/FormsPractice.tsx', 'src/ui/Practice.tsx', 'src/ui/SpeakingSettings.tsx',
    'src/ui/Voices.tsx', 'src/ui/tools/GrammarDrill.tsx', 'src/ui/tools/ToolScreen.tsx', 'src/ui/tools/index.tsx',
    'src/ui/useGrammarDue.ts', 'src/ui/usePhoneSpeech.ts', 'src/ui/useWordAudio.ts',
  ],
  // A cram's Listen row and its Add (src/core/cram.ts) use Read & Listen for an audio lesson from the
  // cram's words and to find a word to make a card for (CramMakeCards for every word jotted down in
  // the lesson at once), and import only the NoteStore type; the
  // cram's tag is written by useCrams.ts, which nothing in src/reader imports. The talking points
  // (CramThemes, CramThemeDetail) ask Read & Listen for themes to talk about and import only the
  // NoteStore and Repo types, the second for the phone's voice; CramTalk reads a theme's questions
  // aloud the same way. Talk it through in English (CramSay) asks the same server what the learner would
  // want to say from what they said in English, and imports only the NoteStore type. A word to learn goes to the note queue, where saving the note in the editor
  // (or Approve all, after its alert) is the approval.
  'a cram, which imports only the NoteStore and Repo types': [
    'src/ui/cram/CramLesson.tsx', 'src/ui/cram/CramListen.tsx', 'src/ui/cram/CramMakeCards.tsx', 'src/ui/cram/CramQuestions.tsx', 'src/ui/cram/CramSay.tsx', 'src/ui/cram/CramTalk.tsx', 'src/ui/cram/CramThemeDetail.tsx', 'src/ui/cram/CramThemes.tsx', 'src/ui/cram/CramWords.tsx',
  ],
  // The lesson word picker lists the decks' notes to choose a lesson's words from, and imports only the NoteStore type; it reads, and writes nothing.
  'the audio lesson word picker, which imports only the NoteStore type': ['src/ui/reader/LessonWordPicker.tsx'],
  // Add to deck saves a note itself in one case: after a verb is saved in the note editor, linking
  // its aspect partner already in the deck, once "Link them" is tapped in the alert that names
  // both. That tap is the approval; every new note still opens in the note editor.
  // Approve all (queued notes) saves every ready note as the editor would, once "Add N notes" is tapped in
  // the alert that names how many; the screen itself imports no writer, and an Approve all never runs
  // without that alert.
  'approved by an alert': ['src/ui/useAddMinedWord.ts', 'src/ui/useApproveQueued.ts'],
  // The review screen's "not this word" box (src/core/senseContrast.ts). It reads Read & Listen's
  // language decks and note queue to say where Add sends a word and whether one is already waiting,
  // and Add itself goes through useAddMinedWord. The one thing it saves is the card's own note with
  // a word taken out of SenseContrast, on the x's tap, with Undo. It never answers or adds a card.
  'the review screen\'s box of words a Sense rules out': ['src/ui/useSenseContrast.ts'],
};
const ALL_EXEMPT = Object.values(EXEMPT).flat();

/** Every .ts/.tsx file under `dir`, at any depth. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const path = join(dir, f);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(f) ? [path] : [];
  });
}

describe('Read & Listen', () => {
  const files = [
    ...readdirSync(READER).filter((f) => /\.tsx?$/.test(f)).map((f) => join(READER, f)),
    // Its screens and the hooks only they use (src/ui/reader/), and the pieces of it other screens hold.
    ...readdirSync(UI_READER, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f)).map((f) => join(UI_READER, f)),
    ...readdirSync(UI).filter((f) => /^(useReader\.ts|useCardGlosses\.ts|CardSentence\.tsx)$/.test(f)).map((f) => join(UI, f)),
    // read-words opens the note editor for a marked word: saving there is the approval step.
    ...readdirSync(ROUTES).filter((f) => /^read(er|-.*)?\.tsx$/.test(f)).map((f) => join(ROUTES, f)),
    // The Read & Listen tab's home (and its stack layout) lives in its own route group.
    ...readdirSync(READ_TAB).filter((f) => /\.tsx$/.test(f)).map((f) => join(READ_TAB, f)),
  ];
  for (const f of [...walk(UI), ...walk(ROUTES)]) {
    if (!files.includes(f) && USES_READER.test(readFileSync(f, 'utf8'))) files.push(f);
  }

  it('keeps its screens in src/ui/reader/, where this test looks', () => {
    const strays = readdirSync(UI).filter((f) => /^Read/.test(f));
    expect(strays, 'move these into src/ui/reader/').toEqual([]);
  });

  it('scans its logic, its screens and its routes', () => {
    expect(files.some((f) => f.endsWith('Reader.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('ReadShelf.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('ReadLanguage.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('session.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('useReader.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('useFormQuiz.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith(join('app', 'read-words.tsx')))).toBe(true);
    expect(files.some((f) => f.endsWith(join('app', 'reader.tsx')))).toBe(true);
    expect(files.some((f) => f.endsWith(join('(read)', 'read.tsx')))).toBe(true);
    // Found by its import of src/reader/, not by name or folder.
    expect(files.some((f) => f.endsWith('useAddMinedWord.ts'))).toBe(true);
  });

  it('matches what it is meant to catch', () => {
    expect(FORBIDDEN.test("import { review } from '../core/scheduler';")).toBe(true);
    expect(FORBIDDEN.test("import { writeAnkiAnswer } from '../anki/writeback';")).toBe(true);
    expect(FORBIDDEN.test("import type { Repo } from '../db/repo';")).toBe(true);
    expect(FORBIDDEN.test("import { startSession } from '../reader/session';")).toBe(false);
  });

  it('imports nothing that grades or writes cards', () => {
    const hits = files.filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(hits.filter((f) => !ALL_EXEMPT.includes(f))).toEqual([]);
  });

  it('keeps the exemptions honest', () => {
    const scanned = files.map((f) => relative(ROOT, f));
    // Each one is still scanned and still needs its exemption, and none is listed twice.
    const gone = ALL_EXEMPT.filter((f) => !scanned.includes(f));
    const clean = ALL_EXEMPT.filter((f) => scanned.includes(f) && !FORBIDDEN.test(readFileSync(join(ROOT, f), 'utf8')));
    const twice = ALL_EXEMPT.filter((f, i) => ALL_EXEMPT.indexOf(f) !== i);
    expect({ gone, clean, twice }).toEqual({ gone: [], clean: [], twice: [] });
  });
});
