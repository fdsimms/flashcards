import { isOmnilanguage, speechLangFor } from '../core/cards';
import { CONFUSED_REASON, partnerIndex, type ConfusedPair } from '../core/confusedPairs';
import { headword } from '../core/forms';
import { htmlToText } from '../core/html';
import { toHiragana } from '../core/kana';
import { stripMarks } from '../core/letters';
import { kanjiNeighbors, lookalikeForm, lookalikeIndex } from '../core/lookalikes';
import { searchPlace, searchQuery, searchRank, type SearchPlace } from '../core/searchRank';
import { meaningSet, sameMeaning } from '../core/synonyms';
import type { Note } from '../core/types';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';

/**
 * Similar words: telling apart words from the learner's own decks that are easy to confuse.
 * Two ways to ask:
 * - **By meaning**: a meaning, and the word for it among its lookalikes (esperar, esperanza,
 *   espera), from the same links that keep lookalikes apart in Review (lookalikes.ts).
 * - **By ear**: a word played, and which of its sound-alikes it was: words spelled or romanized
 *   the same once tones and accents are taken off (Thai ใกล้ klâi and ไกล klai, Spanish esta and
 *   está), or written the same in kana (Japanese 橋 and 箸).
 * - **Your pairs**: words the learner linked by hand as ones they mix up (src/core/confusedPairs.ts),
 *   asked like By meaning, whatever the words look or sound like.
 * Only words already being studied are asked or offered as choices: telling apart a word not yet
 * learned tests nothing. Like every tool, it never grades a card (tools.ts).
 */

export const MIXUP_MODES = ['meaning', 'ear', 'pairs'] as const;
export type MixupMode = (typeof MIXUP_MODES)[number];

export interface MixupWord {
  noteId: string;
  language: Language;
  /** As written: the note's Entry. */
  word: string;
  meaning: string;
  /** The romanization (Transliteration) or, for Japanese, the reading in kana. */
  roman?: string;
  partOfSpeech?: string;
}

export interface MixupSet {
  words: Map<string, MixupWord>;
  /** Each word's lookalikes with another meaning, by note id. */
  meaning: Map<string, string[]>;
  /** Each word's linked partners (`ConfusedPair`) with another meaning, by note id. */
  pairs: Map<string, string[]>;
  /** Each word's sound-alikes, by note id. */
  ear: Map<string, string[]>;
}

/** The tool language a note is in, from its Language field or deck (`speechLangFor`). */
export function mixupLanguage(note: Note): Language | undefined {
  const code = speechLangFor(note)?.split('-')[0].toLowerCase();
  const lang = code === 'no' ? 'nb' : code;
  return lang && lang in LANGUAGES ? (lang as Language) : undefined;
}

const text = (field: string | undefined) => htmlToText(field ?? '').replace(/\s+/g, ' ').trim();
const unmarked = (s: string) => stripMarks(s.normalize('NFKD')).normalize('NFC');

/**
 * What a word sounds like, near enough to be confused by ear: its romanization (or kana, katakana
 * read as the hiragana it spells) with tones, accents and hyphens taken off, else its spelling as the
 * lookalike check compares it, without hyphens or spaces. Kana keeps its voicing marks (stripMarks): かいがん and かいかん don't sound alike. Thai without a
 * romanization has none, as Thai script carries the tone in letters that can't be taken off.
 */
export function soundKey(w: MixupWord): string | undefined {
  if (!w.roman && (w.language === 'th' || w.language === 'ja')) return undefined;
  // A spelling keeps the letters its language hears (ą, ö, й, ё), as the lookalike check does
  // (`lookalikeForm`): only languages whose accents are marks, and Russian stress marks, lose them.
  const base = w.roman ? unmarked(toHiragana(w.roman).toLocaleLowerCase()) : lookalikeForm(w.word, w.language);
  if (!base) return undefined;
  const key = base.replace(/[-‐·'’\s]/g, '');
  return (w.language === 'ja' ? heardAs(key) : key) || undefined;
}

/** Each small kana as the full-size one (びょういん as びよういん). */
const FULL_SIZE: Record<string, string> = { ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', ゎ: 'わ' };
/** The vowel each kana ends in, for telling a long vowel from a new syllable. */
const VOWEL_OF: Record<string, string> = Object.fromEntries(
  ['あかさたなはまやらわがざだばぱ', 'いきしちにひみりぎじぢびぴ', 'うくすつぬふむゆるぐずづぶぷ', 'えけせてねへめれげぜでべぺ', 'おこそとのほもよろをごぞどぼぽ']
    .flatMap((row, v) => Array.from(row, (k) => [k, 'aiueo'[v]])),
);
const LENGTHENS: Record<string, string> = { a: 'あ', i: 'い', u: 'う', e: 'いえ', o: 'うお' };

/**
 * A Japanese reading as a learner's ear slips on it: a long vowel heard short (おばあさん as おばさん,
 * せんせい as せんせ), the small っ missed (きって as きて), and a small ゃゅょ heard full size (びょういん
 * as びよういん). Words whose readings come out the same are asked as sound-alikes.
 */
function heardAs(kana: string): string {
  const chars = Array.from(kana.replace(/[っー]/g, '')).map((c) => FULL_SIZE[c] ?? c);
  const out: string[] = [];
  for (const c of chars) {
    const before = out[out.length - 1];
    const vowel = before && VOWEL_OF[before];
    if (vowel && LENGTHENS[vowel].includes(c)) continue;
    out.push(c);
  }
  return out.join('');
}

/** A Thai word without its repetition mark ๆ (จริงๆ is จริง said twice, for emphasis). */
const withoutRepeat = (word: string) => word.replace(/\s*ๆ+\s*$/u, '');

/** Whether one word is the other with ๆ added: the same word, so a meaning can't tell them apart. */
export function isRepeatForm(a: MixupWord, b: MixupWord): boolean {
  return a.language === 'th' && b.language === 'th' && a.word !== b.word && withoutRepeat(a.word) === withoutRepeat(b.word);
}

function link(map: Map<string, string[]>, a: string, b: string) {
  if (a === b) return;
  for (const [x, y] of [[a, b], [b, a]]) {
    const list = map.get(x) ?? map.set(x, []).get(x)!;
    if (!list.includes(y)) list.push(y);
  }
}

/**
 * The words that can be asked, from the notes being studied (`studied`: note ids with a card past
 * new) and the pairs linked by hand.
 */
export function mixupSet(notes: Iterable<Note>, studied: ReadonlySet<string>, linked: readonly ConfusedPair[] = []): MixupSet {
  const words = new Map<string, MixupWord>();
  const kept: Note[] = [];
  for (const n of notes) {
    if (!isOmnilanguage(n) || !studied.has(n.id)) continue;
    const language = mixupLanguage(n);
    const word = headword(n);
    const meaning = text(n.fields.Meaning);
    if (!language || !word || !meaning) continue;
    const roman = text(n.fields.KanaReading) || text(n.fields.Transliteration) || undefined;
    const partOfSpeech = text(n.fields.PartOfSpeech) || undefined;
    words.set(n.id, { noteId: n.id, language, word, meaning, ...(roman ? { roman } : {}), ...(partOfSpeech ? { partOfSpeech } : {}) });
    kept.push(n);
  }
  const meaning = new Map<string, string[]>();
  const meanings = new Map([...words.values()].map((w) => [w.noteId, meaningSet(w.meaning)]));
  for (const [id, others] of lookalikeIndex(kept)) {
    for (const other of others) {
      // Two words with the same meaning would both be right: those are synonyms, which Review tells apart on the card.
      // The same goes for a word and its ๆ form, whose glosses are worded differently ("real; true", "really").
      const a = words.get(id)!;
      const b = words.get(other);
      if (b && !sameMeaning(meanings.get(id)!, meanings.get(other)!) && !isRepeatForm(a, b)) link(meaning, id, other);
    }
  }
  // Japanese words a kanji apart (劇団 and 劇場) are easy to misread for each other.
  const byLength = new Map<string, MixupWord[]>();
  for (const w of words.values()) {
    if (w.language !== 'ja') continue;
    const key = String(Array.from(w.word).length);
    (byLength.get(key) ?? byLength.set(key, []).get(key)!).push(w);
  }
  for (const group of byLength.values()) {
    for (const a of group) {
      for (const b of group) {
        if (a.noteId < b.noteId && kanjiNeighbors(a.word, b.word) && !sameMeaning(meanings.get(a.noteId)!, meanings.get(b.noteId)!)) link(meaning, a.noteId, b.noteId);
      }
    }
  }
  const ear = new Map<string, string[]>();
  const bySound = new Map<string, MixupWord[]>();
  for (const w of words.values()) {
    const key = soundKey(w);
    if (key) (bySound.get(`${w.language}|${key}`) ?? bySound.set(`${w.language}|${key}`, []).get(`${w.language}|${key}`)!).push(w);
  }
  for (const group of bySound.values()) {
    for (const a of group) {
      for (const b of group) {
        // The same word twice (two notes for one word) can't be told apart by ear or by anything.
        if (a.noteId < b.noteId && a.word !== b.word && !sameMeaning(meanings.get(a.noteId)!, meanings.get(b.noteId)!)) link(ear, a.noteId, b.noteId);
      }
    }
  }
  // A linked pair is asked whatever the words look or sound like, but two with the same meaning would both be right.
  const pairs = new Map<string, string[]>();
  for (const [id, partners] of partnerIndex(linked)) {
    const a = words.get(id);
    if (!a) continue;
    for (const other of partners) {
      const b = words.get(other);
      if (b && a.word !== b.word && !sameMeaning(meanings.get(id)!, meanings.get(other)!) && !isRepeatForm(a, b)) link(pairs, id, other);
    }
  }
  return { words, meaning, pairs, ear };
}

/** Why a word is offered as the one a card was mixed up with. */
export type CandidateWhy = 'sounds close' | 'looks close';

export interface LinkCandidate {
  word: MixupWord;
  why: CandidateWhy;
}

/** The most words the link sheet suggests before the learner searches. */
export const LINK_CANDIDATES = 5;

/**
 * The words a card is likely mixed up with, for the link sheet: its sound-alikes, then its
 * lookalikes (the same links as By ear and By meaning), leaving out words already linked to it.
 */
export function linkCandidates(set: MixupSet, noteId: string, linked: ReadonlySet<string>, limit = LINK_CANDIDATES): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  const seen = new Set<string>([noteId, ...linked]);
  for (const [why, map] of [['sounds close', set.ear], ['looks close', set.meaning]] as const) {
    for (const id of map.get(noteId) ?? []) {
      const word = set.words.get(id);
      if (!word || seen.has(id)) continue;
      seen.add(id);
      out.push({ word, why });
    }
  }
  return out.slice(0, limit);
}

// Each word as search reads it (spelling, romanization, meaning), worked out once per word object.
const searchPlaces = new WeakMap<MixupWord, SearchPlace[]>();
function searchPlacesOf(w: MixupWord): SearchPlace[] {
  let places = searchPlaces.get(w);
  if (!places) searchPlaces.set(w, places = [w.word, w.roman ?? '', w.meaning].map(searchPlace));
  return places;
}

/**
 * The words in `language` whose spelling, romanization or meaning contain every word of `query`,
 * case and accents aside, for the link sheet's search, closest first (`searchRank`: the spelling
 * before the romanization before the meaning, a whole match before part of one) and then by
 * spelling, up to `limit`; the note itself and `linked` ones are left out.
 */
export function searchWords(set: MixupSet, language: Language, query: string, noteId: string, linked: ReadonlySet<string>, limit = 8): MixupWord[] {
  const search = searchQuery(query);
  if (!search.words.length) return [];
  const found: { w: MixupWord; rank: number }[] = [];
  for (const w of set.words.values()) {
    if (w.language !== language || w.noteId === noteId || linked.has(w.noteId)) continue;
    const rank = searchRank(searchPlacesOf(w), search);
    if (rank !== undefined) found.push({ w, rank });
  }
  return found.sort((a, b) => a.rank - b.rank || a.w.word.localeCompare(b.w.word)).slice(0, limit).map((f) => f.w);
}

export interface MixupQuestion {
  mode: MixupMode;
  target: MixupWord;
  /** The target and up to three of its partners, in a random order. */
  choices: MixupWord[];
}

/** A random number in [0, 1), injected so tests can pin it. */
export type Random = () => number;

function shuffled<T>(items: T[], rnd: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The words in `language` that can be asked in `mode`. */
export function askable(set: MixupSet, mode: MixupMode, language: Language): string[] {
  return [...set[mode].keys()].filter((id) => set.words.get(id)?.language === language);
}

/** The question for one word: it and up to three of its partners. Undefined when it has none. */
export function mixupQuestion(set: MixupSet, mode: MixupMode, noteId: string, rnd: Random): MixupQuestion | undefined {
  const target = set.words.get(noteId);
  const partners = (set[mode].get(noteId) ?? []).map((id) => set.words.get(id)!).filter(Boolean);
  if (!target || !partners.length) return undefined;
  return { mode, target, choices: shuffled([target, ...shuffled(partners, rnd).slice(0, 3)], rnd) };
}

/**
 * The next word to ask: the first of `focus` (words just missed in Review) not asked yet, else a
 * random askable word other than the ones in `recent`. Undefined when the language has none.
 */
export function nextMixup(set: MixupSet, mode: MixupMode, language: Language, focus: readonly string[], asked: readonly string[], rnd: Random): string | undefined {
  const pool = askable(set, mode, language);
  const owed = focus.find((id) => pool.includes(id) && !asked.includes(id));
  if (owed) return owed;
  const recent = new Set(asked.slice(-Math.min(asked.length, Math.floor(pool.length / 2))));
  const fresh = pool.filter((id) => !recent.has(id));
  const from = fresh.length ? fresh : pool;
  return from.length ? from[Math.floor(rnd() * from.length)] : undefined;
}

/** Miss reasons (src/core/misses.ts) that are about how a word sounds, practiced by ear. */
const EAR_REASONS = new Set(['tone', 'vowel-length', 'stress']);
/** Miss reasons practiced by meaning. Gender and endings are a word's forms, which Forms practice has. */
const MEANING_REASONS = new Set(['meaning', 'spelling', 'similar-letter']);

export interface MissedPractice {
  mode: MixupMode;
  language: Language;
  /** The words missed for this kind of reason that have something to be told apart from, in the order missed. */
  noteIds: string[];
  /** The reason they share, when every one was missed for the same one (for "missed on tone"). */
  reason?: string;
}

/**
 * What a study session's misses offer to practice: those missed on how a word sounds, by ear, and
 * those missed on its meaning or spelling (or with no reason given), by meaning. Only words with
 * something to tell them apart from count. Each note once, with the reason from its latest miss;
 * one practice for each language the words are in.
 */
export function practiceFromMisses(misses: readonly { noteId: string; miss?: string }[], set: MixupSet): MissedPractice[] {
  const latest = new Map<string, string | undefined>();
  for (const m of misses) { latest.delete(m.noteId); latest.set(m.noteId, m.miss); }
  const out: MissedPractice[] = [];
  for (const mode of ['ear', 'meaning', 'pairs'] as const) {
    // A word missed as mixed up with another is practiced with the pairs it was linked in, not by look or sound.
    const fits = (miss: string | undefined) => (
      mode === 'ear' ? !!miss && EAR_REASONS.has(miss)
        : mode === 'pairs' ? miss === CONFUSED_REASON
          : !miss || MEANING_REASONS.has(miss)
    );
    const byLanguage = new Map<Language, string[]>();
    for (const [id, miss] of latest) {
      const language = set.words.get(id)?.language;
      if (language && fits(miss) && set[mode].has(id)) (byLanguage.get(language) ?? byLanguage.set(language, []).get(language)!).push(id);
    }
    for (const [language, ids] of byLanguage) {
      const reasons = new Set(ids.map((id) => latest.get(id)));
      // "Missed on mixed up with another word" doesn't read, so the pairs' practice names no reason.
      const reason = mode !== 'pairs' && reasons.size === 1 ? [...reasons][0] : undefined;
      out.push({ mode, language, noteIds: ids, ...(reason ? { reason } : {}) });
    }
  }
  return out;
}

/** The button that opens a session's misses in this tool: "Practice the 3 missed on tone". `reasonLabel` is the shared reason's menu label. */
export function missedPracticeLabel(p: MissedPractice, reasonLabel: string | undefined): string {
  const n = p.noteIds.length;
  const which = n === 1 ? 'the one' : `the ${n}`;
  if (p.reason && reasonLabel) return `Practice ${which} missed on ${reasonLabel.toLowerCase()}`;
  return p.mode === 'ear' ? `Practice ${which} missed, by ear` : p.mode === 'pairs' ? `Practice ${which} missed, with your pairs` : `Practice ${which} missed, by meaning`;
}
