import type { HearingLanguage } from '../hearing';

/**
 * Russian for Hearing sounds (../hearing.ts): a soft consonant against a hard one at the end of a
 * word, and ы against и. A word is shown with its stress mark and given to the voice without it
 * (`say`), since a voice doesn't read the mark. Pairs told apart only by stress (за́мок, замо́к) are
 * left out: nothing sent to the voice says which stress is meant, so it can't be trusted to say both.
 */
export const RUSSIAN_HEARING: HearingLanguage = {
  groups: [
    { id: 'consonants', label: 'Soft or hard' },
    { id: 'vowels', label: 'Vowels' },
  ],
  sounds: [
    { id: 'soft-hard', label: 'Soft or hard ending', group: 'consonants', tip: 'A soft consonant ends with the middle of the tongue raised, as if a short y followed it.' },
    { id: 'ы-и', label: 'ы or и', group: 'vowels', tip: 'ы is said with the tongue pulled back, between the i in bit and the u in put. и is like the ee in see.' },
  ],
  sets: [
    { sound: 'soft-hard', words: [{ word: 'брат', roman: 'brat', meaning: 'brother' }, { word: 'брать', roman: 'brat’', meaning: 'to take' }] },
    { sound: 'soft-hard', words: [{ word: 'у́гол', say: 'угол', roman: 'úgol', meaning: 'corner' }, { word: 'у́голь', say: 'уголь', roman: 'úgol’', meaning: 'coal' }] },
    { sound: 'soft-hard', words: [{ word: 'вес', roman: 'ves', meaning: 'weight' }, { word: 'весь', roman: 'ves’', meaning: 'all, the whole' }] },
    { sound: 'soft-hard', words: [{ word: 'мат', roman: 'mat', meaning: 'checkmate' }, { word: 'мать', roman: 'mat’', meaning: 'mother' }] },
    { sound: 'ы-и', words: [{ word: 'был', roman: 'byl', meaning: 'was' }, { word: 'бил', roman: 'bil', meaning: 'beat' }] },
    { sound: 'ы-и', words: [{ word: 'мыл', roman: 'myl', meaning: 'washed' }, { word: 'мил', roman: 'mil', meaning: 'sweet, dear' }] },
    { sound: 'ы-и', words: [{ word: 'быть', roman: 'byt’', meaning: 'to be' }, { word: 'бить', roman: 'bit’', meaning: 'to beat' }] },
  ],
};
