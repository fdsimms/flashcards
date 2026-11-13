import type { ScriptLanguage } from '../script';

/*
 * Reading Thai's tones from the script. A syllable's tone comes from three things: the class of
 * its first consonant (middle, high or low), its tone mark if it has one, and, with no mark,
 * whether it's live (a long vowel, or ending in m, n, ng, y or w) or dead (a short vowel, or
 * ending in p, t or k), and for a dead low-class syllable, its vowel's length. A ห in front of a
 * low-class consonant makes it high (หมา). `toneOf` works the tone out from those; the tests check
 * it against each word's romanization, which carries its tone.
 */

export type ToneClass = 'mid' | 'high' | 'low';
export type ToneMark = 'none' | 'ek' | 'tho' | 'tri' | 'chattawa';
export type Tone = 'mid' | 'low' | 'falling' | 'high' | 'rising';

export const TONES: Tone[] = ['mid', 'low', 'falling', 'high', 'rising'];
export const TONE_NAMES: Record<Tone, string> = { mid: 'Mid', low: 'Low', falling: 'Falling', high: 'High', rising: 'Rising' };

export interface Syllable {
  text: string;
  /** Romanized, its tone on the vowel: none mid, ` low, ^ falling, ´ high, ˇ rising. */
  roman: string;
  meaning: string;
  /** The consonant whose class sets the tone, as written. */
  initial: string;
  cls: ToneClass;
  /** A ห before a low-class consonant, which makes it high. */
  leadingH?: boolean;
  mark: ToneMark;
  /** With no mark: live or dead, and for dead, the vowel's length. */
  live: boolean;
  long: boolean;
}

export const SYLLABLES: Syllable[] = [
  { text: 'กา', roman: 'gaa', meaning: 'crow', initial: 'ก', cls: 'mid', mark: 'none', live: true, long: true },
  { text: 'ดี', roman: 'dii', meaning: 'good', initial: 'ด', cls: 'mid', mark: 'none', live: true, long: true },
  { text: 'ไก่', roman: 'gài', meaning: 'chicken', initial: 'ก', cls: 'mid', mark: 'ek', live: true, long: false },
  { text: 'ป่า', roman: 'bpàa', meaning: 'forest', initial: 'ป', cls: 'mid', mark: 'ek', live: true, long: true },
  { text: 'ป้า', roman: 'bpâa', meaning: 'aunt', initial: 'ป', cls: 'mid', mark: 'tho', live: true, long: true },
  { text: 'บ้าน', roman: 'bâan', meaning: 'house', initial: 'บ', cls: 'mid', mark: 'tho', live: true, long: true },
  { text: 'โต๊ะ', roman: 'dtó', meaning: 'table', initial: 'ต', cls: 'mid', mark: 'tri', live: false, long: false },
  { text: 'จ๋า', roman: 'jǎa', meaning: '(a sweet "yes?")', initial: 'จ', cls: 'mid', mark: 'chattawa', live: true, long: true },
  { text: 'กับ', roman: 'gàp', meaning: 'with', initial: 'ก', cls: 'mid', mark: 'none', live: false, long: false },
  { text: 'เด็ก', roman: 'dèk', meaning: 'child', initial: 'ด', cls: 'mid', mark: 'none', live: false, long: false },
  { text: 'ขา', roman: 'khǎa', meaning: 'leg', initial: 'ข', cls: 'high', mark: 'none', live: true, long: true },
  { text: 'สาม', roman: 'sǎam', meaning: 'three', initial: 'ส', cls: 'high', mark: 'none', live: true, long: true },
  { text: 'ผม', roman: 'phǒm', meaning: 'hair; I', initial: 'ผ', cls: 'high', mark: 'none', live: true, long: false },
  { text: 'ข่าว', roman: 'khàao', meaning: 'news', initial: 'ข', cls: 'high', mark: 'ek', live: true, long: true },
  { text: 'ข้าว', roman: 'khâao', meaning: 'rice', initial: 'ข', cls: 'high', mark: 'tho', live: true, long: true },
  { text: 'สุข', roman: 'sùk', meaning: 'happy', initial: 'ส', cls: 'high', mark: 'none', live: false, long: false },
  { text: 'ถูก', roman: 'thùuk', meaning: 'cheap', initial: 'ถ', cls: 'high', mark: 'none', live: false, long: true },
  { text: 'หมา', roman: 'mǎa', meaning: 'dog', initial: 'ม', cls: 'low', leadingH: true, mark: 'none', live: true, long: true },
  { text: 'หนึ่ง', roman: 'nùeng', meaning: 'one', initial: 'น', cls: 'low', leadingH: true, mark: 'ek', live: true, long: false },
  { text: 'มา', roman: 'maa', meaning: 'come', initial: 'ม', cls: 'low', mark: 'none', live: true, long: true },
  { text: 'นอน', roman: 'noon', meaning: 'sleep', initial: 'น', cls: 'low', mark: 'none', live: true, long: true },
  { text: 'แม่', roman: 'mâe', meaning: 'mother', initial: 'ม', cls: 'low', mark: 'ek', live: true, long: true },
  { text: 'พ่อ', roman: 'phôo', meaning: 'father', initial: 'พ', cls: 'low', mark: 'ek', live: true, long: true },
  { text: 'ม้า', roman: 'máa', meaning: 'horse', initial: 'ม', cls: 'low', mark: 'tho', live: true, long: true },
  { text: 'น้ำ', roman: 'náam', meaning: 'water', initial: 'น', cls: 'low', mark: 'tho', live: true, long: true },
  { text: 'ซื้อ', roman: 'súue', meaning: 'buy', initial: 'ซ', cls: 'low', mark: 'tho', live: true, long: true },
  { text: 'รัก', roman: 'rák', meaning: 'love', initial: 'ร', cls: 'low', mark: 'none', live: false, long: false },
  { text: 'คิด', roman: 'khít', meaning: 'think', initial: 'ค', cls: 'low', mark: 'none', live: false, long: false },
  { text: 'มาก', roman: 'mâak', meaning: 'much', initial: 'ม', cls: 'low', mark: 'none', live: false, long: true },
  { text: 'ชอบ', roman: 'chôop', meaning: 'like', initial: 'ช', cls: 'low', mark: 'none', live: false, long: true },
  { text: 'ลูก', roman: 'lûuk', meaning: 'child (one\'s own)', initial: 'ล', cls: 'low', mark: 'none', live: false, long: true },
];

/** The class that sets the tone: a ห in front makes a low-class consonant high. */
export const effectiveClass = (s: Syllable): ToneClass => (s.leadingH ? 'high' : s.cls);

/** The tone, from the class, the mark, and with no mark, live or dead and the vowel's length. */
export function toneOf(s: Syllable): Tone {
  const cls = effectiveClass(s);
  switch (s.mark) {
    case 'ek': return cls === 'low' ? 'falling' : 'low';
    case 'tho': return cls === 'low' ? 'high' : 'falling';
    case 'tri': return 'high';
    case 'chattawa': return 'rising';
    case 'none':
      if (s.live) return cls === 'high' ? 'rising' : 'mid';
      if (cls !== 'low') return 'low';
      return s.long ? 'falling' : 'high';
  }
}

/** The tone a romanization carries: none mid, ` low, ^ falling, ´ high, ˇ rising. */
export function toneOfRoman(roman: string): Tone {
  const marks = roman.normalize('NFD');
  if (marks.includes('̀')) return 'low';
  if (marks.includes('̂')) return 'falling';
  if (marks.includes('́')) return 'high';
  if (marks.includes('̌')) return 'rising';
  return 'mid';
}

const CLASS_NAMES: Record<ToneClass, string> = { mid: 'middle', high: 'high', low: 'low' };
const MARK_NAMES: Record<Exclude<ToneMark, 'none'>, string> = { ek: '่ mai ek', tho: '้ mai tho', tri: '๊ mai tri', chattawa: '๋ mai chattawa' };

/** How the tone is worked out, a line for each step. */
export function toneSteps(s: Syllable): string[] {
  const steps = [s.leadingH
    ? `${s.initial} is low class, but ห in front makes it high.`
    : `${s.initial} is a ${CLASS_NAMES[s.cls]}-class consonant.`];
  if (s.mark !== 'none') steps.push(`${MARK_NAMES[s.mark]}: with a tone mark, the mark and the class decide the tone.`);
  else if (s.live) steps.push('No tone mark, and a live syllable: a long vowel, or it ends in m, n, ng, y or w.');
  else steps.push(`No tone mark, and a dead syllable: ${s.long ? 'a long vowel' : 'a short vowel'} ending in p, t or k, or a short vowel alone.`);
  steps.push(`So the tone is ${TONE_NAMES[toneOf(s)].toLowerCase()}.`);
  return steps;
}

export const THAI_SCRIPT: ScriptLanguage = {
  words: SYLLABLES.map((s) => ({ shown: s.text, meaning: s.meaning, answer: { text: s.text, roman: s.roman } })),
  rule: (i) => toneSteps(SYLLABLES[i]).join(' '),
  patterns: (i) => {
    const s = SYLLABLES[i];
    return [`class:${effectiveClass(s)}`, `mark:${s.mark === 'none' ? (s.live ? 'live' : 'dead') : s.mark}`];
  },
};
