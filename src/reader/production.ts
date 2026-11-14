// Using the language yourself, checked by Claude on the server (docs/read-and-listen/architecture.md, Using
// the language): Use today's words after a review session, Check mine in Sentences, and Retell it after a
// text. What the check says, in words, and which words a session offers to use. Pure, so it's tested;
// nothing here grades a card or writes a note.
import type { WritingCheck } from './api';

/** The headline over a check: how it went, in plain words. */
export function verdictLine(check: WritingCheck): string {
  if (check.used_word === false) return "Almost. It doesn't use the word yet.";
  if (check.verdict === 'right') return "Right. This is how it's said.";
  if (check.verdict === 'wrong') return 'Not quite.';
  return check.notes.length > 1 ? `Almost. ${check.notes.length} things to fix.` : 'Almost. One thing to fix.';
}

export interface WordToUse {
  noteId: string;
  word: string;
  meaning: string;
}

/**
 * The words a session offers to use in a sentence: each note answered while its card was new, once, in the
 * order first answered, with its word and meaning. A note with no word or meaning is left out.
 */
export function wordsToUse(answers: readonly { noteId: string; wasNew: boolean }[], wordOf: (noteId: string) => { word: string; meaning: string } | undefined): WordToUse[] {
  const out: WordToUse[] = [];
  const seen = new Set<string>();
  for (const a of answers) {
    if (!a.wasNew || seen.has(a.noteId)) continue;
    seen.add(a.noteId);
    const w = wordOf(a.noteId);
    if (w?.word && w.meaning) out.push({ noteId: a.noteId, ...w });
  }
  return out;
}
