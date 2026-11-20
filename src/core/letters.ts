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

/**
 * Text with its accents and other marks taken off, for a check that forgives them: é is e, and a
 * Thai tone mark goes. Kana's voicing marks (゛ and ゜, which NFD splits off が and ぱ) stay, since
 * か for が is a different sound, not a missing accent. Takes decomposed text (NFD or NFKD).
 */
export const stripMarks = (s: string): string => s.replace(/(?![゙゚])\p{M}/gu, '');

/**
 * Text without the accents Latin, Greek and Cyrillic letters carry (é as e, й as и, ł as l), other
 * scripts' marks kept: a Thai vowel or tone mark is part of the word, not an accent, and so are
 * kana's voicing marks. For a match that forgives a missing accent (forms practice, search).
 */
export const unaccented = (s: string): string => foldUndecomposed(s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC'));
