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

/** Where a Thai mark goes among the marks on one consonant: vowel signs, then tone, then the rest. */
function thaiMarkRank(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c === 0x0e31 || (c >= 0x0e34 && c <= 0x0e3a) || c === 0x0e47) return 0;
  if (c >= 0x0e48 && c <= 0x0e4b) return 1;
  if (c === 0x0e4c) return 2;
  return 3; // ํ, which with า after it is ำ
}

/**
 * Text in NFC, with Thai written the one way it looks. NFC leaves Thai alone, and Thai can be typed
 * in more than one order that draws the same: ที่ as ท + ่ + ี, น้ำ as น + ํ + ้ + า. Each consonant's
 * marks are put in the usual order (vowel sign, tone mark, then the rest), a doubled mark is
 * dropped, and ํ followed by า is written ำ. Every check that compares a typed answer uses it, so
 * an answer that looks right is never marked different.
 */
export function canonicalText(s: string): string {
  const nfc = s.normalize('NFC');
  if (!/[฀-๿]/.test(nfc)) return nfc;
  return nfc
    .replace(/ำ/g, 'ํา')
    .replace(/[ัิ-ฺ็-๎]+/g, (run) => {
      const marks = [...new Set(Array.from(run))];
      return marks.sort((a, b) => thaiMarkRank(a) - thaiMarkRank(b)).join('');
    })
    .replace(/ํา/g, 'ำ');
}
