// The marks the reader puts on words (a fill, bold text, an underline, a dot) and the key that
// explains them (ui/ReaderKey.tsx). Pure, so what the key lists is tested: it lists a mark only when
// the open text has a word wearing it, and shows that word as the sample.
import type { ReaderText, TextGrammar, TextGrammarRole, Word } from './api';
import { isName, isOutsideDeck } from './deckWords';

export type Mark = 'highlight' | 'name' | 'stretch' | 'practice' | 'avoid' | 'known' | 'marked';

// The order the key lists them in.
export const MARKS: Mark[] = ['highlight', 'name', 'stretch', 'practice', 'avoid', 'known', 'marked'];

// The two older marks have their own settings (`highlight`, `markNames` in prefs); the rest are
// kept as the list of those switched off (`hiddenMarks`).
export type HideableMark = Exclude<Mark, 'highlight' | 'name'>;
export const HIDEABLE: HideableMark[] = ['stretch', 'practice', 'avoid', 'known', 'marked'];

export const MARK_INFO: Record<Exclude<Mark, 'highlight'>, { title: string; about: string }> = {
  name: { title: 'Name', about: 'A person or place.' },
  stretch: { title: 'Practice word', about: 'A new word this text was written to teach. Gold and bold, with a small dot.' },
  practice: { title: "Grammar you're practicing", about: 'Solid green line. Tap the word to see the point.' },
  avoid: { title: "Grammar you're avoiding", about: 'Dashed gray line. It slipped into the text anyway.' },
  known: { title: 'Grammar you know', about: "Thin gray line. A point set to Know it, or one you haven't set at all." },
  marked: { title: 'Marked unknown', about: 'A word you marked as not known. Blue line.' },
};

export const HIGHLIGHT_ABOUT = 'No studied card for this word yet. Tap it to add one.';

/** Which mark a grammar point's underline is: Know it and Not set share the thin gray line. */
export function grammarMark(role: TextGrammarRole): 'practice' | 'avoid' | 'known' {
  return role === 'practice' ? 'practice' : role === 'avoid' ? 'avoid' : 'known';
}

/** A mark the open text uses, with the first word wearing it (and its grammar point, for a grammar mark). */
export type Example = { mark: Mark; word: Word; grammar: TextGrammar | null };

/**
 * The marks this text uses, in the key's order, each with a sample word from the text itself (so a
 * Thai text shows Thai and a German one German). `isFlagged` says whether the reader has marked a
 * word unknown in this reading.
 */
export function marksIn(text: ReaderText, isFlagged: (word: string) => boolean): Example[] {
  const found = new Map<Mark, Example>();
  const add = (mark: Mark, word: Word, grammar: TextGrammar | null = null) => {
    if (!found.has(mark)) found.set(mark, { mark, word, grammar });
  };
  for (const line of text.lines) {
    for (const word of line.words) {
      if (word.status === null) continue;
      if (isOutsideDeck(word)) add('highlight', word);
      if (isName(word)) add('name', word);
      if (word.stretch) add('stretch', word);
      const grammar = word.grammar ? ((text.grammar ?? []).find((g) => g.id === word.grammar) ?? null) : null;
      if (grammar) add(grammarMark(grammar.role), word, grammar);
      if (isFlagged(word.text)) add('marked', word);
    }
  }
  return MARKS.flatMap((m) => found.get(m) ?? []);
}

/** The list of hidden marks with one switched on or off. */
export function withMark(hidden: HideableMark[], mark: HideableMark, shown: boolean): HideableMark[] {
  const rest = hidden.filter((m) => m !== mark);
  return shown ? rest : [...rest, mark];
}
