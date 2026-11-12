import type { Word } from './api';

// The server sends punctuation as tokens of its own, and a line wraps between any two tokens, so
// "¿" could be left at the end of a line with its word on the next. Groups are what a line may
// break between: opening punctuation stays with the word after it, closing punctuation with the
// word before it. A space is a group of its own. Thai has no spaces, so words are never joined
// to each other here, only to their punctuation.

const OPENING = /^[\p{Ps}\p{Pi}¿¡]+$/u;
const QUOTE = /^["'`]+$/;

const isBlank = (w: Word) => w.text.trim() === '';
const isPunctuation = (w: Word) => w.status === null && !isBlank(w);

export function wrapGroups(words: Word[]): Word[][] {
  const groups: Word[][] = [];
  let current: Word[] = [];
  let opening = false; // the current group ends with opening punctuation, so the next token joins it
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
    opening = false;
  };
  words.forEach((w, i) => {
    if (isBlank(w)) {
      flush();
      groups.push([w]);
    } else if (isPunctuation(w)) {
      // A straight quote opens when a space or the line's start is before it, else it closes.
      const opens = OPENING.test(w.text) || (QUOTE.test(w.text) && (i === 0 || isBlank(words[i - 1])));
      if (opens && !opening) flush();
      current.push(w);
      opening = opens;
    } else {
      if (!opening) flush();
      current.push(w);
      opening = false;
    }
  });
  flush();
  return groups;
}
