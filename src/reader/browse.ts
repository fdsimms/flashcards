// Read & Listen's home as rows of covers, like a streaming app's (docs/read-and-listen/architecture.md,
// Shelf, Browse): what each cover and the pinned story's banner say. Pure, so it's tested.
import type { PastText, Rating, ShelfStory, StoryListItem } from './api';
import { minutesFor } from './shelf';
import { readAgo } from './relisten';
import { storyNext, storyPlace } from './stories';

const RATING_TEXT: Record<Rating, string> = { too_easy: 'Too easy', about_right: 'About right', too_hard: 'Too hard' };

/** The banner's line under the pinned story's name: its next episode, or where it's got to. */
export function bannerLine(story: ShelfStory): string {
  const next = story.next;
  if (next) return `Episode ${next.episode} · ${next.title} · ${minutesFor(next.lines)} min`;
  const n = story.read + 1;
  if (story.writing) return `Writing episode ${n}`;
  if (story.failed) return `Couldn't write episode ${n}. The server tries again in half an hour.`;
  return `Episode ${n} isn't written yet`;
}

/** The banner's overline: "Series · Season 1", or just "Series" from a server older than seasons. */
export function bannerOverline(story: Pick<ShelfStory, 'season'>): string {
  return story.season ? `Series · Season ${story.season}` : 'Series';
}

/** A story cover's bottom line, and whether it's an episode ready (shown in the due color). */
export function storyCoverMeta(story: StoryListItem): { text: string; ready: boolean } {
  return storyNext(story) ?? { text: storyPlace(story), ready: false };
}

/** How far through its season a running story is, 0 to 1, for the cover's bar; null for an ended one or a server older than seasons. */
export function seasonProgress(story: StoryListItem): number | null {
  if (!story.running || !story.season_episode || !story.season_length) return null;
  // `season_episode` is the episode the story is on (waiting or next to be written), so the ones before it are read.
  return Math.min(1, Math.max(0, (story.season_episode - 1) / story.season_length));
}

/** A past text's cover line: "Read yesterday · About right". */
export function pastMeta(text: Pick<PastText, 'read_at' | 'rating'>, now: Date, dayStartsAtHour: number): string {
  const ago = readAgo(text.read_at, now, dayStartsAtHour);
  return [ago ? `Read ${ago}` : null, text.rating ? RATING_TEXT[text.rating] : null].filter(Boolean).join(' · ');
}

/** The texts read before, newest first: past texts that aren't story episodes (those are on their story's page). */
export function readBefore(texts: PastText[], limit: number): PastText[] {
  return texts.filter((t) => !t.episode).slice(0, limit);
}
