/**
 * Sentences' prompt, an English sentence built around one of the learner's words: where that word's
 * meaning sits in the sentence, so the screen can underline it. The word itself (in the language)
 * is not shown until asked for.
 */

/** The meaning's separate senses: "cat, tomcat" is tried whole, then "cat", then "tomcat". */
function senses(meaning: string): string[] {
  const whole = meaning.trim();
  return [whole, ...whole.split(/[;,/]/).map((s) => s.trim())].filter((s, i, all) => s && all.indexOf(s) === i);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `english` split around the first place `meaning` (or one of its senses) stands as a whole word,
 * ignoring case: the text before, the match as written, and the text after. Null when it isn't
 * there, since the meaning needn't be worded the same in the sentence ("to call" for "calls").
 */
export function splitAtMeaning(english: string, meaning: string): [string, string, string] | null {
  for (const sense of senses(meaning)) {
    const found = new RegExp(`(^|[^\\p{L}\\p{N}])(${escape(sense)})(?![\\p{L}\\p{N}])`, 'iu').exec(english);
    if (!found) continue;
    const start = found.index + found[1].length;
    return [english.slice(0, start), found[2], english.slice(start + found[2].length)];
  }
  return null;
}
