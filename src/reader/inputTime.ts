// The home's This week card (src/ui/reader/ReadInputTime.tsx): how long each language was read and listened
// to over the last week, so one that is getting very little shows. It reports what happened and sets no goal,
// as the progress card does (progress.ts). Pure, so it's tested; nothing here grades a card.
import type { InputTime, Language } from './api';
import { LANGUAGES } from './languages';

export interface InputRow {
  language: Language;
  name: string;
  /** "48 min", or "Under 1 min" for a few seconds, or "0 min". */
  total: string;
  /** Each part's share of the longest language's total, 0 to 1, so the bars compare across languages. */
  reading: number;
  listening: number;
  /** "Last read 16 days ago", only for a language with no time this week. */
  note: string;
}

const dayMs = 24 * 60 * 60 * 1000;

function minutes(seconds: number): string {
  if (seconds <= 0) return '0 min';
  if (seconds < 60) return 'Under 1 min';
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function lastRead(at: string | null, now: Date): string {
  if (!at) return '';
  const days = Math.floor((now.getTime() - new Date(at).getTime()) / dayMs);
  // Lengths of time, not day words: "yesterday" would need the study day, and this is only how long it has been.
  if (days < 1) return 'Last read less than a day ago';
  return days === 1 ? 'Last read 1 day ago' : `Last read ${days} days ago`;
}

/** The card's rows, in the server's order (most time first). Empty when no language has been read. */
export function inputRows(time: InputTime, now: Date): InputRow[] {
  const most = Math.max(1, ...time.languages.map((l) => l.reading_seconds + l.listening_seconds));
  return time.languages.map((l) => {
    const total = l.reading_seconds + l.listening_seconds;
    return {
      language: l.language,
      name: LANGUAGES[l.language]?.name ?? l.language,
      total: minutes(total),
      reading: l.reading_seconds / most,
      listening: l.listening_seconds / most,
      note: total > 0 ? '' : lastRead(l.last_read_at, now),
    };
  });
}

/** What VoiceOver says for a row: "Thai, 48 min: 25 min reading, 23 min listening". */
export function inputRowLabel(row: InputRow, l: { reading_seconds: number; listening_seconds: number }): string {
  const parts = [l.reading_seconds > 0 ? `${minutes(l.reading_seconds)} reading` : '', l.listening_seconds > 0 ? `${minutes(l.listening_seconds)} listening` : ''].filter(Boolean);
  return [`${row.name}, ${row.total}`, parts.join(', '), row.note].filter(Boolean).join('. ');
}
