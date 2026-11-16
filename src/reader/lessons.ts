// Audio lessons (docs/read-and-listen/architecture.md, Audio lessons): what the lessons screen and
// its player say about a lesson, and the arithmetic of the player's skip buttons. A lesson is made
// by the server in the background and played as one MP3; nothing here grades a card or writes a
// note. Pure, so it's tested.
import type { AudioLesson, Language, LessonStage } from './api';

/** The languages the server makes lessons in (server lesson_service.LESSON_LANGUAGES): the shelf offers lessons only in these. */
export const LESSON_LANGUAGES: readonly Language[] = ['fr', 'th', 'es', 'de', 'ru', 'el', 'pl', 'nb'];

/** While a lesson is being made, check back this often. */
export const POLL_MS = 5_000;

/** How far the player's skip buttons move, to replay the phrase that was just missed. */
export const SKIP_SECONDS = 15;

export function lessonsOffered(language: Language): boolean {
  return LESSON_LANGUAGES.includes(language);
}

/** Whether any lesson is still being written or spoken, so the list is asked for again. */
export function anyMaking(lessons: readonly AudioLesson[]): boolean {
  return lessons.some((l) => l.state === 'making');
}

/** "1:26", for a position or a length in seconds. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** The position after skipping `by` seconds (negative goes back), kept inside the lesson. */
export function skipTo(position: number, by: number, duration: number): number {
  const end = duration > 0 ? duration : Infinity;
  return Math.min(end, Math.max(0, position + by));
}

/** Whether the player is at the end, so Play starts the lesson over rather than doing nothing. */
export function atEnd(position: number, duration: number): boolean {
  return duration > 0 && position >= duration - 0.5;
}

/** "Nov 15", from the server's timestamp. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** What a lesson being made goes through, in order, as the list says it. */
export const LESSON_STAGES: readonly { stage: LessonStage; label: string }[] = [
  { stage: 'writing', label: 'Writing the phrases' },
  { stage: 'recording', label: 'Recording the voices' },
  { stage: 'joining', label: 'Joining the audio' },
];

export type StageStep = { label: string; status: 'done' | 'now' | 'todo' };

/** The steps with where the lesson is: those before its stage done, its own now, the rest to come. A missing or unknown stage is the first. */
export function stageSteps(stage: LessonStage | undefined): StageStep[] {
  const at = Math.max(0, LESSON_STAGES.findIndex((s) => s.stage === stage));
  return LESSON_STAGES.map((s, i) => ({ label: s.label, status: i < at ? 'done' : i === at ? 'now' : 'todo' }));
}

/** The line under a lesson's name in the list: how it's going, why it failed, or what it holds. */
export function lessonDetail(lesson: AudioLesson): string {
  if (lesson.state === 'making') return stageSteps(lesson.stage).find((s) => s.status === 'now')!.label + '.';
  if (lesson.state === 'failed') return lesson.error || "Couldn't make this lesson. Try again.";
  const minutes = Math.max(1, Math.round(lesson.duration_ms / 60_000));
  const n = lesson.phrases.length;
  return [`${minutes} min`, `${n} ${n === 1 ? 'phrase' : 'phrases'}`, shortDate(lesson.created_at)].filter(Boolean).join(' · ');
}

/** A narrator voice as kept, or '' (the server's own) for anything that isn't an English Azure voice's name. */
export function parseNarrator(raw: string | null): string {
  return raw !== null && /^en-[A-Za-z]{2,4}-[A-Za-z0-9:]+$/.test(raw.trim()) ? raw.trim() : '';
}
