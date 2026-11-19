// Stories in words (docs/read-and-listen/architecture.md, Stories): the Stories list and a story's
// page. Several stories run at once, one pinned to the top of Read & Listen. Pure, so it's tested.
import type { PastText, StoryListItem, TextStage } from './api';
import type { EpisodeOrder } from './prefs';
import { currentStep, textSteps } from './making';
import { episodeLabel } from './shelf';

/** The episode a story's row is about: the one waiting, else the next to be written. */
function nextEpisode(story: StoryListItem): number {
  return story.next ? story.next.episode : story.read + 1;
}

/** A row's second line: where a running story is ("Season 1 · Episode 2 of 8"), or how much of an ended one was read. */
export function storyPlace(story: StoryListItem): string {
  if (!story.running) return story.read === 1 ? '1 episode read' : `${story.read} episodes read`;
  const episode = episodeLabel(story, nextEpisode(story));
  return story.season ? `Season ${story.season} · ${episode}` : episode;
}

/** A running story's third line: whether its next episode is ready to read. Null for an ended one. */
export function storyNext(story: StoryListItem): { text: string; ready: boolean } | null {
  if (!story.running) return null;
  const n = nextEpisode(story);
  if (story.next) return { text: `Episode ${n} is ready`, ready: true };
  if (story.writing) return { text: `Writing episode ${n}`, ready: false };
  if (story.failed) return { text: `Couldn't write episode ${n}. The server tries again in half an hour.`, ready: false };
  return { text: `Pull down to check for episode ${n}`, ready: false };
}


/** A running story's row while its next episode is written: "Writing episode 3: adding the translations". Null otherwise. */
export function storyWriting(story: StoryListItem): string | null {
  if (!story.running || story.next || !story.writing) return null;
  const step = currentStep(textSteps(story.stage));
  return `Writing episode ${nextEpisode(story)}: ${step.charAt(0).toLowerCase()}${step.slice(1)}`;
}

export type EpisodeSection = { season: number; rows: EpisodeRow[] };

export type EpisodeRow =
  | { kind: 'read'; episode: number; title: string; text: PastText }
  | { kind: 'next'; episode: number; title: string; textId: number | null; status: string; ready: boolean; stage: TextStage | null };

/**
 * A story's page lists its episodes by season: the ones read (from Past texts, first to last), then
 * the next one, ready, being written, or not yet asked for. A season's length comes from the
 * server; one older than seasons sends none, and every episode is in one list (season 0).
 */
export function episodeSections(story: StoryListItem, read: PastText[]): EpisodeSection[] {
  const length = story.season_length ?? 0;
  const seasonOf = (episode: number) => (length > 0 ? Math.ceil(episode / length) : 0);
  const rows: EpisodeRow[] = read
    .filter((t) => (t.episode ?? 0) > 0)
    .map((t) => ({ kind: 'read', episode: t.episode!, title: t.title, text: t }));
  const next = storyNext(story);
  if (next) {
    const episode = story.next ? story.next.episode : story.read + 1;
    rows.push({ kind: 'next', episode, title: story.next?.title ?? `Episode ${episode}`, textId: story.next?.id ?? null, status: next.text, ready: next.ready, stage: story.writing ? story.stage ?? null : null });
  }
  const sections: EpisodeSection[] = [];
  for (const row of rows) {
    const season = seasonOf(row.episode);
    const last = sections[sections.length - 1];
    if (last && last.season === season) last.rows.push(row);
    else sections.push({ season, rows: [row] });
  }
  return sections;
}

/** The sections in the order chosen: `episodeSections` gives first to last, and newest first turns the seasons and the episodes in each around. */
export function orderSections(sections: EpisodeSection[], order: EpisodeOrder): EpisodeSection[] {
  if (order === 'oldest') return sections;
  return [...sections].reverse().map((s) => ({ ...s, rows: [...s.rows].reverse() }));
}

/** Seasons fold only when there are several; one season, or a server older than seasons (season 0), is shown as it always was. */
export function seasonsFold(sections: EpisodeSection[]): boolean {
  return sections.length > 1 && sections.every((s) => s.season > 0);
}

/** Whether a season is open: as the reader left it, else open for the latest season and closed for the ones before it. */
export function seasonOpen(sections: EpisodeSection[], season: number, chosen: Record<number, boolean>): boolean {
  return chosen[season] ?? season === Math.max(...sections.map((s) => s.season));
}

/** A season's header line: how many episodes, or how many are read while it's still going. */
export function seasonSummary(section: EpisodeSection): string {
  const read = section.rows.filter((r) => r.kind === 'read').length;
  if (read < section.rows.length) return `${read} of ${section.rows.length} read`;
  return read === 1 ? '1 episode read' : `${read} episodes read`;
}

/** The seasons the reader opened or closed on a story, as kept on the phone; anything unreadable is no choice. */
export function parseSeasonChoices(raw: string | null): Record<number, boolean> {
  const chosen: Record<number, boolean> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'boolean' && Number.isInteger(Number(k))) chosen[Number(k)] = v;
    }
  } catch {
    // Not JSON: no choices.
  }
  return chosen;
}
