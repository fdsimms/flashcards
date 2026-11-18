// An audio lesson's transcript (docs/read-and-listen/architecture.md, Audio lessons): what's said and
// each of the learner's turns, with where they fall in the MP3 (server lesson.script_of). The player
// follows it (what's been heard so far), replays a turn's prompt (Again), plays the learner's take
// after the answer, and notes phrases for a review. A lesson made before transcripts were kept has
// none. Nothing here grades a card: a note for a review is about the lesson. Pure, so it's tested.
import type { AudioLesson } from './api';

export type ScriptSay = { kind: 'say'; voice: 'narrator' | 'native'; text: string; english: string | null; start: number; end: number };
/** A turn of the learner's: `text` is what they're to say, `replay` where its prompt starts (for Again). */
export type ScriptTurn = { kind: 'turn'; text: string; english: string | null; start: number; end: number; replay: number };
export type ScriptEntry = ScriptSay | ScriptTurn;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';

/** A lesson's transcript in order, or null for one made before transcripts were kept. */
export function scriptOf(lesson: Pick<AudioLesson, 'script'>): ScriptEntry[] | null {
  const raw = lesson.script;
  if (!Array.isArray(raw)) return null;
  const out: ScriptEntry[] = [];
  for (const e of raw as unknown[]) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (!str(o.text) || !num(o.start) || !num(o.end) || o.start > o.end) continue;
    const english = str(o.english) ? o.english : null;
    if (o.kind === 'say' && (o.voice === 'narrator' || o.voice === 'native')) {
      out.push({ kind: 'say', voice: o.voice, text: o.text, english, start: o.start, end: o.end });
    } else if (o.kind === 'turn' && num(o.replay)) {
      out.push({ kind: 'turn', text: o.text, english, start: o.start, end: o.end, replay: Math.min(o.replay, o.start) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** What's been heard by `seconds`: every entry that has started. The answer to a turn starts after it, so it stays hidden until it's said. */
export function heardSoFar(entries: readonly ScriptEntry[], seconds: number): ScriptEntry[] {
  const ms = seconds * 1000;
  return entries.filter((e) => e.start <= ms);
}

/** The turn the player is in at `seconds`, if any. */
export function turnAt(entries: readonly ScriptEntry[], seconds: number): ScriptTurn | null {
  const ms = seconds * 1000;
  return entries.find((e): e is ScriptTurn => e.kind === 'turn' && ms >= e.start && ms < e.end) ?? null;
}

/**
 * When the learner's take of `turn` should play: once the native voice has given the answer (the
 * line said right after a question), or as the turn ends when the line was heard before it (a repeat).
 */
export function takeAfter(entries: readonly ScriptEntry[], turn: ScriptTurn): number {
  const next = entries.find((e) => e.start >= turn.end);
  return next && next.kind === 'say' && next.voice === 'native' && next.text === turn.text ? next.end : turn.end;
}

/** Whether the learner took longer than the lesson's own pause to answer: then the phrase is noted for a review. */
export function slowAnswer(turn: Pick<ScriptTurn, 'start' | 'end'>, tookMs: number): boolean {
  return tookMs > turn.end - turn.start;
}

export type MarkReason = 'again' | 'slow';

/** What to note for a review about a turn: its phrase and meaning. A part of a phrase being built up has no meaning of its own, so isn't noted. */
export function markOf(turn: ScriptTurn, reason: MarkReason): { text: string; english: string; reason: MarkReason } | null {
  return turn.english ? { text: turn.text, english: turn.english, reason } : null;
}

/** Who says an entry, as the transcript labels it. */
export function speakerLabel(entry: ScriptEntry): string {
  if (entry.kind === 'turn') return 'You';
  return entry.voice === 'narrator' ? 'Narrator' : 'Voice';
}
