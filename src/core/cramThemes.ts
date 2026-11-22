import type { CramTheme as ApiTheme, CramThemesRequest, Language } from '../reader/api';
import type { Particle } from '../reader/lessons';
import { registerChoice, type RegisterLevel } from '../reader/registerLevel';
import { cramNotes, lessonPhraseOf, lastMissed, noteAddedAt, type Cram, type CramTalk } from './cram';
import { headword } from './forms';
import { readerLanguageOf } from './leechHint';
import { isLiveLeech } from './leechRecovery';
import type { Card, Note } from './types';
import { weightOf, type Marks, type Tally } from '../tools/marks';

/**
 * Themes to talk about at a lesson (Practice, Cram): the words the server's Claude builds them from
 * (the ones not used at the last lesson, missed in rounds, added lately, then others studied), what
 * Practice has been missing, and the titles to avoid. Pure, so it's tested; the server
 * (server/reader's cram_themes.py) writes the themes and checks every word it names is one of these
 * or a common word the deck lacks. Nothing here schedules or writes a card: a word to learn is added
 * through the note queue, where saving a note is the approval (CLAUDE.md, Read & Listen).
 */

/** The server's `cram_themes.MAX_POOL`, `MAX_AVOID`, `MAX_WEAK` and `MAX_WEAK_CHARS`: more would be refused. */
export const THEME_WORDS_MAX = 60;
export const THEME_AVOID_MAX = 30;
export const THEME_WEAK_MAX = 8;
export const THEME_WEAK_CHARS = 120;
/** The server's `MAX_TITLE * 2`: the longest topic it takes. */
export const THEME_TOPIC_CHARS = 120;
/** A note added in this many days counts as lately added. */
export const FRESH_DAYS = 14;
/** The server's `MAX_FACTS`: the longest note on what really happened. */
export const THEME_FACTS_CHARS = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ThemeKind = 'cram' | 'carried' | 'missed' | 'fresh' | 'deck';

export interface ThemeWord {
  noteId: string;
  text: string;
  english: string;
  kind: ThemeKind;
}

/**
 * The words themes are built from, at most `THEME_WORDS_MAX`: the words already in the cram the
 * themes are for, then the unused words of the last finished cram, then the ones missed in the latest
 * cram's last round or still leeches (`isLiveLeech`), then those added in the last `FRESH_DAYS`, then
 * other studied words, newest first within each. Only notes in `language` that an audio lesson could
 * take (`lessonPhraseOf`), and studied (a card that isn't New) unless they are in the cram or were left
 * over from the last one: those are the words the learner is about to learn. The server adds every
 * other studied word itself, so a theme can reach the ones that fit its topic.
 */
export function themeWords(input: { notes: Note[]; cards: Iterable<Card>; language: Language; crams: Cram[]; now: Date; cram?: Cram }): ThemeWord[] {
  const { notes, language, crams, now } = input;
  const inCram = new Set(input.cram ? cramNotes(input.cram, notes).map((n) => n.id) : []);
  const studied = new Set<string>();
  const cardsOfNote = new Map<string, Card[]>();
  for (const c of input.cards) {
    if (c.sched.state !== 0) studied.add(c.noteId);
    (cardsOfNote.get(c.noteId) ?? cardsOfNote.set(c.noteId, []).get(c.noteId)!).push(c);
  }

  const lastFinished = crams.filter((c) => c.finishedAt).sort((a, b) => (a.finishedAt! < b.finishedAt! ? 1 : -1))[0];
  const carried = new Set(lastFinished?.unused ?? []);
  const withRounds = crams.filter((c) => c.rounds.length).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const missed = withRounds ? lastMissed(withRounds) : new Set<string>();
  const since = now.getTime() - FRESH_DAYS * DAY_MS;

  const kindOf = (n: Note): ThemeKind => {
    if (inCram.has(n.id)) return 'cram';
    if (carried.has(n.id)) return 'carried';
    if (missed.has(n.id) || isLiveLeech(n, cardsOfNote.get(n.id) ?? [])) return 'missed';
    const added = noteAddedAt(n);
    return added > 0 && added >= since ? 'fresh' : 'deck';
  };
  const rank: Record<ThemeKind, number> = { cram: 0, carried: 1, missed: 2, fresh: 3, deck: 4 };

  const words: (ThemeWord & { added: number })[] = [];
  for (const n of notes) {
    const phrase = lessonPhraseOf(n, language);
    if (!phrase || (!studied.has(n.id) && !carried.has(n.id) && !inCram.has(n.id))) continue;
    words.push({ noteId: n.id, text: phrase.text, english: phrase.english, kind: kindOf(n), added: noteAddedAt(n) });
  }
  words.sort((a, b) => rank[a.kind] - rank[b.kind] || b.added - a.added);
  return words.slice(0, THEME_WORDS_MAX).map(({ noteId, text, english, kind }) => ({ noteId, text, english, kind }));
}

/**
 * What Practice has been missing in `language`, as lines for the server ("Telling the time: band:thum,
 * minutes:to"), the tools with the most live misses first. `titleOf` gives a tool's title from its id.
 */
export function weakSpots(marks: Marks, language: Language, now: number, titleOf: (toolId: string) => string | undefined): string[] {
  const suffix = `:${language}`;
  const lines: { line: string; misses: number }[] = [];
  for (const [list, tallies] of Object.entries(marks)) {
    if (!list.endsWith(suffix)) continue;
    const title = titleOf(list.slice(0, -suffix.length));
    if (!title) continue;
    const live = Object.entries(tallies).filter(([pattern]) => weightOf(tallies, [pattern], now) > 1).sort((a, b) => b[1].misses - a[1].misses);
    if (!live.length) continue;
    const misses = live.reduce((sum, [, t]: [string, Tally]) => sum + t.misses, 0);
    lines.push({ line: `${title}: ${live.slice(0, 3).map(([p]) => p).join(', ')}`.slice(0, THEME_WEAK_CHARS), misses });
  }
  return lines.sort((a, b) => b.misses - a.misses).slice(0, THEME_WEAK_MAX).map((l) => l.line);
}

/** What Practice has been missing and the corrections kept from rehearsals, as one list within what the server takes: Practice's first, up to half, then the kept ones. */
export function combineWeakSpots(practice: string[], kept: string[]): string[] {
  const first = practice.slice(0, THEME_WEAK_MAX / 2);
  return [...first, ...kept.slice(0, THEME_WEAK_MAX - first.length)];
}

/** The titles not to suggest again: those already on screen, then every cram's name and themes, newest first. */
export function themesToAvoid(crams: Cram[], shown: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (title: string | undefined) => {
    const t = (title ?? '').replace(/\s+/g, ' ').trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  };
  shown.forEach(add);
  for (const c of [...crams].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) { for (const t of c.themes ?? []) add(t.title); add(c.name); }
  return out.slice(0, THEME_AVOID_MAX);
}

/**
 * The request for the server's themes. `topic` is what the lesson is for (the cram's name): every
 * theme is an angle on it. `facts` is what really happened, in the learner's words (`Cram.facts`).
 */
export function themesRequest(language: Language, words: ThemeWord[], weak: string[], avoid: string[], stretch: boolean, topic: string, register?: RegisterLevel, particle?: Particle, facts = ''): CramThemesRequest {
  const note = facts.replace(/\s+/g, ' ').trim().slice(0, THEME_FACTS_CHARS);
  return {
    language,
    words: words.map((w) => ({ id: w.noteId, text: w.text, english: w.english, kind: w.kind })),
    weak_spots: weak,
    avoid,
    stretch,
    topic: topic.replace(/\s+/g, ' ').trim().slice(0, THEME_TOPIC_CHARS),
    facts: note,
    ...registerChoice(register),
    // Thai only: the story is the learner's own words, so the server writes it for their gender.
    ...(language === 'th' && particle ? { particle } : {}),
  };
}

/** How many of a theme's words (`themeDeckWords`) are of each kind, and how many words it offers to learn, for its chips. */
export function themeCounts(theme: ApiTheme, words: ThemeWord[]): Record<ThemeKind | 'new', number> {
  const counts: Record<ThemeKind | 'new', number> = { cram: 0, carried: 0, missed: 0, fresh: 0, deck: 0, new: theme.new_words.length };
  for (const w of words) counts[w.kind]++;
  return counts;
}

/** A word's text as compared: one form of Unicode, spaces collapsed, ignoring case. */
const wordKey = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The theme's words: the ones sent, in the theme's order (leaving out any the server named that
 * aren't here), then the other studied words it named from the whole deck, found by their word among
 * the notes in `language` (`deck`; one with no note to match is left out, since it can't be tagged).
 */
export function themeDeckWords(theme: ApiTheme, words: ThemeWord[], notes: Note[] = [], language?: Language): ThemeWord[] {
  const byId = new Map(words.map((w) => [w.noteId, w]));
  const sent = theme.word_ids.flatMap((id) => byId.get(id) ?? []);
  const named = theme.deck_words ?? [];
  if (!named.length || !language) return sent;
  const have = new Set(sent.map((w) => w.noteId));
  const byWord = new Map<string, Note>();
  for (const n of notes) {
    if (readerLanguageOf(n) !== language) continue;
    const key = wordKey(headword(n));
    if (key && !byWord.has(key)) byWord.set(key, n);
  }
  const found: ThemeWord[] = [];
  for (const w of named) {
    const note = byWord.get(wordKey(w.word));
    const phrase = note ? lessonPhraseOf(note, language) : undefined;
    if (!note || !phrase || have.has(note.id)) continue;
    have.add(note.id);
    found.push({ noteId: note.id, text: phrase.text, english: phrase.english, kind: 'deck' });
  }
  return [...sent, ...found];
}

/** What a cram keeps of its theme for the lesson itself: the questions of both kinds, the story and the words it marked as unknown. */
export function talkOf(theme: ApiTheme): CramTalk {
  const line = (l: { text: string; english: string }) => ({ text: l.text, english: l.english });
  const expects = theme.expects ?? [];
  const unknown = theme.unknown ?? [];
  return {
    title: theme.title,
    questions: theme.questions.map(line),
    ...(expects.length ? { expects: expects.map((e) => ({ question: line(e.question), answer: line(e.answer) })) } : {}),
    ...(theme.story ? { story: line(theme.story) } : {}),
    ...(unknown.length ? { unknown: unknown.map((u) => ({ word: u.word, english: u.english })) } : {}),
  };
}

/**
 * A line split into runs, each marked when it's one of `words` (matched ignoring case, the longest
 * first, never overlapping), so a story can show which words are from the deck.
 */
export function markWords(text: string, words: string[]): { text: string; marked: boolean }[] {
  const wanted = [...new Set(words.map((w) => w.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  const spans: [number, number][] = [];
  for (const w of wanted) {
    const needle = w.toLowerCase();
    let from = 0;
    for (let at = lower.indexOf(needle, from); at !== -1; at = lower.indexOf(needle, from)) {
      from = at + needle.length;
      if (!spans.some(([s, e]) => at < e && from > s)) spans.push([at, from]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const runs: { text: string; marked: boolean }[] = [];
  let pos = 0;
  for (const [s, e] of spans) {
    if (s > pos) runs.push({ text: text.slice(pos, s), marked: false });
    runs.push({ text: text.slice(s, e), marked: true });
    pos = e;
  }
  if (pos < text.length) runs.push({ text: text.slice(pos), marked: false });
  return runs;
}

/**
 * `markWords`' runs cut into the pieces a line is laid out from: each marked run whole, and the rest
 * split at spaces (a space is its own `gap` piece), so a language written with spaces still wraps
 * word by word around a marked word. Thai and Japanese have no spaces, so an unmarked run stays one piece.
 */
export function talkPieces(runs: { text: string; marked: boolean }[]): { text: string; marked: boolean; gap?: boolean }[] {
  return runs.flatMap((r) => (r.marked
    ? [r]
    : r.text.split(/( +)/).filter(Boolean).map((t) => (t.trim() ? { text: t, marked: false } : { text: ' ', marked: false, gap: true }))));
}
