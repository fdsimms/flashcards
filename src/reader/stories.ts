// Stories in words (docs/read-and-listen/architecture.md, Stories): the Stories list and a story's
// page. Several stories run at once, one pinned to the top of Read & Listen. Pure, so it's tested.
import type { PastText, StoryListItem } from './api';
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


export type EpisodeRow =
  | { kind: 'read'; episode: number; title: string; text: PastText }
  | { kind: 'next'; episode: number; title: string; textId: number | null; status: string; ready: boolean };

/**
 * A story's page lists its episodes by season: the ones read (from Past texts, first to last), then
 * the next one, ready, being written, or not yet asked for. A season's length comes from the
 * server; one older than seasons sends none, and every episode is in one list (season 0).
 */
export function episodeSections(story: StoryListItem, read: PastText[]): { season: number; rows: EpisodeRow[] }[] {
  const length = story.season_length ?? 0;
  const seasonOf = (episode: number) => (length > 0 ? Math.ceil(episode / length) : 0);
  const rows: EpisodeRow[] = read
    .filter((t) => (t.episode ?? 0) > 0)
    .map((t) => ({ kind: 'read', episode: t.episode!, title: t.title, text: t }));
  const next = storyNext(story);
  if (next) {
    const episode = story.next ? story.next.episode : story.read + 1;
    rows.push({ kind: 'next', episode, title: story.next?.title ?? `Episode ${episode}`, textId: story.next?.id ?? null, status: next.text, ready: next.ready });
  }
  const sections: { season: number; rows: EpisodeRow[] }[] = [];
  for (const row of rows) {
    const season = seasonOf(row.episode);
    const last = sections[sections.length - 1];
    if (last && last.season === season) last.rows.push(row);
    else sections.push({ season, rows: [row] });
  }
  return sections;
}
