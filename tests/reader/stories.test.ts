import { describe, expect, it } from 'vitest';
import type { ShelfText, StoryListItem } from '../../src/reader/api';
import { storiesDetail, storyNext, storyPlace } from '../../src/reader/stories';

const episode = (n: number): ShelfText => ({
  id: 10 + n, title: 'Le zoo', topic: 'Night at the Zoo', topic_id: 1, form: 'story', lines: 12,
  stretch: [], reason: 'story', coverage: 0.95, episode: n,
});

const story = (over: Partial<StoryListItem> = {}): StoryListItem => ({
  id: 1, title: 'Night at the Zoo', about: '', read: 1, season: 1, season_episode: 2, season_length: 8,
  last_recap: '', next: null, writing: false, failed: null, running: true, pinned: false, ...over,
});

describe('the Stories list', () => {
  it('says where a running story is, and how much of an ended one was read', () => {
    expect(storyPlace(story({ next: episode(2) }))).toBe('Season 1 · Episode 2 of 8');
    expect(storyPlace(story({ season: 2, season_episode: 8 }))).toBe('Season 2 · Episode 8 of 8 · Finale');
    // A server older than seasons: the running number.
    expect(storyPlace(story({ season: undefined, season_episode: undefined, read: 4 }))).toBe('Episode 5');
    expect(storyPlace(story({ running: false, read: 8 }))).toBe('8 episodes read');
    expect(storyPlace(story({ running: false, read: 1 }))).toBe('1 episode read');
  });

  it('says whether the next episode is ready, being written, failed, or not asked for yet', () => {
    expect(storyNext(story({ next: episode(2) }))).toEqual({ text: 'Episode 2 is ready', ready: true });
    expect(storyNext(story({ writing: true }))).toEqual({ text: 'Writing episode 2', ready: false });
    expect(storyNext(story({ failed: 'The model was busy.' }))?.text).toBe("Couldn't write episode 2. The server tries again in half an hour.");
    expect(storyNext(story())?.text).toBe('Pull down to check for episode 2');
    expect(storyNext(story({ running: false }))).toBeNull();
  });

  it('sums the stories up on the Library row', () => {
    expect(storiesDetail({ running: 3, ready: 1 })).toBe('3 running · 1 more episode ready');
    expect(storiesDetail({ running: 3, ready: 2 })).toBe('3 running · 2 more episodes ready');
    expect(storiesDetail({ running: 1, ready: 0 })).toBe('1 running');
    expect(storiesDetail({ running: 0, ready: 0 })).toBe('None running');
    expect(storiesDetail(undefined)).toBe('Your stories and their episodes');
  });
});
