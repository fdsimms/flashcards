import { describe, expect, it } from 'vitest';
import type { PastText, ShelfStory, ShelfText, StoryListItem } from '../../src/reader/api';
import { bannerLine, bannerOverline, pastMeta, readBefore, seasonProgress, storyCoverMeta } from '../../src/reader/browse';

const episode = (n: number): ShelfText => ({
  id: 10 + n, title: 'La cage ouverte', topic: 'Night at the Zoo', topic_id: 1, form: 'story', lines: 12,
  stretch: [], reason: 'story', coverage: 0.95, episode: n,
});

const story = (over: Partial<StoryListItem> = {}): StoryListItem => ({
  id: 1, title: 'Night at the Zoo', about: '', read: 1, season: 1, season_episode: 2, season_length: 8,
  last_recap: '', next: null, writing: false, failed: null, running: true, pinned: false, ...over,
});

// Local times, with the study day starting at 4 AM.
const NOW = new Date(2026, 10, 17, 12);
const past = (over: Partial<PastText> = {}): PastText => ({
  id: 1, topic: 'Food', title: 'À la gare', rating: 'about_right', read_at: new Date(2026, 10, 16, 20).toISOString(), coverage: 0.95, form: 'dialogue', ...over,
});

describe('browsing Read & Listen', () => {
  it('says what the banner offers: the next episode, or where the story has got to', () => {
    const base: ShelfStory = story();
    expect(bannerLine({ ...base, next: episode(2) })).toBe('Episode 2 · La cage ouverte · 4 min');
    expect(bannerLine({ ...base, writing: true })).toBe('Writing episode 2');
    expect(bannerLine({ ...base, failed: 'Busy.' })).toBe("Couldn't write episode 2. The server tries again in half an hour.");
    expect(bannerLine(base)).toBe('Pull down to check for episode 2');
    expect(bannerOverline(base)).toBe('Series · Season 1');
    expect(bannerOverline({})).toBe('Series');
  });

  it("puts a story's next episode on its cover, or how much of an ended one was read", () => {
    expect(storyCoverMeta(story({ next: episode(2) }))).toEqual({ text: 'Episode 2 is ready', ready: true });
    expect(storyCoverMeta(story({ running: false, read: 8 }))).toEqual({ text: '8 episodes read', ready: false });
  });

  it('fills the bar with the episodes of the season already read', () => {
    expect(seasonProgress(story({ season_episode: 1 }))).toBe(0);
    expect(seasonProgress(story({ season_episode: 5 }))).toBe(0.5);
    expect(seasonProgress(story({ running: false }))).toBeNull();
    expect(seasonProgress(story({ season_episode: undefined }))).toBeNull();
  });

  it('says when a past text was read and how it was rated', () => {
    expect(pastMeta(past(), NOW, 4)).toBe('Read yesterday · About right');
    expect(pastMeta(past({ rating: null }), NOW, 4)).toBe('Read yesterday');
    expect(pastMeta(past({ read_at: 'not a date', rating: 'too_hard' }), NOW, 4)).toBe('Too hard');
  });

  it('keeps story episodes out of the texts read before', () => {
    const texts = [past({ id: 1 }), past({ id: 2, episode: 3 }), past({ id: 3 }), past({ id: 4 })];
    expect(readBefore(texts, 2).map((t) => t.id)).toEqual([1, 3]);
  });
});
