// Podcasts (docs/read-and-listen/architecture.md, "Podcasts"): an episode's published transcript read
// as a text while the episode plays (server/reader podcast.py). The shows used before, kept on the
// phone for the add screen, and what the screens say about shows and episodes. Pure, so it's tested;
// podcastStorage.ts keeps the list. Nothing here grades a card.
import type { PodcastShow } from './api';

/** How many shows used before the add screen remembers, newest first. */
export const REMEMBERED_SHOWS = 8;

export type RememberedShow = Pick<PodcastShow, 'title' | 'author' | 'feed' | 'artwork'> & {
  /** When an episode of it was last added (epoch ms). */
  usedAt: number;
  /** The newest episode with a transcript when it was last opened, to say when there's a newer one. */
  newestGuid?: string;
};

/** The list with `show` at the top (once, by its feed), the newest `REMEMBERED_SHOWS`. */
export function rememberShow(list: readonly RememberedShow[], show: RememberedShow): RememberedShow[] {
  return [show, ...list.filter((s) => s.feed !== show.feed)].slice(0, REMEMBERED_SHOWS);
}

/** What the phone kept, read leniently: anything unreadable is dropped. */
export function parseShows(raw: unknown): RememberedShow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): RememberedShow[] => {
    if (!x || typeof x !== 'object') return [];
    const { title, author, feed, artwork, usedAt, newestGuid } = x as Record<string, unknown>;
    if (typeof title !== 'string' || typeof feed !== 'string' || !feed || typeof usedAt !== 'number') return [];
    return [{ title, author: typeof author === 'string' ? author : '', feed, artwork: typeof artwork === 'string' ? artwork : '', usedAt, ...(typeof newestGuid === 'string' ? { newestGuid } : {}) }];
  }).slice(0, REMEMBERED_SHOWS);
}

/** A search result's line about its transcripts, or null when its feed wasn't read. */
export function transcriptsLabel(t: PodcastShow['transcripts']): string | null {
  if (t === 'most') return 'Most episodes have a transcript';
  if (t === 'some') return 'Some episodes have a transcript';
  if (t === 'none') return 'No transcripts';
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Nov · 12 min" for an episode: when it came out (in the phone's zone) and how long it is. */
export function episodeDetail(e: { published?: string | null; seconds?: number | null }, now: Date): string {
  const parts: string[] = [];
  if (e.published) {
    const d = new Date(e.published);
    if (!Number.isNaN(d.getTime())) parts.push(`${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`);
  }
  if (e.seconds) parts.push(`${Math.max(1, Math.round(e.seconds / 60))} min`);
  return parts.join(' · ');
}

/** The newest episode with a transcript, to remember with the show. */
export const newestWithTranscript = (episodes: readonly { guid: string; transcript: boolean }[]): string | undefined => episodes.find((e) => e.transcript)?.guid;

/** Whether a remembered show has a newer episode with a transcript than when it was last opened. */
export const hasNewEpisode = (show: RememberedShow, newest: string | undefined): boolean => !!newest && !!show.newestGuid && newest !== show.newestGuid;

/** Whether what was typed is a link (a feed or an Apple Podcasts link) rather than words to search for. */
export const isLink = (text: string): boolean => /^https?:\/\/\S+$/i.test(text.trim());
