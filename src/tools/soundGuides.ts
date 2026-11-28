// How a language sounds, for someone starting it from zero (src/core/fromZero.ts): the letters and sounds
// that aren't read the way English reads them, each with a word to hear, and a line or two on what applies
// to every word (stress, tone, length). Hand-written and checked once, not asked of Claude, so it's the same
// every time and costs nothing to show; the words are played by the phone's voice. Pure data, tested
// (tests/tools/soundGuides.test.ts). A language with its own script also points at Reading the script,
// Hearing sounds and Writing by hand, which teach the letters one by one.
import type { Language } from '../reader/api';

export interface SoundGuideRow {
  /** The letter or spelling, as written. */
  spelled: string;
  /** A common word with it, played when tapped. */
  example: string;
  /** How it sounds, in plain English. */
  hint: string;
}

export interface SoundGuide {
  rows: SoundGuideRow[];
  /** What holds for every word: stress, tone, vowel length. */
  notes: string[];
}

export const SOUND_GUIDES: Partial<Record<Language, SoundGuide>> = {
  es: {
    rows: [
      { spelled: 'a e i o u', example: 'casa', hint: 'Always short and pure: never "ay" or "oh-oo" as in English.' },
      { spelled: 'h', example: 'hola', hint: 'Always silent.' },
      { spelled: 'j', example: 'jamón', hint: 'A rough "h" from the back of the throat. g before e or i sounds the same (gente).' },
      { spelled: 'll, y', example: 'llamar', hint: 'Like "y" in "yes".' },
      { spelled: 'ñ', example: 'año', hint: 'Like "ny" in "canyon".' },
      { spelled: 'r, rr', example: 'perro', hint: 'rr is rolled. One r between vowels is a quick tap, like "tt" in American "butter" (pero).' },
      { spelled: 'v', example: 'vamos', hint: 'Said like b.' },
      { spelled: 'c, z', example: 'cinco', hint: 'c before e or i, and z, sound like "s" in Latin America.' },
      { spelled: 'qu', example: 'queso', hint: 'A "k". The u is silent.' },
    ],
    notes: ['A written accent (á, é) marks the stressed syllable. Without one, a word ending in a vowel, n or s is stressed on the second-last syllable, and any other on the last.'],
  },
  fr: {
    rows: [
      { spelled: 'r', example: 'rouge', hint: 'From the back of the throat, close to a light gargle.' },
      { spelled: 'u', example: 'tu', hint: 'Say "ee" with your lips rounded as for "oo".' },
      { spelled: 'ou', example: 'vous', hint: 'Like "oo" in "food".' },
      { spelled: 'eu', example: 'deux', hint: 'Say "e" with your lips rounded.' },
      { spelled: 'on, an, in', example: 'bon', hint: 'Nasal vowels: the n isn\'t said, the vowel goes through the nose (dans, vin).' },
      { spelled: 'é, è', example: 'été', hint: 'é is like "ay" without the glide at the end. è is like "e" in "bed" (mère).' },
      { spelled: 'oi', example: 'moi', hint: 'Said "wa".' },
      { spelled: 'j, g before e or i', example: 'je', hint: 'Like "s" in "measure".' },
      { spelled: 'gn', example: 'montagne', hint: 'Like "ny" in "canyon".' },
      { spelled: 'h', example: 'homme', hint: 'Always silent.' },
    ],
    notes: [
      'Most consonants at the end of a word are silent (petit, vous). Before a word starting with a vowel, one is often said after all (vous avez).',
      'Words aren\'t stressed one by one: the last syllable of a group of words is a little longer.',
    ],
  },
  de: {
    rows: [
      { spelled: 'ch', example: 'Buch', hint: 'After a, o or u: rough, at the back of the throat, as in Scottish "loch".' },
      { spelled: 'ch', example: 'ich', hint: 'After e, i, ä, ö, ü or a consonant: a soft hiss, like a whispered "h" before "ee".' },
      { spelled: 'ü', example: 'über', hint: 'Say "ee" with your lips rounded.' },
      { spelled: 'ö', example: 'schön', hint: 'Say "e" with your lips rounded.' },
      { spelled: 'ei', example: 'nein', hint: 'Like "i" in "line".' },
      { spelled: 'ie', example: 'Liebe', hint: 'Like "ee".' },
      { spelled: 'eu, äu', example: 'heute', hint: 'Like "oy" in "boy".' },
      { spelled: 'w', example: 'Wasser', hint: 'Like English v.' },
      { spelled: 'v', example: 'Vater', hint: 'Usually like English f.' },
      { spelled: 'z', example: 'Zeit', hint: 'Said "ts".' },
      { spelled: 'sch, sp, st', example: 'Straße', hint: 'sch is "sh". At the start of a word, sp and st are "shp" and "sht".' },
      { spelled: 'b, d, g at the end', example: 'Tag', hint: 'Said like p, t and k at the end of a word.' },
    ],
    notes: ['Most words are stressed on the first syllable. A long vowel is often written doubled or followed by h (Boot, fahren).'],
  },
  nb: {
    rows: [
      { spelled: 'å', example: 'på', hint: 'Like "aw" in "law", with rounded lips.' },
      { spelled: 'ø', example: 'søster', hint: 'Say "e" with your lips rounded.' },
      { spelled: 'æ', example: 'være', hint: 'Like "a" in "bad".' },
      { spelled: 'y', example: 'ny', hint: 'Say "ee" with your lips rounded.' },
      { spelled: 'o', example: 'bok', hint: 'Often like "oo" in "food".' },
      { spelled: 'kj', example: 'kjøre', hint: 'A soft hiss, close to German "ich". k before i and y sounds the same (kirke).' },
      { spelled: 'skj, sj', example: 'skjønn', hint: 'Like "sh". sk before i, y and ø sounds the same (ski).' },
      { spelled: 'rs', example: 'norsk', hint: 'Said together as "sh" in most of Norway.' },
      { spelled: 'g', example: 'gi', hint: 'Like "y" before i, y and ei.' },
      { spelled: 'silent letters', example: 'god', hint: 'd is often silent after a vowel at the end of a word, and so is the t of det.' },
    ],
    notes: ['Two words can differ by their melody alone (bønder and bønner). You\'ll hear it in lessons.'],
  },
  pl: {
    rows: [
      { spelled: 'ł', example: 'łyżka', hint: 'Like English "w".' },
      { spelled: 'w', example: 'woda', hint: 'Like English "v".' },
      { spelled: 'sz', example: 'szkoła', hint: 'Like "sh".' },
      { spelled: 'cz', example: 'czas', hint: 'Like "ch" in "church".' },
      { spelled: 'rz, ż', example: 'rzeka', hint: 'Like "s" in "measure" (żaba).' },
      { spelled: 'ś, si', example: 'siostra', hint: 'A softer "sh", with the tongue against the front of the roof of your mouth.' },
      { spelled: 'ć, ci', example: 'ciocia', hint: 'A softer "ch", made the same way.' },
      { spelled: 'ń, ni', example: 'koń', hint: 'Like "ny" in "canyon".' },
      { spelled: 'c', example: 'co', hint: 'Said "ts".' },
      { spelled: 'ch, h', example: 'chleb', hint: 'A rough "h", as in Scottish "loch".' },
      { spelled: 'j', example: 'jak', hint: 'Like "y" in "yes".' },
      { spelled: 'y', example: 'my', hint: 'A vowel between "i" in "bit" and "uh", with the tongue further back.' },
      { spelled: 'ą, ę', example: 'są', hint: 'Nasal: "on" and "en" said through the nose. ę at the end of a word is often just "e" (się).' },
    ],
    notes: ['Almost every word is stressed on the second-last syllable.'],
  },
  ru: {
    rows: [
      { spelled: 'ы', example: 'мы', hint: 'Between "i" in "bit" and "uh", with the tongue pulled back.' },
      { spelled: 'ь', example: 'мать', hint: 'No sound of its own: it softens the consonant before it, with a hint of "y".' },
      { spelled: 'х', example: 'хлеб', hint: 'A rough "h", as in Scottish "loch".' },
      { spelled: 'ж', example: 'жить', hint: 'Like "s" in "measure", said hard.' },
      { spelled: 'щ', example: 'щи', hint: 'A long, soft "sh".' },
      { spelled: 'р', example: 'рыба', hint: 'Rolled.' },
      { spelled: 'о', example: 'молоко', hint: 'Only sounds like "o" when stressed. Otherwise it\'s close to "a": malakó.' },
      { spelled: 'е', example: 'есть', hint: 'Said "ye" at the start of a word or after a vowel.' },
      { spelled: 'б, д, г at the end', example: 'год', hint: 'Said like п, т, к at the end of a word: "got".' },
    ],
    notes: ['Stress isn\'t written and can fall on any syllable, and it changes how the vowels sound. Cards show it with a mark (молоко́).'],
  },
  el: {
    rows: [
      { spelled: 'γ', example: 'γάλα', hint: 'A soft, breathy "g". Before e or i sounds, like "y" (γεια).' },
      { spelled: 'δ', example: 'δεν', hint: 'Like "th" in "this".' },
      { spelled: 'θ', example: 'θέλω', hint: 'Like "th" in "thin".' },
      { spelled: 'χ', example: 'χαρά', hint: 'A rough "h", as in Scottish "loch".' },
      { spelled: 'β', example: 'βιβλίο', hint: 'Like English "v".' },
      { spelled: 'η, ι, υ, ει, οι', example: 'είναι', hint: 'All said "ee".' },
      { spelled: 'ου', example: 'που', hint: 'Like "oo" in "food".' },
      { spelled: 'αι', example: 'και', hint: 'Like "e" in "bed".' },
      { spelled: 'μπ, ντ', example: 'μπύρα', hint: 'At the start of a word, "b" and "d" (ντομάτα).' },
    ],
    notes: ['The accent mark shows the stressed syllable (πότε), and every word of two syllables or more has one.'],
  },
  ja: {
    rows: [
      { spelled: 'あいうえお', example: 'あい', hint: 'a, i, u, e, o: five short, pure vowels.' },
      { spelled: 'う', example: 'すし', hint: 'Said without rounding the lips, and often almost silent between voiceless sounds (です).' },
      { spelled: 'ら り る れ ろ', example: 'ありがとう', hint: 'A quick tap, between r, l and d.' },
      { spelled: 'ふ', example: 'ふじ', hint: 'Between "f" and "h": the lips come close without the teeth touching.' },
      { spelled: 'long vowels', example: 'おばあさん', hint: 'Length changes the word: おばさん is aunt, おばあさん grandmother.' },
      { spelled: 'small っ', example: 'きって', hint: 'A short pause before the next consonant.' },
      { spelled: 'ん', example: 'ほん', hint: 'A syllable of its own, as long as the others.' },
    ],
    notes: ['Words differ by pitch, not stress: はし is chopsticks or bridge by which syllable is higher.'],
  },
  th: {
    rows: [
      { spelled: 'tones', example: 'ใหม่', hint: 'Five tones. The same syllable with another tone is another word (ใหม่ new, ไหม a question, ไม่ not).' },
      { spelled: 'ป ต ก', example: 'ปลา', hint: 'p, t and k with no puff of air. พ ท ค have one.' },
      { spelled: 'ง', example: 'งาน', hint: '"ng" as in "sing", here at the start of a word.' },
      { spelled: 'vowel length', example: 'ข้าว', hint: 'Short and long vowels make different words (เข้า enter, ข้าว rice).' },
      { spelled: 'final k, t, p', example: 'มาก', hint: 'Not released: the mouth closes and stops.' },
      { spelled: 'ร', example: 'รัก', hint: 'Rolled or tapped. In casual speech it\'s often said like "l".' },
    ],
    notes: ['A syllable\'s tone comes from its consonant\'s class, its vowel, its final sound and any tone mark. Reading the script drills it.'],
  },
};
