// What the symbols in a word's IPA mean, per language: the Pronunciation field on a card, opened from the card
// (src/ui/IpaSheet.tsx), and the whole table as How it sounds' IPA tab (SoundGuideScreen.tsx). Hand-written
// and checked once, like soundGuides.ts, so it costs nothing to show; each sound's word is played by the
// phone's voice. The symbols are the ones Wiktionary's IPA uses for the language (what Read & Listen fills
// the field with, server/reader's ipa.py), and Japanese's are the ones kana_ipa.py writes.
// tests/tools/ipaGuide.test.ts checks each example against Wiktionary's IPA for it, and that the
// language's common words split with no symbol left unexplained. Pure data and parsing, tested.
import type { Language } from '../reader/api';
import { LANGUAGE_ORDER, LANGUAGES } from '../reader/languages';

export interface IpaSound {
  /** The symbol as the guide shows it: tie bars left out (tɕ, not t͡ɕ), and without ː, which is a mark of its own. */
  ipa: string;
  /** A common word with the sound, played when tapped. */
  example: string;
  /** The letters of `example` that make the sound, shown highlighted. Left out where no letters stand for it alone. */
  spelled?: string;
  /** How it sounds, in plain English. */
  hint: string;
  kind: 'vowel' | 'consonant';
}

export interface IpaGuide {
  sounds: IpaSound[];
  /** The shared marks (`MARKS`) its IPA uses, listed on the IPA tab. A word's breakdown explains any of them it meets. */
  uses: string[];
  /** The language's own marks, or its own wording of a shared one. */
  marks?: Record<string, string>;
}

/** A mark (stress, length, a diacritic) as one line under the sounds. `mark` is how it's shown: a combining mark on a dotted circle. */
export interface IpaMark {
  mark: string;
  hint: string;
}

/** One sound of a word's IPA: as it's written there, and the guide's row for it, when the guide has one. */
export interface IpaPart {
  written: string;
  sound?: IpaSound;
}

export interface IpaBreakdown {
  parts: IpaPart[];
  marks: IpaMark[];
}

// Marks that mean the same in every language. Keys are the mark itself; '()' stands for a sound in parentheses.
const MARKS: Record<string, string> = {
  'ˈ': 'ˈ comes just before the stressed syllable.',
  'ˌ': 'ˌ comes before a syllable with a lighter, second stress.',
  '.': 'A dot divides syllables.',
  'ː': 'ː means the sound before it is held longer.',
  'ˑ': 'ˑ means the sound before it is held a little longer.',
  'ʲ': 'ʲ means the consonant is soft: said with the middle of the tongue raised, as if a "y" came right after it.',
  'ʰ': 'ʰ means a puff of air after the sound, as in English "top".',
  '̚': 'This mark means the sound is stopped without letting the air out, so it\'s barely heard.',
  '̃': 'A ~ over a vowel means it\'s said partly through the nose.',
  '̯': 'This mark under a vowel means it glides into the vowel next to it, in one syllable.',
  '̩': 'This mark under a consonant means it makes a syllable on its own, with no vowel.',
  '()': 'A sound in parentheses is often left out.',
  '‿': '‿ joins two words: they\'re said without a break.',
};

// Tone letters, read as one mark per run (˥˩). A run a language doesn't name gets this.
const TONE_RUN = /^[˥˦˧˨˩]+/;
const ANY_TONE = 'Tone letters show the pitch, from ˩ (low) to ˥ (high), read left to right.';

// Written after a sound and belonging to it: length, softness, a puff of air, and any combining mark.
const MODIFIER = /^(?:\p{M}|[ːˑʲʰʷˠⁿᵑ])/u;
// Frame the IPA and separate words: dropped without a word.
const FRAME = /^[/[\]{}\s\-,;|ʼ]/;

const v = (ipa: string, example: string, spelled: string | undefined, hint: string): IpaSound => ({ ipa, example, ...(spelled ? { spelled } : {}), hint, kind: 'vowel' });
const k = (ipa: string, example: string, spelled: string | undefined, hint: string): IpaSound => ({ ipa, example, ...(spelled ? { spelled } : {}), hint, kind: 'consonant' });

const ENGLISH = 'As in English.';

export const IPA_GUIDES: Partial<Record<Language, IpaGuide>> = {
  es: {
    uses: ['ˈ', 'ˌ'],
    sounds: [
      v('a', 'casa', 'a', 'Like "a" in "father", but short.'),
      v('e', 'mesa', 'e', 'Like "e" in "bet".'),
      v('i', 'sí', 'í', 'Like "ee" in "see", but short.'),
      v('o', 'no', 'o', 'Like "o" in "or", short, with no "w" glide at the end.'),
      v('u', 'tú', 'ú', 'Like "oo" in "food", but short.'),
      k('j', 'bien', 'i', 'Like "y" in "yes": an i gliding into the next vowel.'),
      k('w', 'bueno', 'u', 'Like "w" in "wet": a u gliding into the next vowel.'),
      k('ɾ', 'pero', 'r', 'One quick tap of the tongue, like "tt" in American "butter".'),
      k('r', 'perro', 'rr', 'A rolled r: the tongue trills several times. Also an r at the start of a word.'),
      k('θ', 'cinco', 'c', 'Like "th" in "think". Said this way in Spain; in Latin America it\'s an "s".'),
      k('x', 'jamón', 'j', 'A rough "h" from the back of the throat.'),
      k('ʝ', 'yo', 'y', 'Like "y" in "yes", sometimes closer to "j" in "jet".'),
      k('ɲ', 'año', 'ñ', 'Like "ny" in "canyon".'),
      k('tʃ', 'chico', 'ch', 'Like "ch" in "church".'),
      k('ʃ', 'sushi', 'sh', 'Like "sh" in "she", in a few loanwords.'),
      k('b', 'bien', 'b', 'Like "b". Between vowels it\'s softer: the lips barely touch. v is said the same way.'),
      k('d', 'día', 'd', 'Like "d" with the tongue against the teeth. Between vowels it\'s soft, close to "th" in "this".'),
      k('ɡ', 'gato', 'g', 'Like "g" in "go". Between vowels it\'s softer.'),
      k('p', 'pan', 'p', 'Like "p" in "spin": no puff of air.'),
      k('t', 'todo', 't', 'Like "t" with the tongue against the teeth, and no puff of air.'),
      k('k', 'queso', 'qu', 'Like "k" in "skin": no puff of air.'),
      k('s', 'sol', 's', 'Like "s" in "see", never a "z" sound.'),
      k('f', 'fuego', 'f', ENGLISH),
      k('l', 'luz', 'l', 'A clear "l", as in "leaf".'),
      k('m', 'mano', 'm', ENGLISH),
      k('n', 'no', 'n', ENGLISH),
    ],
  },
  fr: {
    uses: ['.', '‿', '()'],
    sounds: [
      v('a', 'chat', 'a', 'Like "a" in "father", but short.'),
      v('ɑ', 'théâtre', 'â', 'A deeper "ah", further back in the mouth. Most speakers now say it like a.'),
      v('e', 'été', 'é', 'Like "ay" in "say", without the glide at the end.'),
      v('ɛ', 'mère', 'è', 'Like "e" in "bed".'),
      v('ə', 'le', 'e', 'A short, relaxed "uh" with rounded lips. Often not said at all.'),
      v('i', 'lit', 'i', 'Like "ee" in "see", but short.'),
      v('y', 'tu', 'u', 'Say "ee" with your lips rounded as for "oo".'),
      v('u', 'vous', 'ou', 'Like "oo" in "food".'),
      v('o', 'beau', 'eau', 'Like "o" in "go", without the "w" glide at the end.'),
      v('ɔ', 'porte', 'o', 'Like "o" in British "lot", with rounded lips.'),
      v('ø', 'deux', 'eu', 'Say "ay" with your lips rounded.'),
      v('œ', 'peur', 'eu', 'Say "e" in "bed" with your lips rounded.'),
      v('ɑ̃', 'dans', 'an', 'A nasal "ah": the n isn\'t said, the vowel goes through the nose.'),
      v('ɛ̃', 'vin', 'in', 'A nasal "e" in "bed": the n isn\'t said.'),
      v('ɔ̃', 'bon', 'on', 'A nasal "o" with rounded lips: the n isn\'t said.'),
      v('œ̃', 'un', 'un', 'A nasal "uh". Many speakers say it like ɛ̃.'),
      k('ʁ', 'rouge', 'r', 'From the back of the throat, close to a light gargle.'),
      k('ʒ', 'je', 'j', 'Like "s" in "measure".'),
      k('ʃ', 'chat', 'ch', 'Like "sh" in "she".'),
      k('ɲ', 'montagne', 'gn', 'Like "ny" in "canyon".'),
      k('ɥ', 'huit', 'u', 'A quick y (the vowel in "tu") gliding into the next vowel.'),
      k('j', 'fille', 'ill', 'Like "y" in "yes".'),
      k('w', 'oui', 'ou', 'Like "w" in "wet".'),
      k('p', 'pain', 'p', 'Like "p" in "spin": no puff of air.'),
      k('t', 'tête', 't', 'Like "t" with the tongue against the teeth, and no puff of air.'),
      k('k', 'café', 'c', 'Like "k" in "skin": no puff of air.'),
      k('b', 'bon', 'b', ENGLISH),
      k('d', 'deux', 'd', 'Like "d" with the tongue against the teeth.'),
      k('ɡ', 'gare', 'g', 'Like "g" in "go".'),
      k('f', 'faire', 'f', ENGLISH),
      k('v', 'vous', 'v', ENGLISH),
      k('s', 'sur', 's', ENGLISH),
      k('z', 'zéro', 'z', ENGLISH),
      k('l', 'lit', 'l', 'A clear "l", as in "leaf".'),
      k('m', 'mère', 'm', ENGLISH),
      k('n', 'non', 'n', ENGLISH),
      k('ŋ', 'parking', 'ng', 'Like "ng" in "sing", in English loanwords.'),
      k('ɾ', 'soir', 'r', 'A tapped r, as some regions say it.'),
      k('h', 'ha', 'h', 'Like "h" in "hat", only in a few interjections. French h is otherwise silent.'),
    ],
  },
  de: {
    uses: ['ˈ', 'ˌ', 'ː', '\u032F', '\u0329', '()'],
    sounds: [
      v('a', 'Mann', 'a', 'Like "a" in "father". Short unless ː follows.'),
      v('ɐ', 'aber', 'er', 'A short "uh", what -er and r become at the end of a syllable.'),
      v('ə', 'bitte', 'e', 'A short, relaxed "uh", as in "sofa".'),
      v('ɪ', 'bitte', 'i', 'Like "i" in "bit".'),
      v('ɘ', 'reihen', 'e', 'A short, relaxed "uh", the same as ə in this guide.'),
      v('i', 'Liebe', 'ie', 'Like "ee" in "see".'),
      v('ɛ', 'Bett', 'e', 'Like "e" in "bed". Long (ɛː) for ä in Käse.'),
      v('e', 'geht', 'e', 'Like "ay" in "say", without the glide at the end.'),
      v('ʊ', 'und', 'u', 'Like "oo" in "book".'),
      v('u', 'gut', 'u', 'Like "oo" in "food".'),
      v('ɔ', 'Sonne', 'o', 'Like "o" in British "lot".'),
      v('o', 'so', 'o', 'Like "o" in "go", without the "w" glide at the end.'),
      v('ʏ', 'müssen', 'ü', 'Say "i" in "bit" with your lips rounded.'),
      v('y', 'für', 'ü', 'Say "ee" with your lips rounded as for "oo".'),
      v('œ', 'können', 'ö', 'Say "e" in "bed" with your lips rounded.'),
      v('ø', 'schön', 'ö', 'Say "ay" with your lips rounded.'),
      v('aɪ̯', 'mein', 'ei', 'Like "i" in "mine".'),
      v('aʊ̯', 'Haus', 'au', 'Like "ou" in "house".'),
      v('ɔʏ̯', 'neu', 'eu', 'Like "oy" in "boy".'),
      k('ʁ', 'groß', 'r', 'From the back of the throat, close to a light gargle.'),
      k('r', 'dürfen', 'r', 'A rolled r, as some speakers say it.'),
      k('ç', 'ich', 'ch', 'After e, i, ä, ö, ü or a consonant: a soft hiss, like a whispered "h" before "ee".'),
      k('x', 'Buch', 'ch', 'After a, o or u: rough, at the back of the throat, as in Scottish "loch".'),
      k('χ', 'kochen', 'ch', 'Like x, further back in the throat.'),
      k('ʒ', 'Journalist', 'J', 'Like "s" in "measure", in French loanwords.'),
      k('ʃ', 'Schule', 'Sch', 'Like "sh" in "she". Also s before p or t at the start (Stein).'),
      k('ts', 'Zeit', 'z', 'Like "ts" in "cats".'),
      k('pf', 'Apfel', 'pf', 'p and f together, in one sound.'),
      k('tʃ', 'deutsch', 'tsch', 'Like "ch" in "church".'),
      k('ŋ', 'lang', 'ng', 'Like "ng" in "sing", with no g after it.'),
      k('ʔ', 'also', undefined, 'A tiny catch in the throat before a vowel, as in "uh-oh".'),
      k('z', 'Sonne', 'S', 'Like "z". An s before a vowel is said this way.'),
      k('v', 'Wasser', 'W', 'Like "v". German w is said this way.'),
      k('f', 'Vater', 'V', 'Like "f". German v is usually said this way.'),
      k('j', 'ja', 'j', 'Like "y" in "yes".'),
      k('h', 'Haus', 'H', ENGLISH),
      k('b', 'Ball', 'B', 'Like "b". At the end of a word it\'s said as p.'),
      k('d', 'du', 'd', 'Like "d". At the end of a word it\'s said as t.'),
      k('ɡ', 'gut', 'g', 'Like "g" in "go". At the end of a word it\'s said as k.'),
      k('p', 'Post', 'P', ENGLISH),
      k('t', 'Tag', 'T', ENGLISH),
      k('k', 'kalt', 'k', ENGLISH),
      k('s', 'das', 's', 'Like "s" in "see". Also ß.'),
      k('l', 'Licht', 'L', 'A clear "l", as in "leaf".'),
      k('m', 'Mann', 'M', ENGLISH),
      k('n', 'nein', 'n', ENGLISH),
      k('ɱ', 'sanft', 'n', 'An m or n said with the lips against the teeth, before f.'),
    ],
  },
  el: {
    uses: ['ˈ', '.', '\u032F'],
    sounds: [
      v('a', 'για', 'α', 'Like "a" in "father", but short.'),
      v('e', 'με', 'ε', 'Like "e" in "bet". Also αι.'),
      v('i', 'είναι', 'εί', 'Like "ee" in "see", but short. Also η, υ, ει and οι.'),
      v('o', 'ο', 'ο', 'Like "o" in "or", short. Also ω.'),
      v('u', 'μου', 'ου', 'Like "oo" in "food", but short.'),
      v('ɐ', 'μηχανή', 'α', 'A short "uh": an unstressed α in quick speech.'),
      v('ɑ', 'αχ', 'α', 'The same as a in this guide.'),
      v('ɛ', 'δέρμα', 'έ', 'The same as e in this guide.'),
      v('ɔ', 'απλός', 'ό', 'The same as o in this guide.'),
      k('ɾ', 'πρέπει', 'ρ', 'One quick tap of the tongue, like "tt" in American "butter".'),
      k('r', 'ρόδο', 'ρ', 'A rolled r, at the start of a word or doubled.'),
      k('ð', 'δέκα', 'δ', 'Like "th" in "this".'),
      k('θ', 'θέλω', 'θ', 'Like "th" in "think".'),
      k('ɣ', 'γάλα', 'γ', 'A soft, breathy "g" from the back of the throat, before a, o or u.'),
      k('ʝ', 'γεια', 'γ', 'Like "y" in "yes", said with more friction. γ before e or i.'),
      k('x', 'χαρά', 'χ', 'A rough "h" from the back of the throat, as in Scottish "loch". χ before a, o or u.'),
      k('ç', 'χέρι', 'χ', 'A soft hiss, like a whispered "h" before "ee". χ before e or i.'),
      k('c', 'κι', 'κ', 'A "k" made further forward, almost "ky". κ before e or i.'),
      k('ɟ', 'γκέμι', 'γκ', 'A "g" made further forward, almost "gy".'),
      k('ɲ', 'χρόνια', 'νι', 'Like "ny" in "canyon".'),
      k('ʎ', 'ήλιος', 'λι', 'Like "lli" in "million".'),
      k('ŋ', 'ανάγκη', 'γκ', 'Like "ng" in "finger". γκ and γγ in the middle of a word.'),
      k('ɱ', 'συμφωνία', 'μ', 'An m said with the lips against the teeth, before f or v.'),
      k('b', 'μπορώ', 'μπ', 'Like "b". Written μπ.'),
      k('d', 'ντομάτα', 'ντ', 'Like "d". Written ντ.'),
      k('ɡ', 'γκολ', 'γκ', 'Like "g" in "go". Written γκ.'),
      k('ts', 'τσάι', 'τσ', 'Like "ts" in "cats".'),
      k('dz', 'τζάμι', 'τζ', 'Like "ds" in "beds".'),
      k('z', 'ζωή', 'ζ', ENGLISH),
      k('v', 'βιβλίο', 'β', 'Like "v". Greek β is said this way.'),
      k('f', 'φίλος', 'φ', ENGLISH),
      k('s', 'σε', 'σ', 'Like "s" in "see".'),
      k('p', 'πόλη', 'π', 'Like "p" in "spin": no puff of air.'),
      k('t', 'τι', 'τ', 'Like "t" in "stop": no puff of air.'),
      k('k', 'καλά', 'κ', 'Like "k" in "skin": no puff of air.'),
      k('l', 'λάθος', 'λ', 'A clear "l", as in "leaf".'),
      k('m', 'μέρα', 'μ', ENGLISH),
      k('n', 'νερό', 'ν', ENGLISH),
      k('j', 'εργαστήριο', 'ι', 'Like "y" in "yes".'),
    ],
  },
  nb: {
    uses: ['ˈ', 'ˌ', 'ː', '.', '\u032F'],
    sounds: [
      v('ɑ', 'far', 'a', 'Like "a" in "father". Short unless ː follows.'),
      v('a', 'takk', 'a', 'Like "a" in "father", short.'),
      v('e', 'en', 'e', 'Like "ay" in "say", without the glide at the end.'),
      v('ɛ', 'den', 'e', 'Like "e" in "bed".'),
      v('ə', 'være', 'e', 'A short, relaxed "uh", as in "sofa".'),
      v('æ', 'være', 'æ', 'Like "a" in "cat". Also e before r.'),
      v('i', 'vi', 'i', 'Like "ee" in "see".'),
      v('ɪ', 'litt', 'i', 'Like "i" in "bit".'),
      v('y', 'by', 'y', 'Say "ee" with your lips pushed forward and rounded.'),
      v('ʏ', 'nytt', 'y', 'A short y, close to "i" in "bit" with rounded lips.'),
      v('ʉ', 'hus', 'u', 'Say "ee" with your lips pushed forward, as for "oo".'),
      v('u', 'bok', 'o', 'Like "oo" in "food", with tightly rounded lips. Norwegian o is often said this way.'),
      v('ʊ', 'hvor', 'o', 'Like "oo" in "book".'),
      v('o', 'sove', 'o', 'Like "o" in "go", without the "w" glide at the end.'),
      v('ɔ', 'og', 'o', 'Like "o" in British "lot". Also å.'),
      v('ø', 'søt', 'ø', 'Say "ay" with your lips rounded.'),
      v('œ', 'høst', 'ø', 'Say "e" in "bed" with your lips rounded.'),
      k('ɾ', 'rød', 'r', 'One quick tap of the tongue, like "tt" in American "butter".'),
      k('r', 'bra', 'r', 'A rolled or tapped r, made with the tip of the tongue.'),
      k('ʋ', 'vann', 'v', 'Between "v" and "w": the lower lip comes close to the teeth without touching.'),
      k('ç', 'kjenne', 'kj', 'A soft hiss, like a whispered "h" before "ee".'),
      k('ʂ', 'norsk', 'rs', '"sh" with the tongue curled back. Also sj, skj and r before s.'),
      k('ʃ', 'sjø', 'sj', 'Like "sh" in "she".'),
      k('ʈ', 'kort', 'rt', 'A "t" with the tongue curled back. r before t makes it.'),
      k('ɖ', 'ferdig', 'rd', 'A "d" with the tongue curled back. r before d makes it.'),
      k('ɳ', 'barn', 'rn', 'An "n" with the tongue curled back. r before n makes it.'),
      k('ɭ', 'ærlig', 'rl', 'An "l" with the tongue curled back. r before l makes it.'),
      k('ɽ', 'gul', 'l', 'A quick flap of the tongue curled back, between "l" and "r". A "thick l" in many dialects.'),
      k('ŋ', 'lang', 'ng', 'Like "ng" in "sing", with no g after it.'),
      k('j', 'ja', 'j', 'Like "y" in "yes". Also g before i or y, and gj and hj.'),
      k('h', 'hus', 'h', ENGLISH),
      k('p', 'på', 'p', ENGLISH),
      k('t', 'tid', 't', ENGLISH),
      k('k', 'kan', 'k', ENGLISH),
      k('b', 'bok', 'b', ENGLISH),
      k('d', 'dag', 'd', ENGLISH),
      k('ɡ', 'gå', 'g', 'Like "g" in "go".'),
      k('f', 'fem', 'f', ENGLISH),
      k('v', 'veldig', 'v', ENGLISH),
      k('s', 'sol', 's', 'Like "s" in "see", never a "z" sound.'),
      k('l', 'lys', 'l', 'A clear "l", as in "leaf".'),
      k('m', 'mor', 'm', ENGLISH),
      k('n', 'ny', 'n', ENGLISH),
    ],
    marks: {
      '¹': '¹ before a word: tone 1. The pitch rises through the word.',
      '²': '² before a word: tone 2. The pitch falls first, then rises.',
    },
  },
  pl: {
    uses: ['ˈ', '.'],
    sounds: [
      v('a', 'tak', 'a', 'Like "a" in "father", but short.'),
      v('ɛ', 'ten', 'e', 'Like "e" in "bed".'),
      v('i', 'mi', 'i', 'Like "ee" in "see", but short.'),
      v('ɘ', 'być', 'y', 'Between "i" in "bit" and "u" in "but". Polish y.'),
      v('ɔ', 'dom', 'o', 'Like "o" in "or", short.'),
      v('u', 'tu', 'u', 'Like "oo" in "food", but short. Also ó.'),
      k('w', 'ładny', 'ł', 'Like "w" in "wet". Polish ł.'),
      k('v', 'woda', 'w', 'Like "v". Polish w.'),
      k('x', 'chleb', 'ch', 'A rough "h" from the back of the throat, as in Scottish "loch". Also h.'),
      k('r', 'rok', 'r', 'A rolled or tapped r.'),
      k('ɕ', 'siedem', 'si', 'A soft "sh", with the middle of the tongue raised. Also ś.'),
      k('ʑ', 'zima', 'zi', 'A soft "zh", with the middle of the tongue raised. Also ź.'),
      k('tɕ', 'być', 'ć', 'A soft "ch", with the middle of the tongue raised. Also ci.'),
      k('dʑ', 'dziś', 'dzi', 'A soft "j", with the middle of the tongue raised. Also dź.'),
      k('ʂ', 'szkoła', 'sz', 'A hard "sh", with the tongue held back.'),
      k('ʐ', 'żaba', 'ż', 'A hard "s" in "measure", with the tongue held back. Also rz.'),
      k('tʂ', 'czas', 'cz', 'A hard "ch", with the tongue held back.'),
      k('dʐ', 'dżem', 'dż', 'A hard "j" in "jam", with the tongue held back.'),
      k('ts', 'co', 'c', 'Like "ts" in "cats".'),
      k('dz', 'dzwon', 'dz', 'Like "ds" in "beds".'),
      k('ɲ', 'nie', 'ni', 'Like "ny" in "canyon". Also ń.'),
      k('ŋ', 'ręka', 'ę', 'Like "ng" in "sing", before k or g.'),
      k('j', 'jak', 'j', 'Like "y" in "yes".'),
      k('p', 'pan', 'p', 'Like "p" in "spin": no puff of air.'),
      k('t', 'tak', 't', 'Like "t" with the tongue against the teeth, and no puff of air.'),
      k('k', 'kot', 'k', 'Like "k" in "skin": no puff of air.'),
      k('b', 'być', 'b', 'Like "b". At the end of a word it\'s said as p.'),
      k('d', 'dom', 'd', 'Like "d" with the tongue against the teeth. At the end of a word it\'s said as t.'),
      k('ɡ', 'gdzie', 'g', 'Like "g" in "go". At the end of a word it\'s said as k.'),
      k('f', 'film', 'f', ENGLISH),
      k('s', 'sam', 's', 'Like "s" in "see".'),
      k('z', 'zamek', 'z', ENGLISH),
      k('l', 'lato', 'l', 'A clear "l", as in "leaf".'),
      k('m', 'mama', 'm', ENGLISH),
      k('n', 'noc', 'n', ENGLISH),
    ],
    marks: {
      '̃': 'A ~ over a vowel means it\'s said partly through the nose: ę and ą.',
    },
  },
  ru: {
    uses: ['ˈ', 'ˌ', 'ʲ', 'ː'],
    sounds: [
      v('a', 'да', 'а', 'Like "a" in "father". Stressed а or о.'),
      v('ɐ', 'вода', 'о', 'A short "uh". What о and а become just before the stress.'),
      v('ə', 'хорошо', 'о', 'A short, relaxed "uh", as in "sofa". What о and а become further from the stress.'),
      v('ɪ', 'язык', 'я', 'Like "i" in "bit". What е, я and а become after a soft consonant, unstressed.'),
      v('i', 'мир', 'и', 'Like "ee" in "see".'),
      v('ɨ', 'мы', 'ы', 'Between "i" in "bit" and "u" in "but", with the tongue pulled back.'),
      v('e', 'лес', 'е', 'Like "e" in "bet", with a hint of "ay".'),
      v('ɛ', 'это', 'э', 'Like "e" in "bed".'),
      v('æ', 'пять', 'я', 'Like "a" in "cat": а between two soft consonants.'),
      v('o', 'дом', 'о', 'Like "o" in "or". Only when stressed.'),
      v('ɵ', 'тётя', 'ё', 'An "o" said further forward, between soft consonants.'),
      v('u', 'тут', 'у', 'Like "oo" in "food", with rounded lips.'),
      v('ʊ', 'рука', 'у', 'Like "oo" in "book". Unstressed у.'),
      v('ʉ', 'люди', 'ю', 'Like "oo" said further forward, after a soft consonant.'),
      k('r', 'рыба', 'р', 'A rolled r: one tap, or a short trill.'),
      k('ɫ', 'лампа', 'л', 'A dark "l", as in "full", with the back of the tongue raised.'),
      k('l', 'лес', 'л', 'A clear "l", as in "leaf". With ʲ, soft.'),
      k('x', 'хорошо', 'х', 'A rough "h" from the back of the throat, as in Scottish "loch".'),
      k('ʂ', 'шапка', 'ш', 'A hard "sh", with the tongue held back.'),
      k('ʐ', 'жить', 'ж', 'A hard "s" in "measure", with the tongue held back.'),
      k('ɕ', 'ещё', 'щ', 'A soft, long "sh", with the middle of the tongue raised.'),
      k('tɕ', 'час', 'ч', 'A soft "ch", as in "cheese".'),
      k('ts', 'отец', 'ц', 'Like "ts" in "cats".'),
      k('j', 'яблоко', 'я', 'Like "y" in "yes". Also the start of е, ё, ю and я.'),
      k('p', 'папа', 'п', 'Like "p" in "spin": no puff of air.'),
      k('t', 'тут', 'т', 'Like "t" with the tongue against the teeth, and no puff of air.'),
      k('k', 'кот', 'к', 'Like "k" in "skin": no puff of air.'),
      k('b', 'брат', 'б', 'Like "b". At the end of a word it\'s said as p.'),
      k('d', 'дом', 'д', 'Like "d" with the tongue against the teeth. At the end of a word it\'s said as t.'),
      k('ɡ', 'год', 'г', 'Like "g" in "go". At the end of a word it\'s said as k.'),
      k('f', 'фото', 'ф', ENGLISH),
      k('v', 'вода', 'в', ENGLISH),
      k('s', 'сам', 'с', 'Like "s" in "see".'),
      k('z', 'зима', 'з', ENGLISH),
      k('ɣ', 'гей', 'г', 'A soft, breathy "g" from the back of the throat, in a few interjections and loanwords.'),
      k('m', 'мама', 'м', ENGLISH),
      k('n', 'нос', 'н', ENGLISH),
    ],
    marks: {
      '⁽⁾': 'A sound in parentheses is often left out.',
    },
  },
  th: {
    uses: ['ː', '.', '\u031A'],
    sounds: [
      v('a', 'จะ', undefined, 'Like "u" in "but". Long (aː) like "a" in "father".'),
      v('i', 'ดี', undefined, 'Like "ee" in "see".'),
      v('ɯ', 'มือ', undefined, 'Say "oo" with your lips spread, not rounded.'),
      v('u', 'หู', undefined, 'Like "oo" in "food".'),
      v('e', 'เด็ก', undefined, 'Like "ay" in "say", without the glide at the end.'),
      v('ɛ', 'แม่', undefined, 'Like "a" in "cat".'),
      v('o', 'โต๊ะ', undefined, 'Like "o" in "go", without the "w" glide at the end.'),
      v('ɔ', 'พ่อ', undefined, 'Like "aw" in "law".'),
      v('ɤ', 'เธอ', undefined, 'Like "u" in "but", held with the lips spread.'),
      v('ia̯', 'เมีย', undefined, '"ee" gliding into "uh", in one syllable.'),
      v('ɯa̯', 'เรือ', undefined, 'ɯ gliding into "uh", in one syllable.'),
      v('ua̯', 'ตัว', undefined, '"oo" gliding into "uh", in one syllable.'),
      k('p', 'ปลา', 'ป', 'Like "p" in "spin": no puff of air. At the end of a syllable it isn\'t let go.'),
      k('pʰ', 'พ่อ', 'พ', 'Like "p" in "pin", with a puff of air.'),
      k('b', 'บ้าน', 'บ', ENGLISH),
      k('t', 'ตา', 'ต', 'Like "t" in "stop": no puff of air. At the end of a syllable it isn\'t let go.'),
      k('tʰ', 'ทำ', 'ท', 'Like "t" in "top", with a puff of air.'),
      k('d', 'ดี', 'ด', ENGLISH),
      k('k', 'ไก่', 'ก', 'Like "k" in "skin": no puff of air. At the end of a syllable it isn\'t let go.'),
      k('kʰ', 'ขา', 'ข', 'Like "k" in "kin", with a puff of air.'),
      k('tɕ', 'จาน', 'จ', 'Like "j" in "jeep" said without voice: no puff of air.'),
      k('tɕʰ', 'ช้าง', 'ช', 'Like "ch" in "chin", with a puff of air.'),
      k('ʔ', 'อ่าน', 'อ', 'A tiny catch in the throat, as in "uh-oh". Starts a word with อ, and ends a short vowel.'),
      k('ŋ', 'งู', 'ง', 'Like "ng" in "sing", even at the start of a word.'),
      k('r', 'เรือ', 'ร', 'A tapped or rolled r. In everyday speech often said as l.'),
      k('l', 'ลิง', 'ล', ENGLISH),
      k('s', 'เสือ', 'ส', ENGLISH),
      k('h', 'หู', 'ห', ENGLISH),
      k('f', 'ฟัน', 'ฟ', ENGLISH),
      k('j', 'ยา', 'ย', 'Like "y" in "yes".'),
      k('w', 'วัน', 'ว', 'Like "w" in "wet".'),
      k('m', 'มือ', 'ม', ENGLISH),
      k('n', 'นา', 'น', ENGLISH),
    ],
    marks: {
      '˧': 'Mid tone: level, in the middle of the voice.',
      '˨˩': 'Low tone: low and level, dropping a little.',
      '˥˩': 'Falling tone: starts high and drops.',
      '˦˥': 'High tone: high, rising a little.',
      '˩˩˦': 'Rising tone: starts low, dips, then rises.',
      // The same tones as accents on the vowel (sùk), as a romanization or a hand-typed IPA writes them. Mid has none.
      '\u0300': 'An accent like à: low tone, low and level, dropping a little.',
      '\u0301': 'An accent like á: high tone, high, rising a little.',
      '\u0302': 'An accent like â: falling tone, starts high and drops.',
      '\u030C': 'An accent like ǎ: rising tone, starts low, dips, then rises.',
    },
  },
  ja: {
    uses: [],
    sounds: [
      v('a', 'あさ', 'あ', 'Like "a" in "father", but short.'),
      v('i', 'いえ', 'い', 'Like "ee" in "see", but short.'),
      v('ɯ', 'うみ', 'う', 'Like "oo" in "food", with the lips relaxed, not rounded.'),
      v('e', 'えき', 'え', 'Like "e" in "bet".'),
      v('o', 'おと', 'お', 'Like "o" in "or", short.'),
      k('k', 'かさ', 'か', ENGLISH),
      k('ɡ', 'がっこう', 'が', 'Like "g" in "go". Some speakers say it as ŋ in the middle of a word.'),
      k('s', 'すし', 'す', 'Like "s" in "see".'),
      k('ɕ', 'しお', 'し', 'A soft "sh", with the middle of the tongue raised.'),
      k('dz', 'ざっし', 'ざ', 'Like "ds" in "beds". In the middle of a word, often a plain "z".'),
      k('dʑ', 'じかん', 'じ', 'A soft "j", as in "jeep".'),
      k('t', 'たかい', 'た', ENGLISH),
      k('ts', 'つき', 'つ', 'Like "ts" in "cats".'),
      k('tɕ', 'ちず', 'ち', 'A soft "ch", as in "cheese".'),
      k('d', 'でんわ', 'で', ENGLISH),
      k('n', 'なまえ', 'な', ENGLISH),
      k('ɲ', 'にほん', 'に', 'Like "ny" in "canyon".'),
      k('h', 'はな', 'は', ENGLISH),
      k('ç', 'ひと', 'ひ', 'A soft hiss, like a whispered "h" before "ee".'),
      k('ɸ', 'ふね', 'ふ', 'An "f" made with both lips, as if blowing out a candle.'),
      k('b', 'ばしょ', 'ば', ENGLISH),
      k('p', 'ぱん', 'ぱ', ENGLISH),
      k('m', 'みず', 'み', ENGLISH),
      k('j', 'やま', 'や', 'Like "y" in "yes".'),
      k('ɾ', 'りんご', 'り', 'One quick tap of the tongue, between "r", "l" and "d".'),
      k('w', 'わたし', 'わ', 'Like "w", with the lips barely rounded.'),
      k('ɴ', 'ほん', 'ん', 'ん at the end of a word: an "n" made at the back of the mouth, with the tongue not touching the teeth.'),
      k('ŋ', 'げんき', 'ん', 'ん before k or g: like "ng" in "sing".'),
    ],
    marks: {
      'ʲ': 'ʲ means a "y" sound blends into the consonant: きょ, りゅ.',
      'ː': 'ː means the sound before it is held twice as long: a long vowel, or a doubled consonant (っ).',
    },
  },
};

/** `code` when it has a guide: a word popup's or Look up's language, which may be one with none (English, Toki Pona). */
export function ipaGuideFor(code: string): Language | undefined {
  return Object.hasOwn(IPA_GUIDES, code) ? (code as Language) : undefined;
}

/** The guide's language for a card's speech language (nb-NO, th-TH), when there's a guide for it. */
export function ipaLanguageFor(speechLang: string | undefined): Language | undefined {
  if (!speechLang) return undefined;
  const primary = speechLang.split('-')[0].toLowerCase();
  const found = LANGUAGE_ORDER.find((l) => LANGUAGES[l].speech.split('-')[0] === primary);
  return found && IPA_GUIDES[found] ? found : undefined;
}

// What each guide matches against: its symbols with tie bars taken out and decomposed, longest first.
const matchers = new Map<Language, { key: string; sound: IpaSound }[]>();
function matcherFor(language: Language) {
  let m = matchers.get(language);
  if (!m) {
    m = (IPA_GUIDES[language]?.sounds ?? [])
      .map((sound) => ({ key: forMatching(sound.ipa), sound }))
      .sort((a, b) => b.key.length - a.key.length);
    matchers.set(language, m);
  }
  return m;
}

// Decomposed, without tie bars, and with the ASCII stand-ins a hand-typed IPA uses (g, ' and :) made the real symbols.
function forMatching(ipa: string): string {
  return ipa.normalize('NFD').replace(/[͜͡]/g, '').replace(/g/g, 'ɡ').replace(/'/g, 'ˈ').replace(/:/g, 'ː');
}

/** How a mark is shown: a combining one on a dotted circle, so it has something to sit on. */
function shownMark(mark: string): string {
  return /^\p{M}/u.test(mark) ? `◌${mark}` : mark === '()' ? '( )' : mark === '⁽⁾' ? '⁽ ⁾' : mark;
}

/**
 * A word's IPA split into the guide's sounds, in order and each once, with the marks it uses
 * explained under them. A symbol the guide has no row for is a part with no `sound`, so the sheet
 * says so rather than leaving it out; a mark it has no words for is shown in the sound it's on.
 */
export function ipaBreakdown(ipa: string, language: Language): IpaBreakdown {
  const guide = IPA_GUIDES[language];
  const markHints: Record<string, string> = { ...MARKS, ...guide?.marks };
  const sounds = matcherFor(language);
  const parts: IpaPart[] = [];
  const marks: IpaMark[] = [];
  const addMark = (mark: string, hint: string | undefined) => {
    if (hint && !marks.some((m) => m.hint === hint)) marks.push({ mark: shownMark(mark), hint });
  };
  const addPart = (written: string, sound?: IpaSound) => {
    const shown = written.normalize('NFC');
    if (!parts.some((p) => p.written === shown)) parts.push({ written: shown, ...(sound ? { sound } : {}) });
  };
  let s = forMatching(ipa);
  while (s) {
    const frame = FRAME.exec(s);
    if (frame) { s = s.slice(frame[0].length); continue; }
    const tone = TONE_RUN.exec(s);
    if (tone) {
      addMark(tone[0], markHints[tone[0]] ?? ANY_TONE);
      s = s.slice(tone[0].length);
      continue;
    }
    const ch = s[0];
    if (ch === '(' || ch === ')') { addMark('()', markHints['()']); s = s.slice(1); continue; }
    if (ch === '⁽' || ch === '⁾') { addMark('⁽⁾', markHints['⁽⁾'] ?? markHints['()']); s = s.slice(1); continue; }
    if ('ˈˌ.‿¹²'.includes(ch)) { addMark(ch, markHints[ch]); s = s.slice(1); continue; }
    // A length or softness mark cut off from its sound by a parenthesis (u(ː), s⁽ʲ⁾) still means the same.
    const lone = MODIFIER.exec(s);
    if (lone) { addMark(lone[0], markHints[lone[0]]); s = s.slice(lone[0].length); continue; }
    const hit = sounds.find((m) => s.startsWith(m.key));
    let written = hit ? hit.key : [...s][0];
    s = s.slice(written.length);
    // What follows and belongs to the sound: ː, ʲ, ʰ and combining marks, explained under the sounds where the guide has words for it.
    for (let mod = MODIFIER.exec(s); mod; mod = MODIFIER.exec(s)) {
      written += mod[0];
      addMark(mod[0], markHints[mod[0]]);
      s = s.slice(mod[0].length);
    }
    // A combining mark the key already holds (the ̃ of ɑ̃, the ̯ of aɪ̯) is explained by its row, not as a mark.
    addPart(written, hit?.sound);
  }
  return { parts, marks };
}

/** The guide's sounds split into vowels and consonants, for the IPA tab. */
export function ipaSections(language: Language): { title: string; sounds: IpaSound[] }[] {
  const sounds = IPA_GUIDES[language]?.sounds ?? [];
  return [
    { title: 'Vowels', sounds: sounds.filter((s) => s.kind === 'vowel') },
    { title: 'Consonants', sounds: sounds.filter((s) => s.kind === 'consonant') },
  ].filter((s) => s.sounds.length);
}

/** Every mark a language's guide explains, for the IPA tab's last section. */
export function ipaMarks(language: Language): IpaMark[] {
  const guide = IPA_GUIDES[language];
  if (!guide) return [];
  const own = guide.marks ?? {};
  const shared = guide.uses.filter((m) => !(m in own)).map((m) => [m, MARKS[m]] as const);
  return [...shared, ...Object.entries(own)].map(([mark, hint]) => ({ mark: shownMark(mark), hint }));
}

/** `example` split around `spelled`, for drawing the letters that make the sound highlighted. */
export function exampleSpans(sound: IpaSound): { text: string; marked: boolean }[] {
  // Case-insensitive, so a German noun's capital still shows its letters (Zeit's z).
  const at = sound.spelled ? sound.example.toLowerCase().indexOf(sound.spelled.toLowerCase()) : -1;
  if (at < 0) return [{ text: sound.example, marked: false }];
  const end = at + sound.spelled!.length;
  return [
    { text: sound.example.slice(0, at), marked: false },
    { text: sound.example.slice(at, end), marked: true },
    { text: sound.example.slice(end), marked: false },
  ].filter((p) => p.text);
}
