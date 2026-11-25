import { recordingName } from '../core/recording';
import type { AzureVoice, Language } from '../reader/api';
import { JAPANESE_HEARING } from './japanese/hearing';
import { POLISH_HEARING } from './polish/hearing';
import { RUSSIAN_HEARING } from './russian/hearing';
import { THAI_HEARING } from './thai/hearing';
import { toneOfRoman, TONE_NAMES, TONES, type Tone } from './thai/script';

/**
 * Hearing sounds: a word played in one of several voices, and which of two or three near-identical
 * words it was (Thai ข่าว or ข้าว, Polish czy or ci). The sets are hand-written for each language,
 * each one differing by a single sound (`HearingSet.sound`), so a miss says which sound isn't heard
 * yet, and marks.ts leans the next question toward it. Hearing a sound in several voices is what
 * teaches it: one voice teaches that voice. The words needn't be studied, since telling the sounds
 * apart comes before knowing the words. Thai's tone sets also ask for the tone itself (`kind:
 * 'tone'`). Pure; the screen is src/ui/tools/HearingTool.tsx. Like every tool, it never grades a card.
 */

export interface HearingWord {
  /** As shown: the word in its own script (Japanese in kana, which is where the sounds differ). */
  word: string;
  /** Romanized. A Thai one carries the tone on its vowel (thai/script.ts, `toneOfRoman`). */
  roman: string;
  meaning: string;
  /**
   * What the voice is given in place of `word`: a Russian word without its stress mark, which a
   * voice doesn't read, or a Japanese word in kanji, with `reading` saying which reading is meant.
   */
  say?: string;
  /** A Japanese word's reading in kana, for Read & Listen's server to say in place of the kanji. */
  reading?: string;
}

/** One sound to tell apart, e.g. Polish sz or ś. */
export interface HearingSound {
  id: string;
  /** Short, as a round's results list it: "sz or ś", "Falling tone". */
  label: string;
  /** Which `HearingGroup` it's practiced under. */
  group: string;
  /** What to listen for, shown after a miss. */
  tip: string;
}

/** A few sounds practiced together, chosen in the tool's menu: Tones, Vowel length. */
export interface HearingGroup {
  id: string;
  label: string;
}

/**
 * Words that differ by one sound. `sound` is a `HearingSound` id, or `TONE_SET` for a Thai set
 * whose words differ only by tone: each word's sound is then its own tone (`soundOf`).
 */
export interface HearingSet {
  sound: string;
  words: HearingWord[];
}

export interface HearingLanguage {
  groups: HearingGroup[];
  sounds: HearingSound[];
  sets: HearingSet[];
}

/** A Thai set whose words differ only by tone. */
export const TONE_SET = 'tone';

/** What to listen for in each tone, read off the tone pictures in ToneContour.tsx. */
const TONE_TIPS: Record<Tone, string> = {
  mid: 'Mid stays level, in the middle of your voice.',
  low: 'Low starts low and stays level or sinks a little.',
  falling: 'Falling climbs first, then drops sharply.',
  high: 'High is pitched up and lifts a little more at the end.',
  rising: 'Rising dips first, then climbs.',
};

/** Thai's five tones as sounds, under the Tones group: what a tone set's miss is tallied against. */
export const TONE_SOUNDS: HearingSound[] = TONES.map((t) => ({ id: `tone:${t}`, label: `${TONE_NAMES[t]} tone`, group: 'tones', tip: TONE_TIPS[t] }));

/** Each language Hearing sounds can be practiced in. */
export const HEARING: Partial<Record<Language, HearingLanguage>> = {
  th: THAI_HEARING,
  pl: POLISH_HEARING,
  ru: RUSSIAN_HEARING,
  ja: JAPANESE_HEARING,
};

/** How many questions a round has before its results. */
export const ROUND_LENGTH = 20;

/** How often a tone set asks for the tone itself, rather than which word it was. */
export const TONE_QUESTION_SHARE = 1 / 3;

/** What a round is narrowed to: every group, one group, or one sound (Practice <the weakest>). */
export type HearingFocus = { kind: 'all' } | { kind: 'group'; id: string } | { kind: 'sound'; id: string };

/**
 * A question: `pick` plays a set's word and asks which of the set it was; `tone` plays a word from
 * a Thai tone set and asks for its tone. `set` and `target` are indexes into the language's sets
 * and that set's words.
 */
export interface HearingQuestion {
  kind: 'pick' | 'tone';
  set: number;
  target: number;
}

export const questionKey = (q: HearingQuestion): string => `${q.kind}:${q.set}:${q.target}`;

/** The sound a word stands for in its set: the set's, or in a tone set, the word's own tone. */
export function soundOf(set: HearingSet, word: HearingWord): string {
  return set.sound === TONE_SET ? `tone:${toneOfRoman(word.roman)}` : set.sound;
}

/** Every sound a language has, tones included where it has tone sets. */
export function soundsOf(language: HearingLanguage): HearingSound[] {
  return language.sets.some((s) => s.sound === TONE_SET) ? [...TONE_SOUNDS, ...language.sounds] : language.sounds;
}

export function soundById(language: HearingLanguage, id: string): HearingSound | undefined {
  return soundsOf(language).find((s) => s.id === id);
}

/** The patterns a question is tallied under (marks.ts): the sound its word stands for. */
export function hearingPatterns(language: HearingLanguage, q: HearingQuestion): string[] {
  const set = language.sets[q.set];
  const word = set?.words[q.target];
  return set && word ? [soundOf(set, word)] : [];
}

/** The group a set is practiced under. */
function groupOf(language: HearingLanguage, set: HearingSet): string | undefined {
  return set.sound === TONE_SET ? 'tones' : language.sounds.find((s) => s.id === set.sound)?.group;
}

/** Each target a focus allows, as [set, word] indexes: a group's sets' words, or the words standing for one sound. */
export function targetsFor(language: HearingLanguage, focus: HearingFocus): [number, number][] {
  const targets: [number, number][] = [];
  language.sets.forEach((set, s) => {
    if (focus.kind === 'group' && groupOf(language, set) !== focus.id) return;
    set.words.forEach((word, w) => {
      if (focus.kind === 'sound' && soundOf(set, word) !== focus.id) return;
      targets.push([s, w]);
    });
  });
  return targets;
}

/**
 * A random question within `focus`, never `previous` again while there's another to ask. A word
 * from a tone set is asked for its tone `TONE_QUESTION_SHARE` of the time. Undefined when the focus
 * holds nothing (a group the language doesn't have).
 */
export function drawHearing(language: HearingLanguage, focus: HearingFocus, previous: string | undefined, random: () => number): HearingQuestion | undefined {
  const targets = targetsFor(language, focus);
  if (!targets.length) return undefined;
  const pickOne = (): HearingQuestion => {
    const [set, target] = targets[Math.floor(random() * targets.length)];
    const tone = language.sets[set].sound === TONE_SET && random() < TONE_QUESTION_SHARE;
    return { kind: tone ? 'tone' : 'pick', set, target };
  };
  let q = pickOne();
  // A handful of tries is plenty: a focus with one word and one kind has nothing else to ask.
  for (let i = 0; i < 8 && questionKey(q) === previous; i++) q = pickOne();
  return q;
}

/** A focus still meaningful in `language`: a group or sound it doesn't have falls back to all. */
export function validFocus(language: HearingLanguage, focus: HearingFocus): HearingFocus {
  if (focus.kind === 'group' && language.groups.some((g) => g.id === focus.id)) return focus;
  if (focus.kind === 'sound' && soundById(language, focus.id)) return focus;
  return { kind: 'all' };
}

/** One answer in a round: the sound its word stood for, and whether it was heard right. */
export interface HearingAnswer {
  sound: string;
  right: boolean;
}

export interface SoundResult {
  sound: string;
  label: string;
  right: number;
  asked: number;
}

/** A round's answers by sound, the weakest first (the lowest share right, then the most asked). */
export function roundResults(language: HearingLanguage, answers: HearingAnswer[]): SoundResult[] {
  const by = new Map<string, SoundResult>();
  for (const a of answers) {
    const r = by.get(a.sound) ?? { sound: a.sound, label: soundById(language, a.sound)?.label ?? a.sound, right: 0, asked: 0 };
    r.asked++;
    if (a.right) r.right++;
    by.set(a.sound, r);
  }
  return [...by.values()].sort((a, b) => a.right / a.asked - b.right / b.asked || b.asked - a.asked);
}

/** The sound to offer practicing next: the weakest in the round, if any of it was missed. */
export function weakestSound(results: SoundResult[]): SoundResult | undefined {
  const first = results[0];
  return first && first.right < first.asked ? first : undefined;
}

/** How many voices a word is recorded in: more than this adds little but cost. */
export const MAX_VOICES = 4;

/**
 * The Azure voices a language's words are recorded in: the language's own (its locale's, not a
 * Multilingual voice from elsewhere, nor an HD variant named with a colon), up to `MAX_VOICES`,
 * taking women and men in turn so both are heard. In the server's order otherwise.
 */
export function hearingVoices(voices: AzureVoice[], language: Language): string[] {
  const own = voices.filter((v) => {
    const locale = v.locale.toLowerCase();
    return (locale === language || locale.startsWith(`${language}-`)) && /Neural$/.test(v.voice) && !v.voice.includes(':') && !/Multilingual/i.test(v.voice);
  });
  const women = own.filter((v) => /^f/i.test(v.gender ?? ''));
  const men = own.filter((v) => /^m/i.test(v.gender ?? ''));
  const others = own.filter((v) => !women.includes(v) && !men.includes(v));
  const firstWoman = own[0] && women[0] === own[0];
  const [a, b] = firstWoman ? [women, men] : [men, women];
  const taken: string[] = [];
  for (let i = 0; taken.length < MAX_VOICES && (i < a.length || i < b.length); i++) {
    if (i < a.length) taken.push(a[i].voice);
    if (taken.length < MAX_VOICES && i < b.length) taken.push(b[i].voice);
  }
  for (const v of others) if (taken.length < MAX_VOICES) taken.push(v.voice);
  return taken;
}

/** What a voice is given for a word: `say` where it has one, else the word itself. */
export const spokenText = (w: HearingWord): string => w.say ?? w.word;

/** The file a word's recording in a voice is kept in, named as a card's recording would be (recording.ts). */
export function clipName(w: HearingWord, voice: string): string {
  return recordingName(spokenText(w), voice, 1, w.reading);
}

/** Every word a language has, once each, for recording them all ahead. */
export function allWords(language: HearingLanguage): HearingWord[] {
  const seen = new Map<string, HearingWord>();
  for (const set of language.sets) for (const w of set.words) if (!seen.has(spokenText(w) + (w.reading ?? ''))) seen.set(spokenText(w) + (w.reading ?? ''), w);
  return [...seen.values()];
}
