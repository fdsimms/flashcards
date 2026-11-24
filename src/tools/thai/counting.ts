import type { CountingLanguage } from '../counting';
import { THAI_COUNTING_WORDS } from '../../core/thaiCounting';
import { phrase, type Word } from '../phrase';
import { thaiNumber } from './numbers';

/*
 * Counting things in Thai: the noun, the number, then a classifier chosen by the kind of thing:
 * แมวสามตัว (three cats), นักเรียนห้าคน (five students). Once it's clear what's counted, the
 * number and the classifier alone are enough: สามตัว.
 */

interface Classifier {
  word: Word;
  /** What it counts, for the rule after a miss. */
  counts: string;
}

const CLASSIFIERS: Record<string, Classifier> = {
  tua: { word: ['ตัว', 'dtua'], counts: THAI_COUNTING_WORDS['ตัว'].counts },
  khon: { word: ['คน', 'khon'], counts: THAI_COUNTING_WORDS['คน'].counts },
  lem: { word: ['เล่ม', 'lêm'], counts: THAI_COUNTING_WORDS['เล่ม'].counts },
  khan: { word: ['คัน', 'khan'], counts: THAI_COUNTING_WORDS['คัน'].counts },
  bai: { word: ['ใบ', 'bai'], counts: THAI_COUNTING_WORDS['ใบ'].counts },
  luuk: { word: ['ลูก', 'lûuk'], counts: THAI_COUNTING_WORDS['ลูก'].counts },
  lang: { word: ['หลัง', 'lǎng'], counts: THAI_COUNTING_WORDS['หลัง'].counts },
  khuat: { word: ['ขวด', 'khùat'], counts: THAI_COUNTING_WORDS['ขวด'].counts },
  gaew: { word: ['แก้ว', 'gâew'], counts: THAI_COUNTING_WORDS['แก้ว'].counts },
};

/** `alsoRight`: another classifier that's also correct for it (a drink by the glass or the bottle), so never offered as a wrong one. */
const NOUNS: { word: Word; meaning: string; classifier: keyof typeof CLASSIFIERS; alsoRight?: keyof typeof CLASSIFIERS }[] = [
  { word: ['แมว', 'maew'], meaning: 'cat', classifier: 'tua' },
  { word: ['หมา', 'mǎa'], meaning: 'dog', classifier: 'tua' },
  { word: ['โต๊ะ', 'dtó'], meaning: 'table', classifier: 'tua' },
  { word: ['เสื้อ', 'sûea'], meaning: 'shirt', classifier: 'tua' },
  { word: ['นักเรียน', 'nák-rian'], meaning: 'student', classifier: 'khon' },
  { word: ['เด็ก', 'dèk'], meaning: 'child', classifier: 'khon' },
  { word: ['หนังสือ', 'nǎng-sǔue'], meaning: 'book', classifier: 'lem' },
  { word: ['รถ', 'rót'], meaning: 'car', classifier: 'khan' },
  { word: ['ร่ม', 'rôm'], meaning: 'umbrella', classifier: 'khan' },
  { word: ['กระเป๋า', 'grà-bpǎo'], meaning: 'bag', classifier: 'bai' },
  { word: ['ส้ม', 'sôm'], meaning: 'orange', classifier: 'luuk' },
  { word: ['บ้าน', 'bâan'], meaning: 'house', classifier: 'lang' },
  { word: ['เบียร์', 'bia'], meaning: 'beer', classifier: 'khuat', alsoRight: 'gaew' },
  { word: ['กาแฟ', 'gaa-fae'], meaning: 'coffee', classifier: 'gaew', alsoRight: 'khuat' },
];

const counted = (noun: number, n: number, classifier: Classifier) => phrase([NOUNS[noun].word, ...thaiNumber(n), classifier.word], '');

export const THAI_COUNTING: CountingLanguage = {
  nouns: NOUNS.map((x) => ({ cue: phrase([x.word], ''), meaning: x.meaning })),
  say: (noun, n) => {
    const c = CLASSIFIERS[NOUNS[noun].classifier];
    return { everyday: counted(noun, n, c), also: [phrase([...thaiNumber(n), c.word], '', "Once it's clear what's counted")] };
  },
  wrong: (noun, n) => Object.entries(CLASSIFIERS).filter(([k]) => k !== NOUNS[noun].classifier && k !== NOUNS[noun].alsoRight).map(([, c]) => counted(noun, n, c)),
  rule: (noun) => {
    const c = CLASSIFIERS[NOUNS[noun].classifier];
    return `${c.word[0]} (${c.word[1]}) counts ${c.counts}. The noun comes first, then the number, then the classifier.`;
  },
  patterns: (noun) => [`classifier:${NOUNS[noun].classifier}`],
  counterWord: (noun) => CLASSIFIERS[NOUNS[noun].classifier].word[0],
};
