/**
 * Letters as answer checks compare them, shared by the Practice tools' quizzes (src/tools/answer.ts)
 * and forms practice (forms.ts), so the two can't drift. Both take lower-case text.
 */

/**
 * Russian writes ё as е in most print, so е typed for ё (or ё for е) is the same spelling, not a
 * near miss: "елка" is "ёлка".
 */
export const foldYo = (s: string): string => s.replace(/ё/g, 'е');

/**
 * Letters that carry a mark Unicode doesn't take apart (NFD leaves ø, æ, œ and ł whole), as the
 * letters without it. Applied where marks are stripped, so "ol" for "øl" or "lza" for "łza" is a
 * near miss like a missing accent, not a different word.
 */
const UNDECOMPOSED: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ł: 'l' };
export const foldUndecomposed = (s: string): string => s.replace(/[øæœł]/g, (c) => UNDECOMPOSED[c]);
