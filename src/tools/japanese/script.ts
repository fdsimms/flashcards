import type { ScriptLanguage } from '../script';

/*
 * Reading kana aloud: words in hiragana and in katakana, picked for the spellings that trip a
 * reader up rather than for the kana themselves. A small っ doubles the consonant after it; a small
 * ゃ, ゅ or ょ joins the kana before it into one syllable (きょ is kyo, not kiyo); katakana's ー
 * lengthens a vowel, and hiragana writes the same with a vowel kana (こう is kō); ん is a syllable
 * of its own; and katakana writes sounds Japanese lacks with a small vowel (ティ, フォ). The answer
 * is the word in Hepburn romaji, long vowels with a macron. Kanji are WaniKani's to teach.
 */

/** Each word in kana, in Hepburn romaji (an apostrophe after an ん read on its own), and its meaning. */
const WORDS: [kana: string, romaji: string, meaning: string][] = [
  ['きって', 'kitte', 'stamp'], ['ざっし', 'zasshi', 'magazine'], ['いっしょ', 'issho', 'together'],
  ['ちょっと', 'chotto', 'a little'], ['がっこう', 'gakkō', 'school'], ['きょう', 'kyō', 'today'],
  ['しゃしん', 'shashin', 'photo'], ['きゃく', 'kyaku', 'guest'], ['りょこう', 'ryokō', 'trip'],
  ['ぎゅうにゅう', 'gyūnyū', 'milk'], ['びょういん', 'byōin', 'hospital'], ['びよういん', 'biyōin', 'hair salon'],
  ['おばあさん', 'obāsan', 'grandmother'], ['おばさん', 'obasan', 'aunt'], ['おじいさん', 'ojīsan', 'grandfather'],
  ['せんせい', 'sensē', 'teacher'], ['とけい', 'tokē', 'clock'], ['くうき', 'kūki', 'air'],
  ['ふつう', 'futsū', 'usual'], ['おとうさん', 'otōsan', 'father'], ['ほんや', "hon'ya", 'bookstore'],
  ['きんえん', "kin'en", 'no smoking'], ['でんわ', 'denwa', 'phone'],
  ['コーヒー', 'kōhī', 'coffee'], ['ケーキ', 'kēki', 'cake'], ['スーパー', 'sūpā', 'supermarket'],
  ['チョコレート', 'chokorēto', 'chocolate'], ['コンピューター', 'konpyūtā', 'computer'], ['ベッド', 'beddo', 'bed'],
  ['カップ', 'kappu', 'cup'], ['シャツ', 'shatsu', 'shirt'], ['ジュース', 'jūsu', 'juice'], ['メニュー', 'menyū', 'menu'],
  ['ティッシュ', 'tisshu', 'tissue'], ['フォーク', 'fōku', 'fork'], ['パーティー', 'pātī', 'party'],
];

/** What a word's spelling holds that's worth a rule. */
type Feature = 'small-tsu' | 'small-ya' | 'long-mark' | 'long-vowel' | 'small-vowel' | 'n-apart';

/** How hiragana writes each long vowel, as these words spell it: ō as おう, ē as えい. */
const LONG_RULES: Record<string, string> = {
  ā: 'あ after an a makes it a long ā.',
  ī: 'い after an i makes it a long ī.',
  ū: 'う after another u makes it a long ū.',
  ē: 'い after an e makes it a long ē.',
  ō: 'う after an o makes it a long ō.',
};

function features(kana: string, romaji: string): Feature[] {
  const out: Feature[] = [];
  if (/[っッ]/.test(kana)) out.push('small-tsu');
  if (/[ゃゅょャュョ]/.test(kana)) out.push('small-ya');
  if (kana.includes('ー')) out.push('long-mark');
  else if (/[āīūēō]/.test(romaji)) out.push('long-vowel');
  if (/[ァィゥェォ]/.test(kana)) out.push('small-vowel');
  if (romaji.includes("n'")) out.push('n-apart');
  return out;
}

/** The long vowels a hiragana word writes with a vowel kana, each once, in order. */
function longVowels(romaji: string): string[] {
  return [...new Set(romaji.match(/[āīūēō]/g) ?? [])];
}

function ruleFor(kana: string, romaji: string): string | undefined {
  const lines = features(kana, romaji).map((f) => {
    switch (f) {
      case 'small-tsu': return `A small ${kana.includes('っ') ? 'っ' : 'ッ'} doubles the consonant after it, with a short stop before it.`;
      case 'small-ya': return 'A small ゃ, ゅ or ょ joins the kana before it into one syllable: きょ is kyo, not kiyo.';
      case 'long-mark': return 'ー makes the vowel before it long.';
      case 'long-vowel': return longVowels(romaji).map((v) => LONG_RULES[v]).join(' ');
      case 'small-vowel': return 'A small vowel after a katakana writes a sound Japanese lacks: ティ is ti, フォ is fo.';
      case 'n-apart': return `ん is a syllable of its own, so the next vowel or y starts a new one: ${romaji}.`;
    }
  });
  return lines.length ? lines.join(' ') : undefined;
}

export const JAPANESE_SCRIPT: ScriptLanguage = {
  words: WORDS.map(([kana, romaji, meaning]) => ({ shown: kana, meaning, answer: { text: kana, roman: romaji } })),
  rule: (i) => ruleFor(WORDS[i][0], WORDS[i][1]),
  patterns: (i) => features(WORDS[i][0], WORDS[i][1]),
};
