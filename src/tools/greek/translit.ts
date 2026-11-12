/**
 * Modern Greek in Latin letters as it's pronounced, for a learner: "δύο και μισή" is "dío ke misí".
 * The stress accent is kept on the vowel that carries it. Simplified on purpose: δ is d (it sounds
 * like the "th" in "this"), γ is g, or y before e and i sounds, and χ is h. Digraphs are read as
 * one sound (αι e, ει/οι/υι i, ου ou, μπ b/mb, ντ d/nd, γκ g/ng, γγ ng), αυ and ευ are av/ev before
 * a voiced sound and af/ef before a voiceless one, and a diaeresis (ϊ) keeps two vowels apart.
 */

const LETTERS: Record<string, string> = {
  α: 'a', ά: 'á', β: 'v', γ: 'g', δ: 'd', ε: 'e', έ: 'é', ζ: 'z', η: 'i', ή: 'í', θ: 'th', ι: 'i', ί: 'í',
  ϊ: 'i', ΐ: 'í', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', ό: 'ó', π: 'p', ρ: 'r', σ: 's', ς: 's',
  τ: 't', υ: 'i', ύ: 'í', ϋ: 'i', ΰ: 'í', φ: 'f', χ: 'h', ψ: 'ps', ω: 'o', ώ: 'ó',
};

/** Two vowels read as one sound: the second letter, accented or not, and what the pair reads as. */
const DIGRAPHS: Record<string, [plain: string, stressed: string]> = {
  αι: ['e', 'é'], ει: ['i', 'í'], οι: ['i', 'í'], υι: ['i', 'í'], ου: ['ou', 'oú'],
};

const UNACCENT: Record<string, string> = { ά: 'α', έ: 'ε', ή: 'η', ί: 'ι', ό: 'ο', ύ: 'υ', ώ: 'ω' };
const ACCENTED = new Set(Object.keys(UNACCENT));
/** After αυ/ευ these make it af/ef. */
const VOICELESS = new Set(['θ', 'κ', 'ξ', 'π', 'σ', 'ς', 'τ', 'φ', 'χ', 'ψ']);
/** Before these γ sounds like y. */
const FRONT = new Set(['ε', 'έ', 'η', 'ή', 'ι', 'ί', 'ϊ', 'ΐ', 'υ', 'ύ']);
const isLetter = (ch: string | undefined) => !!ch && /\p{Script=Greek}/u.test(ch);

export function greekRoman(text: string): string {
  const s = text.toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const nx = s[i + 1];
    const base = (c: string | undefined) => (c ? UNACCENT[c] ?? c : c);
    const pair = ch + (base(nx) ?? '');
    const wordStart = !isLetter(s[i - 1]);
    // αυ, ευ: v or f, the accent (on υ) moving onto the vowel before it.
    if ((ch === 'α' || ch === 'ε' || ch === 'ά' || ch === 'έ') && (nx === 'υ' || nx === 'ύ')) {
      const stressed = ACCENTED.has(ch) || nx === 'ύ';
      const vowel = base(ch) === 'α' ? (stressed ? 'á' : 'a') : stressed ? 'é' : 'e';
      const after = s[i + 2];
      out += vowel + (after === undefined || !isLetter(after) || VOICELESS.has(after) ? 'f' : 'v');
      i++;
      continue;
    }
    if (DIGRAPHS[pair] && !ACCENTED.has(ch) && nx !== 'ϊ' && nx !== 'ΐ') {
      out += DIGRAPHS[pair][ACCENTED.has(nx!) ? 1 : 0];
      i++;
      continue;
    }
    if (ch === 'μ' && nx === 'π') { out += wordStart ? 'b' : 'mb'; i++; continue; }
    if (ch === 'ν' && nx === 'τ') { out += wordStart ? 'd' : 'nd'; i++; continue; }
    if (ch === 'γ' && nx === 'κ') { out += wordStart ? 'g' : 'ng'; i++; continue; }
    if (ch === 'γ' && nx === 'γ') { out += 'ng'; i++; continue; }
    if (ch === 'γ' && (nx === 'χ' || nx === 'ξ')) { out += 'n'; continue; }
    if (ch === 'τ' && nx === 'σ') { out += 'ts'; i++; continue; }
    if (ch === 'τ' && nx === 'ζ') { out += 'tz'; i++; continue; }
    if (ch === 'γ') { out += FRONT.has(nx ?? '') || (nx === 'α' && s[i + 2] === 'ι') || (nx === 'ο' && s[i + 2] === 'ι') ? 'y' : 'g'; continue; }
    out += LETTERS[ch] ?? ch;
  }
  return out;
}
