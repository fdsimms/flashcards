import type { HearingLanguage } from '../hearing';

/**
 * Russian for Hearing sounds (../hearing.ts): a soft consonant against a hard one at the end of a
 * word, ы against и, and words told apart by stress alone. A word is shown with its stress mark and
 * given to the voice without it (`say`), since a voice doesn't read the mark. A stress pair is
 * spelled alike, so each word carries its IPA (from Wiktionary's), which Azure says in the text's
 * place; such a word is never played in the phone's voice, which would say the spelling.
 */
export const RUSSIAN_HEARING: HearingLanguage = {
  groups: [
    { id: 'consonants', label: 'Soft or hard' },
    { id: 'vowels', label: 'Vowels' },
    { id: 'stress', label: 'Stress' },
  ],
  sounds: [
    { id: 'soft-hard', label: 'Soft or hard ending', group: 'consonants', tip: 'A soft consonant ends with the middle of the tongue raised, as if a short y followed it.' },
    { id: 'ы-и', label: 'ы or и', group: 'vowels', tip: 'ы is said with the tongue pulled back, between the i in bit and the u in put. и is like the ee in see.' },
    { id: 'stress', label: 'Which syllable is stressed', group: 'stress', tip: 'The stressed syllable is longer and louder, and an unstressed о sounds like а: замо́к is said zamók, за́мок is said zámak.' },
  ],
  sets: [
    { sound: 'soft-hard', words: [{ word: 'брат', roman: 'brat', meaning: 'brother' }, { word: 'брать', roman: 'brat’', meaning: 'to take' }] },
    { sound: 'soft-hard', words: [{ word: 'у́гол', say: 'угол', roman: 'úgol', meaning: 'corner' }, { word: 'у́голь', say: 'уголь', roman: 'úgol’', meaning: 'coal' }] },
    { sound: 'soft-hard', words: [{ word: 'вес', roman: 'ves', meaning: 'weight' }, { word: 'весь', roman: 'ves’', meaning: 'all, the whole' }] },
    { sound: 'soft-hard', words: [{ word: 'мат', roman: 'mat', meaning: 'checkmate' }, { word: 'мать', roman: 'mat’', meaning: 'mother' }] },
    { sound: 'ы-и', words: [{ word: 'был', roman: 'byl', meaning: 'was' }, { word: 'бил', roman: 'bil', meaning: 'beat' }] },
    { sound: 'ы-и', words: [{ word: 'мыл', roman: 'myl', meaning: 'washed' }, { word: 'мил', roman: 'mil', meaning: 'sweet, dear' }] },
    { sound: 'ы-и', words: [{ word: 'быть', roman: 'byt’', meaning: 'to be' }, { word: 'бить', roman: 'bit’', meaning: 'to beat' }] },
    { sound: 'stress', words: [{ word: 'за́мок', say: 'замок', ipa: 'ˈzamək', roman: 'zámok', meaning: 'castle' }, { word: 'замо́к', say: 'замок', ipa: 'zɐˈmok', roman: 'zamók', meaning: 'lock' }] },
    { sound: 'stress', words: [{ word: 'му́ка', say: 'мука', ipa: 'ˈmukə', roman: 'múka', meaning: 'torment' }, { word: 'мука́', say: 'мука', ipa: 'mʊˈka', roman: 'muká', meaning: 'flour' }] },
    { sound: 'stress', words: [{ word: 'пла́чу', say: 'плачу', ipa: 'ˈplatɕʊ', roman: 'pláchu', meaning: 'I cry' }, { word: 'плачу́', say: 'плачу', ipa: 'plɐˈtɕu', roman: 'plachú', meaning: 'I pay' }] },
    { sound: 'stress', words: [{ word: 'о́рган', say: 'орган', ipa: 'ˈorɡən', roman: 'órgan', meaning: 'organ (of the body)' }, { word: 'орга́н', say: 'орган', ipa: 'ɐrˈɡan', roman: 'orgán', meaning: 'organ (the instrument)' }] },
  ],
};
