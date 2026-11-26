import type { HearingLanguage } from '../hearing';

/**
 * Japanese for Hearing sounds (../hearing.ts): a long vowel against a short one, a small っ, and a
 * small ゃ ゅ ょ against a full-size one. Shown in kana, where the sounds differ; given to the voice
 * in kanji with its reading where kana alone could be read another way (`say`, `reading`). Pitch
 * accent is left out: nothing in the app records a word's accent, so a set couldn't be checked.
 */
export const JAPANESE_HEARING: HearingLanguage = {
  groups: [
    { id: 'long', label: 'Long vowels' },
    { id: 'tsu', label: 'Small っ' },
    { id: 'ya', label: 'Small ゃ ゅ ょ' },
  ],
  sounds: [
    { id: 'long-vowel', label: 'Short or long vowel', group: 'long', tip: 'A long vowel is held for a whole extra beat.' },
    { id: 'small-tsu', label: 'With or without っ', group: 'tsu', tip: 'A small っ is a beat of silence before the next consonant, as if you caught your breath.' },
    { id: 'small-ya', label: 'Small or full-size ゃ ゅ ょ', group: 'ya', tip: 'A small ゃ, ゅ or ょ joins the sound before it into one beat (byo). A full-size one is a beat of its own (bi-yo).' },
  ],
  sets: [
    { sound: 'long-vowel', words: [{ word: 'おばさん', roman: 'obasan', meaning: 'aunt' }, { word: 'おばあさん', roman: 'obāsan', meaning: 'grandmother' }] },
    { sound: 'long-vowel', words: [{ word: 'おじさん', roman: 'ojisan', meaning: 'uncle' }, { word: 'おじいさん', roman: 'ojīsan', meaning: 'grandfather' }] },
    { sound: 'long-vowel', words: [{ word: 'ビル', roman: 'biru', meaning: 'building' }, { word: 'ビール', roman: 'bīru', meaning: 'beer' }] },
    { sound: 'long-vowel', words: [{ word: 'ゆき', say: '雪', reading: 'ゆき', roman: 'yuki', meaning: 'snow' }, { word: 'ゆうき', say: '勇気', reading: 'ゆうき', roman: 'yūki', meaning: 'courage' }] },
    { sound: 'long-vowel', words: [{ word: 'とり', say: '鳥', reading: 'とり', roman: 'tori', meaning: 'bird' }, { word: 'とおり', say: '通り', reading: 'とおり', roman: 'tōri', meaning: 'street' }] },
    { sound: 'small-tsu', words: [{ word: 'きて', say: '来て', reading: 'きて', roman: 'kite', meaning: 'come (and...)' }, { word: 'きって', say: '切手', reading: 'きって', roman: 'kitte', meaning: 'stamp' }] },
    { sound: 'small-tsu', words: [{ word: 'さか', say: '坂', reading: 'さか', roman: 'saka', meaning: 'slope' }, { word: 'さっか', say: '作家', reading: 'さっか', roman: 'sakka', meaning: 'author' }] },
    { sound: 'small-tsu', words: [{ word: 'いた', roman: 'ita', meaning: 'was (there)' }, { word: 'いった', say: '行った', reading: 'いった', roman: 'itta', meaning: 'went' }] },
    { sound: 'small-ya', words: [{ word: 'びよういん', say: '美容院', reading: 'びよういん', roman: 'biyōin', meaning: 'hair salon' }, { word: 'びょういん', say: '病院', reading: 'びょういん', roman: 'byōin', meaning: 'hospital' }] },
    { sound: 'small-ya', words: [{ word: 'じゆう', say: '自由', reading: 'じゆう', roman: 'jiyū', meaning: 'freedom' }, { word: 'じゅう', say: '十', reading: 'じゅう', roman: 'jū', meaning: 'ten' }] },
  ],
};
