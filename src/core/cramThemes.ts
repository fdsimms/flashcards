import type { CramTheme as ApiTheme, CramThemesRequest, Language } from '../reader/api';
import { lessonPhraseOf, lastMissed, noteAddedAt, type Cram, type CramTalk } from './cram';
import { noteHasTag } from './priority';
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
/** A note added in this many days counts as lately added. */
export const FRESH_DAYS = 14;
/** A note tagged as a leech counts as missed too. */
export const LEECH_TAG = 'leech';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ThemeKind = 'carried' | 'missed' | 'fresh' | 'deck';

export interface ThemeWord {
  noteId: string;
  text: string;
  english: string;
  kind: ThemeKind;
}

/**
 * The words themes are built from, at most `THEME_WORDS_MAX`: the unused words of the last finished
 * cram, then the ones missed in the latest cram's last round or tagged leech, then those added in the
 * last `FRESH_DAYS`, then other studied words, newest first within each. Only notes in `language` that
 * an audio lesson could take (`lessonPhraseOf`), and studied (a card that isn't New) unless they were
 * left over from the last cram.
 */
export function themeWords(input: { notes: Note[]; cards: Iterable<Card>; language: Language; crams: Cram[]; now: Date }): ThemeWord[] {
  const { notes, language, crams, now } = input;
  const studied = new Set<string>();
  for (const c of input.cards) if (c.sched.state !== 0) studied.add(c.noteId);

  const lastFinished = crams.filter((c) => c.finishedAt).sort((a, b) => (a.finishedAt! < b.finishedAt! ? 1 : -1))[0];
  const carried = new Set(lastFinished?.unused ?? []);
  const withRounds = crams.filter((c) => c.rounds.length).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const missed = withRounds ? lastMissed(withRounds) : new Set<string>();
  const since = now.getTime() - FRESH_DAYS * DAY_MS;

  const kindOf = (n: Note): ThemeKind => {
    if (carried.has(n.id)) return 'carried';
    if (missed.has(n.id) || noteHasTag(n, LEECH_TAG)) return 'missed';
    const added = noteAddedAt(n);
    return added > 0 && added >= since ? 'fresh' : 'deck';
  };
  const rank: Record<ThemeKind, number> = { carried: 0, missed: 1, fresh: 2, deck: 3 };

  const words: (ThemeWord & { added: number })[] = [];
  for (const n of notes) {
    const phrase = lessonPhraseOf(n, language);
    if (!phrase || (!studied.has(n.id) && !carried.has(n.id))) continue;
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

/** The titles not to suggest again: those already on screen, then every cram's name and theme, newest first. */
export function themesToAvoid(crams: Cram[], shown: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (title: string | undefined) => {
    const t = (title ?? '').replace(/\s+/g, ' ').trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  };
  shown.forEach(add);
  for (const c of [...crams].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) { add(c.theme?.title); add(c.name); }
  return out.slice(0, THEME_AVOID_MAX);
}

/** The request for the server's themes. */
export function themesRequest(language: Language, words: ThemeWord[], weak: string[], avoid: string[], stretch: boolean): CramThemesRequest {
  return {
    language,
    words: words.map((w) => ({ id: w.noteId, text: w.text, english: w.english, kind: w.kind })),
    weak_spots: weak,
    avoid,
    stretch,
  };
}

/** How many of a theme's words are of each kind, and how many words it offers to learn, for its chips. */
export function themeCounts(theme: ApiTheme, words: ThemeWord[]): Record<ThemeKind | 'new', number> {
  const kinds = new Map(words.map((w) => [w.noteId, w.kind]));
  const counts: Record<ThemeKind | 'new', number> = { carried: 0, missed: 0, fresh: 0, deck: 0, new: theme.new_words.length };
  for (const id of theme.word_ids) {
    const kind = kinds.get(id);
    if (kind) counts[kind]++;
  }
  return counts;
}

/** The theme's words as the words sent, in the theme's order, leaving out any the server named that aren't here. */
export function themeDeckWords(theme: ApiTheme, words: ThemeWord[]): ThemeWord[] {
  const byId = new Map(words.map((w) => [w.noteId, w]));
  return theme.word_ids.flatMap((id) => byId.get(id) ?? []);
}

/** What a cram keeps of its theme: the questions and the story, for the lesson itself. */
export function talkOf(theme: ApiTheme): CramTalk {
  return {
    title: theme.title,
    questions: theme.questions.map((q) => ({ text: q.text, english: q.english })),
    ...(theme.story ? { story: { text: theme.story.text, english: theme.story.english } } : {}),
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
