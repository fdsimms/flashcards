import type { HearingLanguage } from '../hearing';

/**
 * Thai for Hearing sounds (../hearing.ts). Tone sets ('tone') are words that differ only by tone,
 * each tallied under its own tone; the others differ by one sound with the tone kept the same, which
 * the tests check from each romanization's tone mark, so a miss there is about that sound alone.
 * Every word is a real, everyday one, so a voice says it in its usual citation form.
 */
export const THAI_HEARING: HearingLanguage = {
  groups: [
    { id: 'tones', label: 'Tones' },
    { id: 'vowels', label: 'Vowel length' },
    { id: 'consonants', label: 'Consonants' },
  ],
  sounds: [
    { id: 'vowel-length', label: 'Short or long vowel', group: 'vowels', tip: 'A long vowel is held about twice as long. The tone is the same.' },
    { id: 'g-kh', label: 'g or kh', group: 'consonants', tip: 'kh has a puff of air after it, like the k in key. g has none, like the k in skin.' },
    { id: 'bp-ph', label: 'bp or ph', group: 'consonants', tip: 'ph has a puff of air after it, like the p in pie. bp has none, like the p in spy.' },
    { id: 'dt-th', label: 'dt or th', group: 'consonants', tip: 'th has a puff of air after it, like the t in tie (not the th in thin). dt has none, like the t in sty.' },
    { id: 'b-bp', label: 'b or bp', group: 'consonants', tip: 'With b the voice starts before the lips open. With bp it starts as they open.' },
    { id: 'd-dt', label: 'd or dt', group: 'consonants', tip: 'With d the voice starts before the tongue lets go. With dt it starts as it lets go.' },
  ],
  sets: [
    { sound: 'tone', words: [{ word: 'ขาว', roman: 'khǎao', meaning: 'white' }, { word: 'ข่าว', roman: 'khàao', meaning: 'news' }, { word: 'ข้าว', roman: 'khâao', meaning: 'rice' }] },
    { sound: 'tone', words: [{ word: 'มา', roman: 'maa', meaning: 'come' }, { word: 'ม้า', roman: 'máa', meaning: 'horse' }, { word: 'หมา', roman: 'mǎa', meaning: 'dog' }] },
    { sound: 'tone', words: [{ word: 'เขา', roman: 'khǎo', meaning: 'he, she' }, { word: 'เข่า', roman: 'khào', meaning: 'knee' }, { word: 'เข้า', roman: 'khâo', meaning: 'enter' }] },
    { sound: 'tone', words: [{ word: 'ปา', roman: 'bpaa', meaning: 'throw' }, { word: 'ป่า', roman: 'bpàa', meaning: 'forest' }, { word: 'ป้า', roman: 'bpâa', meaning: 'aunt' }] },
    { sound: 'tone', words: [{ word: 'นา', roman: 'naa', meaning: 'rice field' }, { word: 'น้า', roman: 'náa', meaning: "mother's younger sibling" }, { word: 'หนา', roman: 'nǎa', meaning: 'thick' }] },
    { sound: 'tone', words: [{ word: 'คาง', roman: 'khaang', meaning: 'chin' }, { word: 'ค้าง', roman: 'kháang', meaning: 'stay overnight' }, { word: 'ข้าง', roman: 'khâang', meaning: 'side' }] },
    { sound: 'tone', words: [{ word: 'ไม่', roman: 'mâi', meaning: 'not' }, { word: 'ใหม่', roman: 'mài', meaning: 'new' }] },
    { sound: 'tone', words: [{ word: 'เสือ', roman: 'sǔea', meaning: 'tiger' }, { word: 'เสื้อ', roman: 'sûea', meaning: 'shirt' }] },
    { sound: 'tone', words: [{ word: 'หมอ', roman: 'mǎaw', meaning: 'doctor' }, { word: 'หม้อ', roman: 'mâaw', meaning: 'pot' }] },
    { sound: 'tone', words: [{ word: 'ไกล', roman: 'glai', meaning: 'far' }, { word: 'ใกล้', roman: 'glâi', meaning: 'near' }] },
    { sound: 'tone', words: [{ word: 'สวย', roman: 'sǔai', meaning: 'beautiful' }, { word: 'ซวย', roman: 'suai', meaning: 'unlucky' }] },

    { sound: 'vowel-length', words: [{ word: 'เข้า', roman: 'khâo', meaning: 'enter' }, { word: 'ข้าว', roman: 'khâao', meaning: 'rice' }] },
    { sound: 'vowel-length', words: [{ word: 'ฝัน', roman: 'fǎn', meaning: 'dream' }, { word: 'ฝาน', roman: 'fǎan', meaning: 'slice thinly' }] },
    { sound: 'vowel-length', words: [{ word: 'ตัก', roman: 'dtàk', meaning: 'scoop' }, { word: 'ตาก', roman: 'dtàak', meaning: 'dry in the sun' }] },
    { sound: 'vowel-length', words: [{ word: 'ปัก', roman: 'bpàk', meaning: 'embroider' }, { word: 'ปาก', roman: 'bpàak', meaning: 'mouth' }] },
    { sound: 'vowel-length', words: [{ word: 'ขัด', roman: 'khàt', meaning: 'scrub' }, { word: 'ขาด', roman: 'khàat', meaning: 'torn; lacking' }] },

    { sound: 'g-kh', words: [{ word: 'ไก่', roman: 'gài', meaning: 'chicken' }, { word: 'ไข่', roman: 'khài', meaning: 'egg' }] },
    { sound: 'g-kh', words: [{ word: 'กาง', roman: 'gaang', meaning: 'spread open' }, { word: 'คาง', roman: 'khaang', meaning: 'chin' }] },
    { sound: 'bp-ph', words: [{ word: 'ปา', roman: 'bpaa', meaning: 'throw' }, { word: 'พา', roman: 'phaa', meaning: 'take along' }] },
    { sound: 'bp-ph', words: [{ word: 'ป่า', roman: 'bpàa', meaning: 'forest' }, { word: 'ผ่า', roman: 'phàa', meaning: 'cut open' }] },
    { sound: 'dt-th', words: [{ word: 'ตา', roman: 'dtaa', meaning: 'eye' }, { word: 'ทา', roman: 'thaa', meaning: 'spread on' }] },
    { sound: 'dt-th', words: [{ word: 'ตาย', roman: 'dtaai', meaning: 'die' }, { word: 'ทาย', roman: 'thaai', meaning: 'guess' }] },
    { sound: 'b-bp', words: [{ word: 'บ้า', roman: 'bâa', meaning: 'crazy' }, { word: 'ป้า', roman: 'bpâa', meaning: 'aunt' }] },
    { sound: 'b-bp', words: [{ word: 'ใบ', roman: 'bai', meaning: 'leaf' }, { word: 'ไป', roman: 'bpai', meaning: 'go' }] },
    { sound: 'd-dt', words: [{ word: 'ดี', roman: 'dii', meaning: 'good' }, { word: 'ตี', roman: 'dtii', meaning: 'hit' }] },
    { sound: 'd-dt', words: [{ word: 'ดำ', roman: 'dam', meaning: 'black' }, { word: 'ตำ', roman: 'dtam', meaning: 'pound (in a mortar)' }] },
  ],
};
