import { wordItems, type WritingLanguage } from '../writing';
import { GREEK_SCRIPT } from './script';

/*
 * Writing Greek by hand: each of the 24 letters, capital and small (sigma with the form it takes
 * at the end of a word), from its name and how it sounds in modern Greek.
 */
const LETTERS: [capital: string, small: string, name: string, greekName: string, sound: string][] = [
  ['Α', 'α', 'alpha', 'άλφα', 'a, as in "father"'], ['Β', 'β', 'beta', 'βήτα', 'v'], ['Γ', 'γ', 'gamma', 'γάμα', 'A soft g, or y before e and i'],
  ['Δ', 'δ', 'delta', 'δέλτα', 'th, as in "this"'], ['Ε', 'ε', 'epsilon', 'έψιλον', 'e, as in "bed"'], ['Ζ', 'ζ', 'zeta', 'ζήτα', 'z'],
  ['Η', 'η', 'eta', 'ήτα', 'ee, as in "see"'], ['Θ', 'θ', 'theta', 'θήτα', 'th, as in "think"'], ['Ι', 'ι', 'iota', 'γιώτα', 'ee, as in "see"'],
  ['Κ', 'κ', 'kappa', 'κάπα', 'k'], ['Λ', 'λ', 'lambda', 'λάμδα', 'l'], ['Μ', 'μ', 'mu', 'μι', 'm'], ['Ν', 'ν', 'nu', 'νι', 'n'],
  ['Ξ', 'ξ', 'xi', 'ξι', 'ks, as in "box"'], ['Ο', 'ο', 'omicron', 'όμικρον', 'o, as in "more"'], ['Π', 'π', 'pi', 'πι', 'p'],
  ['Ρ', 'ρ', 'rho', 'ρο', 'a rolled r'], ['Σ', 'σ ς', 'sigma', 'σίγμα', 's'], ['Τ', 'τ', 'tau', 'ταυ', 't'],
  ['Υ', 'υ', 'upsilon', 'ύψιλον', 'ee, as in "see"'], ['Φ', 'φ', 'phi', 'φι', 'f'], ['Χ', 'χ', 'chi', 'χι', 'kh, like the ch in "loch"'],
  ['Ψ', 'ψ', 'psi', 'ψι', 'ps, as in "lapse"'], ['Ω', 'ω', 'omega', 'ωμέγα', 'o, as in "more"'],
];

export const GREEK_WRITING: WritingLanguage = {
  letters: LETTERS.map(([capital, small, name, greekName, sound]) => ({
    text: `${capital} ${small}`,
    prompt: name,
    detail: sound,
    say: greekName,
    patterns: [`letter:${small[0]}`],
  })),
  words: wordItems(GREEK_SCRIPT),
};
