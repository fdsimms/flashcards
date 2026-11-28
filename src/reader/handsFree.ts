// Hands-free Situations (docs/read-and-listen/architecture.md, Situations, "Hands-free"): their line plays, the
// microphone opens by itself, a pause ends the owner's line, which is sent after a short wait in which a tap
// fixes it, and their reply plays. What the loop decides, pure so it's tested; src/ui/tools/useHandsFree.ts
// runs it. Nothing here grades a card.

/** How long a heard line waits before it's sent, for a tap to fix a misheard word first. */
export const REVIEW_MS = 2000;
/** Times in a row the microphone may open and hear nothing before the loop pauses itself. */
export const MAX_SILENT = 2;
/** How long to wait for their line to start sounding before opening the microphone anyway (a voice that failed). */
export const SOUND_START_MS = 4000;
/** A beat between their line ending and the microphone opening, so its tone isn't heard over the line's end. */
export const LISTEN_DELAY_MS = 300;

export type HandsFreeStep =
  /** Their line is coming or being played. */
  | 'theirs'
  /** The microphone is open. */
  | 'listening'
  /** A line was heard and waits `REVIEW_MS` before it's sent. */
  | 'review'
  /** Sent; their reply is being written. */
  | 'waiting'
  /** Stopped until Resume: paused by a tap, by silence, by a fix, or by the app leaving the screen. */
  | 'paused';

export type PauseReason = 'tapped' | 'silent' | 'fixing' | 'away';

export interface HandsFree {
  step: HandsFreeStep;
  /** The line so far: what's been heard, with any [English] word put in. */
  line: string;
  /** What was heard before the English word, kept while the microphone is opened again for the rest. */
  committed: string;
  silent: number;
  paused?: PauseReason;
}

export const START: HandsFree = { step: 'theirs', line: '', committed: '', silent: 0 };

/** Their line has played (or never started): the microphone opens, the line starts empty. */
export const listen = (s: HandsFree): HandsFree => ({ ...s, step: 'listening', line: s.committed, paused: undefined });

/** Joins what was heard to what came before it, with one space. */
export function joinLine(before: string, heard: string): string {
  return [before.trim(), heard.trim()].filter(Boolean).join(' ');
}

/** What the microphone has heard so far, as the line shows it. */
export const hearing = (s: HandsFree, heard: string): HandsFree => ({ ...s, line: joinLine(s.committed, heard) });

/**
 * The microphone closed (a pause ended the line): a line with anything in it goes to review, to be sent; an
 * empty one opens the microphone again, until `MAX_SILENT` in a row, when the loop pauses itself.
 */
export function heardAll(s: HandsFree, heard: string): HandsFree {
  const line = joinLine(s.committed, heard);
  if (line) return { ...s, step: 'review', line, committed: '', silent: 0 };
  const silent = s.silent + 1;
  return silent >= MAX_SILENT ? { ...s, step: 'paused', paused: 'silent', silent: 0, line: '' } : { ...s, step: 'listening', silent, line: '' };
}

/** An English word said while holding Say it in English: put in [brackets], and the microphone opens again for the rest. */
export function withEnglish(s: HandsFree, english: string): HandsFree {
  const word = english.trim();
  if (!word) return { ...s, step: 'listening' };
  const committed = joinLine(s.line, `[${word}]`);
  return { ...s, step: 'listening', committed, line: committed };
}

/** The review's wait ran out: the line is sent, and their reply awaited. */
export const sent = (s: HandsFree): HandsFree => ({ ...s, step: 'waiting', line: '', committed: '' });

/** Their reply came: it plays, then the microphone opens. */
export const replied = (s: HandsFree): HandsFree => (s.step === 'paused' ? s : { ...s, step: 'theirs' });

export const pause = (s: HandsFree, reason: PauseReason): HandsFree => ({ ...s, step: 'paused', paused: reason });

/** What the status under the conversation says. */
export function handsFreeStatus(s: HandsFree, name: string): string {
  switch (s.step) {
    case 'theirs': return `${name} is speaking`;
    case 'listening': return "Your turn. A pause sends it.";
    case 'review': return 'Sending. Tap your line to fix it.';
    case 'waiting': return `${name} is answering`;
    case 'paused':
      return s.paused === 'silent' ? "Paused: nothing was heard. Tap Resume when you're ready."
        : s.paused === 'away' ? 'Paused while Franki was in the background.'
        : s.paused === 'fixing' ? 'Fix your line, then send it.'
        : 'Paused.';
  }
}
