// The Stories list in words (docs/read-and-listen/architecture.md, Stories): several stories run
// at once, one pinned to the shelf's card. Pure, so it's tested.
import type { Shelf, StoryListItem } from './api';
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

/** The Library's Stories row: "3 running · 1 more episode ready". */
export function storiesDetail(stories: Shelf['stories']): string {
  // A server older than several stories says nothing, and the row still opens the list.
  if (!stories) return 'Your stories and their episodes';
  if (stories.running === 0) return 'None running';
  const ready = stories.ready === 0 ? '' : ` · ${stories.ready} more ${stories.ready === 1 ? 'episode' : 'episodes'} ready`;
  return `${stories.running} running${ready}`;
}
