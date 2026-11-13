import type { ScriptLanguage } from '../script';
import { russianTranslit } from './translit';

/*
 * Reading Russian aloud. Russian doesn't write its stress, and the stress changes how the other
 * vowels sound: an unstressed о sounds like а (молоко́, "malakó"), and an unstressed е or я close
 * to и. The question shows the word as it's written; the answer marks the stress (an acute over
 * its vowel, which ё always has). Words whose letters say something other than what's written
 * (сего́дня, что) are left out.
 */

const ACUTE = '́';

/** Each word with its stress marked, and its meaning. */
const WORDS: [stressed: string, meaning: string][] = [
  ['молоко́', 'milk'], ['вода́', 'water'], ['хорошо́', 'well, good'], ['спаси́бо', 'thank you'], ['го́род', 'city'],
  ['рабо́та', 'work'], ['кни́га', 'book'], ['у́лица', 'street'], ['больни́ца', 'hospital'], ['магази́н', 'shop'],
  ['ры́ба', 'fish'], ['мя́со', 'meat'], ['язы́к', 'language'], ['де́вушка', 'young woman'], ['ребёнок', 'child'],
  ['о́зеро', 'lake'], ['доро́га', 'road'], ['ча́шка', 'cup'], ['щено́к', 'puppy'], ['жена́', 'wife'],
  ['окно́', 'window'], ['маши́на', 'car'], ['бе́рег', 'shore'], ['телефо́н', 'phone'], ['ты́сяча', 'thousand'],
  ['зе́ркало', 'mirror'], ['писа́тель', 'writer'], ['яйцо́', 'egg'], ['пя́тница', 'Friday'],
];

/** The stressed vowel's index in `stressed` with the mark taken out, or -1 for none marked. */
function stressAt(stressed: string): number {
  const yo = stressed.indexOf('ё');
  if (yo >= 0) return yo;
  const acute = stressed.indexOf(ACUTE);
  return acute > 0 ? acute - 1 : -1;
}

const plain = (stressed: string) => stressed.split(ACUTE).join('');

/** The vowels written that don't carry the stress and sound different for it. */
function reduced(stressed: string): { o: boolean; eYa: boolean } {
  const word = plain(stressed);
  const at = stressAt(stressed);
  const others = [...word].filter((_, i) => i !== at);
  return { o: others.includes('о'), eYa: others.includes('е') || others.includes('я') };
}

export const RUSSIAN_SCRIPT: ScriptLanguage = {
  words: WORDS.map(([stressed, meaning]) => ({
    shown: plain(stressed),
    meaning,
    answer: { text: stressed, roman: russianTranslit(stressed) },
  })),
  rule: (i) => {
    const [stressed] = WORDS[i];
    const at = stressAt(stressed);
    if (at < 0) return undefined;
    const { o, eYa } = reduced(stressed);
    return [
      `The stress is on ${plain(stressed)[at]}: ${stressed}.`,
      o && 'An unstressed о sounds like а.',
      eYa && 'An unstressed е or я sounds close to и.',
    ].filter(Boolean).join(' ');
  },
  patterns: (i) => {
    const { o, eYa } = reduced(WORDS[i][0]);
    return [o && 'reduced:o', eYa && 'reduced:e'].filter((p): p is string => !!p);
  },
};
