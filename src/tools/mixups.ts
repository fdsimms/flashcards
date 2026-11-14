import { isOmnilanguage, speechLangFor } from '../core/cards';
import { headword } from '../core/forms';
import { htmlToText } from '../core/html';
import { lookalikeIndex } from '../core/lookalikes';
import { meaningSet, sameMeaning } from '../core/synonyms';
import type { Note } from '../core/types';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';

/**
 * Words you mix up: telling apart words from the learner's own decks that are easy to confuse.
 * Two ways to ask:
 * - **By meaning**: a meaning, and the word for it among its lookalikes (esperar, esperanza,
 *   espera), from the same links that keep lookalikes apart in Review (lookalikes.ts).
 * - **By ear**: a word played, and which of its sound-alikes it was: words spelled or romanized
 *   the same once tones and accents are taken off (Thai ใกล้ klâi and ไกล klai, Spanish esta and
 *   está), or written the same in kana (Japanese 橋 and 箸).
 * Only words already being studied are asked or offered as choices: telling apart a word not yet
 * learned tests nothing. Like every tool, it never grades a card (tools.ts).
 */

export const MIXUP_MODES = ['meaning', 'ear'] as const;
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
const unmarked = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFC');

/**
 * What a word sounds like, near enough to be confused by ear: its romanization (or kana) with
 * tones, accents and hyphens taken off, else its spelling the same way. Thai without a
 * romanization has none, as Thai script carries the tone in letters that can't be taken off.
 */
export function soundKey(w: MixupWord): string | undefined {
  const base = w.roman || (w.language === 'th' || w.language === 'ja' ? '' : w.word);
  if (!base) return undefined;
  const key = unmarked(base.toLocaleLowerCase()).replace(/[-‐·'’\s]/g, '');
  return key || undefined;
}

function link(map: Map<string, string[]>, a: string, b: string) {
  if (a === b) return;
  for (const [x, y] of [[a, b], [b, a]]) {
    const list = map.get(x) ?? map.set(x, []).get(x)!;
    if (!list.includes(y)) list.push(y);
  }
}

/** The words that can be asked, from the notes being studied (`studied`: note ids with a card past new). */
export function mixupSet(notes: Iterable<Note>, studied: ReadonlySet<string>): MixupSet {
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
      if (words.has(other) && !sameMeaning(meanings.get(id)!, meanings.get(other)!)) link(meaning, id, other);
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
  return { words, meaning, ear };
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
const MEANING_REASONS = new Set(['meaning', 'spelling']);

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
  for (const mode of ['ear', 'meaning'] as const) {
    const fits = (miss: string | undefined) => (mode === 'ear' ? !!miss && EAR_REASONS.has(miss) : !miss || MEANING_REASONS.has(miss));
    const byLanguage = new Map<Language, string[]>();
    for (const [id, miss] of latest) {
      const language = set.words.get(id)?.language;
      if (language && fits(miss) && set[mode].has(id)) (byLanguage.get(language) ?? byLanguage.set(language, []).get(language)!).push(id);
    }
    for (const [language, ids] of byLanguage) {
      const reasons = new Set(ids.map((id) => latest.get(id)));
      const reason = reasons.size === 1 ? [...reasons][0] : undefined;
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
  return p.mode === 'ear' ? `Practice ${which} missed, by ear` : `Practice ${which} missed, by meaning`;
}
