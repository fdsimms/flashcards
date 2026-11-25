import type { HearingLanguage } from '../hearing';

/**
 * Polish for Hearing sounds (../hearing.ts): the hissing and hushing consonants learners run
 * together (s, sz and ś; cz and ć), and y against i. Each set's words differ by that one sound.
 */
export const POLISH_HEARING: HearingLanguage = {
  groups: [
    { id: 'consonants', label: 'Consonants' },
    { id: 'vowels', label: 'Vowels' },
  ],
  sounds: [
    { id: 'sz-ś', label: 'sz or ś', group: 'consonants', tip: 'sz is darker, with the tongue tip raised and the lips a little rounded. ś is softer and higher, as if an i were about to follow.' },
    { id: 'cz-ć', label: 'cz or ć', group: 'consonants', tip: 'cz is darker, like the ch in church said with the tongue tip raised. ć is softer and higher, as if an i were about to follow.' },
    { id: 's-sz', label: 's or sz', group: 'consonants', tip: 's is a plain hiss with the tongue behind the teeth. sz is lower and darker, with the tongue tip raised.' },
    { id: 'y-i', label: 'y or i', group: 'vowels', tip: 'y is said further back, between the i in bit and the u in put. i is like the ee in see.' },
  ],
  sets: [
    { sound: 'sz-ś', words: [{ word: 'proszę', roman: 'proszę', meaning: 'please' }, { word: 'prosię', roman: 'prosię', meaning: 'piglet' }] },
    { sound: 'sz-ś', words: [{ word: 'kasza', roman: 'kasza', meaning: 'groats' }, { word: 'Kasia', roman: 'Kasia', meaning: 'Kasia (a name)' }] },
    { sound: 'sz-ś', words: [{ word: 'wiesz', roman: 'wiesz', meaning: 'you know' }, { word: 'wieś', roman: 'wieś', meaning: 'village' }] },
    { sound: 'cz-ć', words: [{ word: 'czy', roman: 'czy', meaning: 'whether; (question word)' }, { word: 'ci', roman: 'ci', meaning: 'to you' }] },
    { sound: 'cz-ć', words: [{ word: 'bicz', roman: 'bicz', meaning: 'whip' }, { word: 'bić', roman: 'bić', meaning: 'to beat' }] },
    { sound: 's-sz', words: [{ word: 'kasa', roman: 'kasa', meaning: 'checkout' }, { word: 'kasza', roman: 'kasza', meaning: 'groats' }] },
    { sound: 's-sz', words: [{ word: 'sok', roman: 'sok', meaning: 'juice' }, { word: 'szok', roman: 'szok', meaning: 'shock' }] },
    { sound: 'y-i', words: [{ word: 'my', roman: 'my', meaning: 'we' }, { word: 'mi', roman: 'mi', meaning: 'to me' }] },
    { sound: 'y-i', words: [{ word: 'byli', roman: 'byli', meaning: 'they were' }, { word: 'bili', roman: 'bili', meaning: 'they beat' }] },
    { sound: 'y-i', words: [{ word: 'był', roman: 'był', meaning: 'he was' }, { word: 'bił', roman: 'bił', meaning: 'he beat' }] },
  ],
};
