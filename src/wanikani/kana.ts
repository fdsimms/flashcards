/**
 * Typing a reading on an English keyboard: romaji turns into hiragana as it's typed, the way
 * WaniKani's answer box does it (and IMEs generally). Kana typed with a Japanese keyboard is left
 * alone. Katakana counts as the hiragana it spells when answers are compared.
 */

const BASE: Record<string, string> = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  la: 'ら', li: 'り', lu: 'る', le: 'れ', lo: 'ろ',
  wa: 'わ', wi: 'うぃ', we: 'うぇ', wo: 'を',
  va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
  ja: 'じゃ', ju: 'じゅ', je: 'じぇ', jo: 'じょ',
  sha: 'しゃ', shu: 'しゅ', she: 'しぇ', sho: 'しょ',
  cha: 'ちゃ', chu: 'ちゅ', che: 'ちぇ', cho: 'ちょ',
  tsa: 'つぁ', thi: 'てぃ', dhi: 'でぃ',
  "n'": 'ん', xn: 'ん',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ', xtu: 'っ', xtsu: 'っ', xwa: 'ゎ',
  lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ', ltu: 'っ', ltsu: 'っ',
  '-': 'ー',
};

// The y-combinations: kya, gyu, nyo and the rest, from each consonant's i-kana.
for (const [c, i] of Object.entries({ k: 'き', g: 'ぎ', s: 'し', z: 'じ', t: 'ち', d: 'ぢ', n: 'に', h: 'ひ', b: 'び', p: 'ぴ', m: 'み', r: 'り', l: 'り' })) {
  BASE[`${c}ya`] = `${i}ゃ`;
  BASE[`${c}yu`] = `${i}ゅ`;
  BASE[`${c}ye`] = `${i}ぇ`;
  BASE[`${c}yo`] = `${i}ょ`;
}
BASE.jya = 'じゃ';
BASE.jyu = 'じゅ';
BASE.jyo = 'じょ';
BASE.cya = 'ちゃ';
BASE.cyu = 'ちゅ';
BASE.cyo = 'ちょ';

const LONGEST = Math.max(...Object.keys(BASE).map((k) => k.length));
const CONSONANT = /^[bcdfghjklmpqrstvwxyz]$/;

/**
 * `input` with its romaji turned into hiragana. While typing (`final` false) a trailing "n" or an
 * unfinished syllable stays as letters, since the next key may change it ("n" then "a" is な, not
 * んあ); once the answer is submitted (`final`), a lone "n" is ん.
 */
export function toKana(input: string, final = false): string {
  const s = input.toLowerCase();
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // "nn" is ん, but in "konnichi" the second n starts に: before a vowel or y only one n is used.
    // At the end, while typing, both stay letters: the next key decides.
    if (ch === 'n' && s[i + 1] === 'n') {
      const after = s[i + 2];
      if (after !== undefined && /[aiueoy]/.test(after)) {
        out += 'ん';
        i++;
      } else if (after === undefined && !final) {
        out += input.slice(i, i + 2);
        i += 2;
      } else {
        out += 'ん';
        i += 2;
      }
      continue;
    }
    // A doubled consonant (other than n) is a small つ: "kitte" is きって.
    if (CONSONANT.test(ch) && ch !== 'n' && s[i + 1] === ch) {
      out += 'っ';
      i++;
      continue;
    }
    let matched = false;
    for (let len = Math.min(LONGEST, s.length - i); len > 0; len--) {
      const kana = BASE[s.slice(i, i + len)];
      if (kana) {
        out += kana;
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // "n" before a consonant other than y (or n, handled above), or before anything that isn't a
    // letter, is ん: "kanji" is かんじ.
    if (ch === 'n' && i + 1 < s.length && ((CONSONANT.test(s[i + 1]) && s[i + 1] !== 'y') || !/[a-z']/.test(s[i + 1]))) {
      out += 'ん';
      i++;
      continue;
    }
    if (ch === 'n' && i + 1 === s.length && final) {
      out += 'ん';
      i++;
      continue;
    }
    out += input[i];
    i++;
  }
  return out;
}

/** Katakana turned into the hiragana it spells; everything else as it is. */
export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (k) => String.fromCharCode(k.charCodeAt(0) - 0x60));
}

/** Whether the text is all kana (and the long-vowel mark), ignoring spaces. */
export function isKana(s: string): boolean {
  const t = s.replace(/\s/g, '');
  return t.length > 0 && /^[ぁ-ゖァ-ヺー・]+$/.test(t);
}

/** Whether the text has any kana or kanji in it. */
export function hasJapanese(s: string): boolean {
  return /[ぁ-ゖァ-ヺ一-鿿]/.test(s);
}
