// One reading of one text: what was looked up, what was marked unknown, and how long it took.
// Pure, so it's tested; the reader screen holds one of these in state.
import type { ReaderText, ReadingLog } from './api';

export type Session = {
  textId: number;
  startedAt: number;
  glossed: string[];
  flagged: string[];
  quizRight: string[]; // words answered right in the meaning quiz
  quizWrong: string[]; // words answered wrong, or given up on
  audioSpeed: number | null; // the speed audio last played at, if it played at all
  listenOnly: boolean; // listened to with the text hidden
};

export function startSession(text: ReaderText, now: number): Session {
  return { textId: text.id, startedAt: now, glossed: [], flagged: [], quizRight: [], quizWrong: [], audioSpeed: null, listenOnly: false };
}

export function lookUp(session: Session, word: string): Session {
  return session.glossed.includes(word) ? session : { ...session, glossed: [...session.glossed, word] };
}

/** A quiz answer on a word: the latest answer for a word is the one kept. A record only, never a lookup or a grade. */
export function answerQuiz(session: Session, word: string, right: boolean): Session {
  const without = (list: string[]) => list.filter((w) => w !== word);
  return right
    ? { ...session, quizRight: [...without(session.quizRight), word], quizWrong: without(session.quizWrong) }
    : { ...session, quizWrong: [...without(session.quizWrong), word], quizRight: without(session.quizRight) };
}

export function toggleFlag(session: Session, word: string): Session {
  const flagged = session.flagged.includes(word)
    ? session.flagged.filter((w) => w !== word)
    : [...session.flagged, word];
  return { ...session, flagged };
}

export function heard(session: Session, speed: number): Session {
  return session.audioSpeed === speed ? session : { ...session, audioSpeed: speed };
}

export function listenedOnly(session: Session): Session {
  return session.listenOnly ? session : { ...session, listenOnly: true };
}

export function isFlagged(session: Session, word: string): boolean {
  return session.flagged.includes(word);
}

export function toLog(
  session: Session,
  now: number,
  finished: boolean,
  check: { right: number; asked: number } | null = null,
): ReadingLog {
  return {
    ...(check && check.asked > 0 ? { check_right: check.right, check_asked: check.asked } : {}),
    ...(session.quizRight.length > 0 ? { quiz_right: session.quizRight } : {}),
    ...(session.quizWrong.length > 0 ? { quiz_wrong: session.quizWrong } : {}),
    finished,
    words_glossed: session.glossed,
    words_flagged: session.flagged,
    audio_speed: session.audioSpeed,
    listen_only: session.listenOnly,
    seconds: Math.max(0, Math.round((now - session.startedAt) / 1000)),
  };
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
