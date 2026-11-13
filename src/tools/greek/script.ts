import type { ScriptLanguage } from '../script';
import { greekRoman } from './translit';

/*
 * Reading Greek aloud. Greek writes its stress, so the hard part is the letters: pairs read as
 * one sound (ου u, αι e, ει and οι i, μπ b, ντ d, γκ and γγ g and ng, τσ ts, τζ dz), αυ and ευ as
 * av/ev or af/ef, and letters that don't sound as they look (β v, δ th in "this", θ th in
 * "think", χ like the ch in "loch", η and υ i).
 */

const WORDS: [word: string, meaning: string][] = [
  ['ευχαριστώ', 'thank you'], ['καλημέρα', 'good morning'], ['μπίρα', 'beer'], ['ντομάτα', 'tomato'], ['γκαράζ', 'garage'],
  ['τσάι', 'tea'], ['τζάμι', 'window pane'], ['ουρανός', 'sky'], ['παιδί', 'child'], ['είναι', 'is'],
  ['οικογένεια', 'family'], ['αυτοκίνητο', 'car'], ['αύριο', 'tomorrow'], ['θάλασσα', 'sea'], ['χαρά', 'joy'],
  ['ψωμί', 'bread'], ['ξενοδοχείο', 'hotel'], ['γάλα', 'milk'], ['δρόμος', 'road'], ['φίλος', 'friend'],
  ['άγγελος', 'angel'], ['εγώ', 'I'], ['νερό', 'water'], ['σπίτι', 'house'], ['βιβλίο', 'book'],
  ['ώρα', 'hour'], ['Ελλάδα', 'Greece'], ['ήλιος', 'sun'],
];

/** What's worth knowing to read a word, by what's in it, most surprising first. */
const FEATURES: [test: RegExp, pattern: string, says: string][] = [
  [/μπ/, 'mp', 'μπ sounds like b (mb inside a word).'],
  [/ντ/, 'nt', 'ντ sounds like d (nd inside a word).'],
  [/γκ/, 'gk', 'γκ sounds like g.'],
  [/γγ/, 'gg', 'γγ sounds like the ng in "finger".'],
  [/τσ/, 'ts', 'τσ sounds like ts.'],
  [/τζ/, 'tz', 'τζ sounds like dz.'],
  [/ο[υύ]/, 'ou', 'ου sounds like the u in "too".'],
  [/α[ιί]/, 'ai', 'αι sounds like e.'],
  [/[εο][ιί]/, 'ei', 'ει and οι sound like i.'],
  [/[αεάέ][υύ]/, 'au', 'αυ and ευ are av and ev, or af and ef before θ, κ, ξ, π, σ, τ, φ, χ and ψ.'],
  [/β/, 'v', 'β sounds like v.'],
  [/δ/, 'd', 'δ sounds like the th in "this".'],
  [/θ/, 'th', 'θ sounds like the th in "think".'],
  [/χ/, 'h', 'χ sounds like the ch in "loch".'],
  // υ after α, ε or ο is part of a pair (ου, αυ, ευ), not an i.
  [/[ηή]|(?<![αεοάέό])[υύ]/, 'i', 'η and υ both sound like i.'],
];

const featuresOf = (word: string) => FEATURES.filter(([test]) => test.test(word.toLowerCase()));

export const GREEK_SCRIPT: ScriptLanguage = {
  words: WORDS.map(([word, meaning]) => ({ shown: word, meaning, answer: { text: word, roman: greekRoman(word) } })),
  rule: (i) => {
    const said = featuresOf(WORDS[i][0]).slice(0, 2).map(([, , says]) => says);
    return said.length ? said.join(' ') : undefined;
  },
  patterns: (i) => featuresOf(WORDS[i][0]).map(([, pattern]) => `letters:${pattern}`),
};
