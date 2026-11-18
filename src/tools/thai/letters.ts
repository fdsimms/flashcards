import type { ToneClass } from './script';

/*
 * Thai's letters, to read in Reading the script: the 44 consonants (their class, name, a word that
 * starts with them and how they sound at the start and the end of a syllable) and the vowels
 * (shown on ก, short or long). A consonant's class sets a syllable's tone (script.ts) and a
 * vowel's length decides whether a syllable with no tone mark is live or dead, so these are the
 * two things the tone rules start from. Pure; nothing is scheduled or saved.
 */

export const CLASS_NAMES: Record<ToneClass, string> = { mid: 'Middle', high: 'High', low: 'Low' };
export const CLASSES: ToneClass[] = ['mid', 'high', 'low'];

export interface Consonant {
  letter: string;
  /** The letter's name in Thai, to read aloud (a consonant's name is its sound with อ, then a word). */
  say: string;
  /** The same, romanized. */
  name: string;
  /** The word that starts with the letter, and its meaning. */
  word: string;
  meaning: string;
  /** How it sounds at the start of a syllable; empty for อ, which is silent there. */
  initial: string;
  /** How it sounds at the end of a syllable; none for a letter that doesn't close one. */
  final?: string;
  cls: ToneClass;
  /** Rarely met: `obsolete` no longer used in any word, `uncommon` kept for a few words from Pali and Sanskrit. */
  rarity?: 'obsolete' | 'uncommon';
}

export const CONSONANTS: Consonant[] = [
  { letter: 'ก', say: 'กอ ไก่', name: 'gaaw gài', word: 'ไก่', meaning: 'chicken', initial: 'g', final: 'k', cls: 'mid' },
  { letter: 'จ', say: 'จอ จาน', name: 'jaaw jaan', word: 'จาน', meaning: 'plate', initial: 'j', final: 't', cls: 'mid' },
  { letter: 'ด', say: 'ดอ เด็ก', name: 'daaw dèk', word: 'เด็ก', meaning: 'child', initial: 'd', final: 't', cls: 'mid' },
  { letter: 'ต', say: 'ตอ เต่า', name: 'dtaaw dtào', word: 'เต่า', meaning: 'turtle', initial: 'dt', final: 't', cls: 'mid' },
  { letter: 'ฎ', say: 'ดอ ชฎา', name: 'daaw chá-daa', word: 'ชฎา', meaning: 'a dancer\'s crown', initial: 'd', final: 't', cls: 'mid', rarity: 'uncommon' },
  { letter: 'ฏ', say: 'ตอ ปฏัก', name: 'dtaaw bpà-dtàk', word: 'ปฏัก', meaning: 'a goad', initial: 'dt', final: 't', cls: 'mid', rarity: 'uncommon' },
  { letter: 'บ', say: 'บอ ใบไม้', name: 'baaw bai-máai', word: 'ใบไม้', meaning: 'leaf', initial: 'b', final: 'p', cls: 'mid' },
  { letter: 'ป', say: 'ปอ ปลา', name: 'bpaaw bplaa', word: 'ปลา', meaning: 'fish', initial: 'bp', final: 'p', cls: 'mid' },
  { letter: 'อ', say: 'ออ อ่าง', name: 'aaw àang', word: 'อ่าง', meaning: 'basin', initial: '', cls: 'mid' },

  { letter: 'ข', say: 'ขอ ไข่', name: 'khǎaw khài', word: 'ไข่', meaning: 'egg', initial: 'kh', final: 'k', cls: 'high' },
  { letter: 'ฃ', say: 'ขอ ฃวด', name: 'khǎaw khùat', word: 'ฃวด', meaning: 'bottle', initial: 'kh', final: 'k', cls: 'high', rarity: 'obsolete' },
  { letter: 'ฉ', say: 'ฉอ ฉิ่ง', name: 'chǎaw chìng', word: 'ฉิ่ง', meaning: 'small cymbals', initial: 'ch', final: 't', cls: 'high' },
  { letter: 'ถ', say: 'ถอ ถุง', name: 'thǎaw thǔng', word: 'ถุง', meaning: 'bag', initial: 'th', final: 't', cls: 'high' },
  { letter: 'ฐ', say: 'ถอ ฐาน', name: 'thǎaw thǎan', word: 'ฐาน', meaning: 'base', initial: 'th', final: 't', cls: 'high', rarity: 'uncommon' },
  { letter: 'ผ', say: 'ผอ ผึ้ง', name: 'phǎaw phûeng', word: 'ผึ้ง', meaning: 'bee', initial: 'ph', final: 'p', cls: 'high' },
  { letter: 'ฝ', say: 'ฝอ ฝา', name: 'fǎaw fǎa', word: 'ฝา', meaning: 'lid', initial: 'f', final: 'p', cls: 'high' },
  { letter: 'ศ', say: 'สอ ศาลา', name: 'sǎaw sǎa-laa', word: 'ศาลา', meaning: 'open pavilion', initial: 's', final: 't', cls: 'high' },
  { letter: 'ษ', say: 'สอ ฤๅษี', name: 'sǎaw ruue-sǐi', word: 'ฤๅษี', meaning: 'hermit', initial: 's', final: 't', cls: 'high' },
  { letter: 'ส', say: 'สอ เสือ', name: 'sǎaw sǔea', word: 'เสือ', meaning: 'tiger', initial: 's', final: 't', cls: 'high' },
  { letter: 'ห', say: 'หอ หีบ', name: 'hǎaw hìip', word: 'หีบ', meaning: 'chest, box', initial: 'h', cls: 'high' },

  { letter: 'ค', say: 'คอ ควาย', name: 'khaaw khwaai', word: 'ควาย', meaning: 'buffalo', initial: 'kh', final: 'k', cls: 'low' },
  { letter: 'ฅ', say: 'คอ ฅน', name: 'khaaw khon', word: 'ฅน', meaning: 'person', initial: 'kh', final: 'k', cls: 'low', rarity: 'obsolete' },
  { letter: 'ฆ', say: 'คอ ระฆัง', name: 'khaaw rá-khang', word: 'ระฆัง', meaning: 'bell', initial: 'kh', final: 'k', cls: 'low', rarity: 'uncommon' },
  { letter: 'ง', say: 'งอ งู', name: 'ngaaw nguu', word: 'งู', meaning: 'snake', initial: 'ng', final: 'ng', cls: 'low' },
  { letter: 'ช', say: 'ชอ ช้าง', name: 'chaaw cháang', word: 'ช้าง', meaning: 'elephant', initial: 'ch', final: 't', cls: 'low' },
  { letter: 'ซ', say: 'ซอ โซ่', name: 'saaw sôo', word: 'โซ่', meaning: 'chain', initial: 's', final: 't', cls: 'low' },
  { letter: 'ฌ', say: 'ชอ เฌอ', name: 'chaaw chəə', word: 'เฌอ', meaning: 'tree', initial: 'ch', final: 't', cls: 'low', rarity: 'uncommon' },
  { letter: 'ญ', say: 'ยอ หญิง', name: 'yaaw yǐng', word: 'หญิง', meaning: 'woman', initial: 'y', final: 'n', cls: 'low' },
  { letter: 'ฑ', say: 'ทอ มณโฑ', name: 'thaaw mon-too', word: 'มณโฑ', meaning: 'Montho, a queen in the Ramakien', initial: 'th', final: 't', cls: 'low', rarity: 'uncommon' },
  { letter: 'ฒ', say: 'ทอ ผู้เฒ่า', name: 'thaaw phûu-thâo', word: 'ผู้เฒ่า', meaning: 'elder', initial: 'th', final: 't', cls: 'low', rarity: 'uncommon' },
  { letter: 'ณ', say: 'นอ เณร', name: 'naaw neen', word: 'เณร', meaning: 'novice monk', initial: 'n', final: 'n', cls: 'low' },
  { letter: 'ท', say: 'ทอ ทหาร', name: 'thaaw tá-hǎan', word: 'ทหาร', meaning: 'soldier', initial: 'th', final: 't', cls: 'low' },
  { letter: 'ธ', say: 'ทอ ธง', name: 'thaaw thong', word: 'ธง', meaning: 'flag', initial: 'th', final: 't', cls: 'low' },
  { letter: 'น', say: 'นอ หนู', name: 'naaw nǔu', word: 'หนู', meaning: 'mouse', initial: 'n', final: 'n', cls: 'low' },
  { letter: 'พ', say: 'พอ พาน', name: 'phaaw phaan', word: 'พาน', meaning: 'footed tray', initial: 'ph', final: 'p', cls: 'low' },
  { letter: 'ฟ', say: 'ฟอ ฟัน', name: 'faaw fan', word: 'ฟัน', meaning: 'tooth', initial: 'f', final: 'p', cls: 'low' },
  { letter: 'ภ', say: 'พอ สำเภา', name: 'phaaw sǎm-phao', word: 'สำเภา', meaning: 'junk (sailing ship)', initial: 'ph', final: 'p', cls: 'low' },
  { letter: 'ม', say: 'มอ ม้า', name: 'maaw máa', word: 'ม้า', meaning: 'horse', initial: 'm', final: 'm', cls: 'low' },
  { letter: 'ย', say: 'ยอ ยักษ์', name: 'yaaw yák', word: 'ยักษ์', meaning: 'giant', initial: 'y', final: 'y', cls: 'low' },
  { letter: 'ร', say: 'รอ เรือ', name: 'raaw ruea', word: 'เรือ', meaning: 'boat', initial: 'r', final: 'n', cls: 'low' },
  { letter: 'ล', say: 'ลอ ลิง', name: 'laaw ling', word: 'ลิง', meaning: 'monkey', initial: 'l', final: 'n', cls: 'low' },
  { letter: 'ว', say: 'วอ แหวน', name: 'waaw wǎen', word: 'แหวน', meaning: 'ring', initial: 'w', final: 'w', cls: 'low' },
  { letter: 'ฬ', say: 'ลอ จุฬา', name: 'laaw jù-laa', word: 'จุฬา', meaning: 'a kind of kite', initial: 'l', final: 'n', cls: 'low', rarity: 'uncommon' },
  { letter: 'ฮ', say: 'ฮอ นกฮูก', name: 'haaw nók-hûuk', word: 'นกฮูก', meaning: 'owl', initial: 'h', cls: 'low' },
];

/** The letters of a class, in the order of CONSONANTS (the order they're taught in). */
export const classMembers = (cls: ToneClass): string[] => CONSONANTS.filter((c) => c.cls === cls).map((c) => c.letter);

/** What's worth knowing about a consonant, a line each: how it sounds, and its class with the rest of that class. */
export function consonantSteps(c: Consonant): string[] {
  const sounds = c.initial === ''
    ? 'It has no sound of its own at the start: it holds a vowel. It doesn\'t close a syllable.'
    : c.final
      ? `Sounds like ${c.initial} at the start of a syllable and ${c.final} at the end.`
      : `Sounds like ${c.initial} at the start of a syllable. It doesn't close a syllable.`;
  const steps = [sounds, `${CLASS_NAMES[c.cls]} class: ${classMembers(c.cls).join(' ')}.`];
  if (c.rarity === 'obsolete') steps.push('Not used in any word today.');
  else if (c.rarity === 'uncommon') steps.push('Rare: only in a few words borrowed from Pali and Sanskrit.');
  return steps;
}

/** The patterns a missed consonant leans toward (marks.ts): the letter itself, and its class. */
export const consonantPatterns = (c: Consonant): string[] => [`letter:${c.letter}`, `letter-class:${c.cls}`];

export interface Vowel {
  /** As it's written on ก. */
  shown: string;
  /** How it sounds, in the app's romanization. */
  sound: string;
  long: boolean;
  /** An English word with the sound, where there is a close one. */
  hint?: string;
  example: { text: string; roman: string; meaning: string };
}

export const VOWELS: Vowel[] = [
  { shown: 'กะ', sound: 'a', long: false, hint: 'a, as in "cup"', example: { text: 'จะ', roman: 'jà', meaning: 'will' } },
  { shown: 'กิ', sound: 'i', long: false, hint: 'i, as in "sit"', example: { text: 'คิด', roman: 'khít', meaning: 'think' } },
  { shown: 'กึ', sound: 'ue', long: false, example: { text: 'ตึก', roman: 'dtùek', meaning: 'building' } },
  { shown: 'กุ', sound: 'u', long: false, hint: 'u, as in "put"', example: { text: 'สุข', roman: 'sùk', meaning: 'happy' } },
  { shown: 'เกะ', sound: 'e', long: false, hint: 'e, as in "bed"', example: { text: 'เด็ก', roman: 'dèk', meaning: 'child' } },
  { shown: 'แกะ', sound: 'ae', long: false, hint: 'a, as in "cat"', example: { text: 'และ', roman: 'láe', meaning: 'and' } },
  { shown: 'โกะ', sound: 'o', long: false, example: { text: 'โต๊ะ', roman: 'dtó', meaning: 'table' } },
  { shown: 'เกาะ', sound: 'aw', long: false, hint: 'aw, as in "saw", cut short', example: { text: 'เกาะ', roman: 'gàw', meaning: 'island' } },
  { shown: 'กา', sound: 'aa', long: true, hint: 'a, as in "father"', example: { text: 'มา', roman: 'maa', meaning: 'come' } },
  { shown: 'กี', sound: 'ii', long: true, hint: 'ee, as in "see"', example: { text: 'ดี', roman: 'dii', meaning: 'good' } },
  { shown: 'กือ', sound: 'uue', long: true, example: { text: 'ซื้อ', roman: 'súue', meaning: 'buy' } },
  { shown: 'กู', sound: 'uu', long: true, hint: 'oo, as in "moon"', example: { text: 'ดู', roman: 'duu', meaning: 'watch' } },
  { shown: 'เก', sound: 'ee', long: true, hint: 'ay, as in "say", held steady', example: { text: 'เพลง', roman: 'phleeng', meaning: 'song' } },
  { shown: 'แก', sound: 'aae', long: true, hint: 'a, as in "cat", held longer', example: { text: 'แม่', roman: 'mâe', meaning: 'mother' } },
  { shown: 'โก', sound: 'oo', long: true, hint: 'o, as in "go", held steady', example: { text: 'โทร', roman: 'too', meaning: 'phone, call' } },
  { shown: 'กอ', sound: 'aaw', long: true, hint: 'aw, as in "saw"', example: { text: 'พ่อ', roman: 'phâaw', meaning: 'father' } },
  { shown: 'เกอ', sound: 'əə', long: true, hint: 'er, as in "her"', example: { text: 'เธอ', roman: 'thəə', meaning: 'she, you' } },
  { shown: 'กัว', sound: 'uua', long: true, example: { text: 'ตัว', roman: 'dtuua', meaning: 'body, classifier for animals' } },
  { shown: 'เกีย', sound: 'iia', long: true, example: { text: 'เรียน', roman: 'riian', meaning: 'study' } },
  { shown: 'เกือ', sound: 'uea', long: true, example: { text: 'เรือ', roman: 'ruea', meaning: 'boat' } },
];

/** The vowel said with ก, as a syllable without its tone: gaa, gii. */
export const vowelSyllable = (v: Vowel): string => `g${v.sound}`;

/** Why a vowel's length matters, for the answer: it's what makes a syllable with no tone mark live or dead (script.ts). */
export function vowelSteps(v: Vowel): string[] {
  const steps = [`${v.hint ? `${v.hint[0].toUpperCase()}${v.hint.slice(1)}. ` : ''}Example: ${v.example.text} (${v.example.roman}), ${v.example.meaning}.`];
  steps.push(v.long
    ? 'A long vowel makes the syllable live, so with no tone mark it keeps its class\'s own tone.'
    : 'A short vowel with nothing after it makes the syllable dead, so with no tone mark its tone follows the dead-syllable rule.');
  return steps;
}

/** The patterns a missed vowel leans toward (marks.ts): the vowel itself, and its length. */
export const vowelPatterns = (v: Vowel): string[] => [`vowel:${v.shown}`, `vowel-length:${v.long ? 'long' : 'short'}`];
