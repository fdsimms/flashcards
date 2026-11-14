import type { CountingLanguage } from '../counting';
import type { Phrase, Word } from '../phrase';
import { counted } from './numbers';

/*
 * Counting things in Japanese: the noun, が, then the number with a counter chosen by the kind
 * of thing: 鉛筆が三本 (three pencils), 猫が二匹 (two cats); 三本の鉛筆 is heard too. A counter
 * changes the sound of some numbers before it (いっぽん, さんぼん, ろっぽん), and people are ひとり and
 * ふたり before さんにん.
 */

interface Counter {
  kanji: string;
  /** The counter's reading after most numbers, and after the ones it changes (by last digit), and after a ten. */
  plain: string;
  units: Record<number, string>;
  tens?: string;
  counts: string;
  /** The sound changes, for the rule after a miss. */
  changes?: string;
}

const COUNTERS: Record<string, Counter> = {
  hon: { kanji: '本', plain: 'ほん', units: { 1: 'いっぽん', 3: 'さんぼん', 6: 'ろっぽん', 8: 'はっぽん' }, tens: 'じゅっぽん', counts: 'long, thin things', changes: 'いっぽん, さんぼん, ろっぽん, はっぽん, じゅっぽん' },
  mai: { kanji: '枚', plain: 'まい', units: {}, counts: 'flat things: paper, stamps, shirts' },
  hiki: { kanji: '匹', plain: 'ひき', units: { 1: 'いっぴき', 3: 'さんびき', 6: 'ろっぴき', 8: 'はっぴき' }, tens: 'じゅっぴき', counts: 'small animals', changes: 'いっぴき, さんびき, ろっぴき, はっぴき, じゅっぴき' },
  satsu: { kanji: '冊', plain: 'さつ', units: { 1: 'いっさつ', 8: 'はっさつ' }, tens: 'じゅっさつ', counts: 'books and magazines', changes: 'いっさつ, はっさつ, じゅっさつ' },
  dai: { kanji: '台', plain: 'だい', units: {}, counts: 'machines and vehicles' },
  nin: { kanji: '人', plain: 'にん', units: { 4: 'よにん' }, counts: 'people', changes: 'ひとり, ふたり, then さんにん; 4 is よにん' },
  hai: { kanji: '杯', plain: 'はい', units: { 1: 'いっぱい', 3: 'さんばい', 6: 'ろっぱい', 8: 'はっぱい' }, tens: 'じゅっぱい', counts: 'cups and glasses of a drink', changes: 'いっぱい, さんばい, ろっぱい, はっぱい, じゅっぱい' },
  ko: { kanji: '個', plain: 'こ', units: { 1: 'いっこ', 6: 'ろっこ', 8: 'はっこ' }, tens: 'じゅっこ', counts: 'small, round things', changes: 'いっこ, ろっこ, はっこ, じゅっこ' },
  tou: { kanji: '頭', plain: 'とう', units: { 1: 'いっとう', 8: 'はっとう' }, tens: 'じゅっとう', counts: 'large animals', changes: 'いっとう, はっとう, じゅっとう' },
};

const NOUNS: { word: Word; meaning: string; counter: keyof typeof COUNTERS }[] = [
  { word: ['鉛筆', 'えんぴつ'], meaning: 'pencil', counter: 'hon' },
  { word: ['傘', 'かさ'], meaning: 'umbrella', counter: 'hon' },
  { word: ['切手', 'きって'], meaning: 'stamp', counter: 'mai' },
  { word: ['シャツ', 'シャツ'], meaning: 'shirt', counter: 'mai' },
  { word: ['猫', 'ねこ'], meaning: 'cat', counter: 'hiki' },
  { word: ['魚', 'さかな'], meaning: 'fish', counter: 'hiki' },
  { word: ['本', 'ほん'], meaning: 'book', counter: 'satsu' },
  { word: ['車', 'くるま'], meaning: 'car', counter: 'dai' },
  { word: ['学生', 'がくせい'], meaning: 'student', counter: 'nin' },
  { word: ['子供', 'こども'], meaning: 'child', counter: 'nin' },
  { word: ['コーヒー', 'コーヒー'], meaning: 'coffee', counter: 'hai' },
  { word: ['りんご', 'りんご'], meaning: 'apple', counter: 'ko' },
  { word: ['卵', 'たまご'], meaning: 'egg', counter: 'ko' },
  { word: ['牛', 'うし'], meaning: 'cow', counter: 'tou' },
];

/** `n` with `c`: 三本 さんぼん; people's first two are their own (一人 ひとり, 二人 ふたり). */
export function countWord(n: number, c: Counter): Word {
  if (c.kanji === '人' && n === 1) return ['一人', 'ひとり'];
  if (c.kanji === '人' && n === 2) return ['二人', 'ふたり'];
  // 百 doubles its last sound before a p, as 十 does: 百本 ひゃっぽん, 百匹 ひゃっぴき, 百杯 ひゃっぱい (not ひゃくほん).
  if (n === 100 && c.tens && /^じゅっ[ぱぴぽ]/.test(c.tens)) return [`百${c.kanji}`, `ひゃっ${c.tens.slice('じゅっ'.length)}`];
  return counted(n, c.kanji, c.plain, c.units, c.tens);
}

const word = ([text, roman]: Word, note?: string): Phrase => ({ text, roman, ...(note ? { note } : {}) });
const withNoun = (noun: number, [text, reading]: Word): Word => [`${NOUNS[noun].word[0]}が${text}`, `${NOUNS[noun].word[1]}が${reading}`];

export const JAPANESE_COUNTING: CountingLanguage = {
  // A word in kana already has no reading to show under it.
  nouns: NOUNS.map((x) => ({ cue: x.word[0] === x.word[1] ? { text: x.word[0] } : word(x.word), meaning: x.meaning })),
  say: (noun, n) => {
    const count = countWord(n, COUNTERS[NOUNS[noun].counter]);
    const [nounText, nounReading] = NOUNS[noun].word;
    return { everyday: word(withNoun(noun, count)), also: [word([`${count[0]}の${nounText}`, `${count[1]}の${nounReading}`])] };
  },
  wrong: (noun, n) => {
    const own = COUNTERS[NOUNS[noun].counter];
    const [plainText, plainReading] = counted(n, own.kanji, own.plain);
    // The right counter read as if it changed nothing, and other counters.
    const unchanged: Word = [plainText, plainReading];
    const others = Object.entries(COUNTERS).filter(([k]) => k !== NOUNS[noun].counter).map(([, c]) => countWord(n, c));
    return [unchanged, ...others].map((w) => word(withNoun(noun, w)));
  },
  rule: (noun) => {
    const c = COUNTERS[NOUNS[noun].counter];
    return `${c.kanji} counts ${c.counts}.${c.changes ? ` It changes the sound of some numbers: ${c.changes}.` : ''}`;
  },
  patterns: (noun, n) => [`counter:${NOUNS[noun].counter}`, `last:${n % 10}`],
  pickByReading: true,
};
