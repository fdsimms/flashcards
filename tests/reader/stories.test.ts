import { describe, expect, it } from 'vitest';
import type { PastText, ShelfText, StoryListItem } from '../../src/reader/api';
import { episodeSections, storyNext, storyPlace } from '../../src/reader/stories';

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

});

describe("a story's page", () => {
  const past = (episode: number): PastText => ({ id: 100 + episode, topic: 'Night at the Zoo', title: `Titre ${episode}`, rating: null, read_at: '2026-11-16T20:00', coverage: 0.95, form: 'story', episode });

  it('lists the episodes read and the next one by season', () => {
    const sections = episodeSections(story({ read: 9, season: 2, season_episode: 2, next: episode(10) }), [1, 2, 3, 4, 5, 6, 7, 8, 9].map(past));
    expect(sections.map((s) => [s.season, s.rows.map((r) => r.episode)])).toEqual([[1, [1, 2, 3, 4, 5, 6, 7, 8]], [2, [9, 10]]]);
    const next = sections[1].rows[1];
    expect(next).toMatchObject({ kind: 'next', title: 'Le zoo', textId: 20, status: 'Episode 10 is ready', ready: true });
  });

  it('names an episode not written yet by its number, and lists no next one for an ended story', () => {
    const [only] = episodeSections(story({ read: 1, writing: true }), [past(1)]);
    expect(only.rows[1]).toMatchObject({ kind: 'next', title: 'Episode 2', textId: null, status: 'Writing episode 2', ready: false });
    expect(episodeSections(story({ running: false, read: 1 }), [past(1)])[0].rows.map((r) => r.kind)).toEqual(['read']);
  });

  it('keeps every episode in one list from a server older than seasons', () => {
    const sections = episodeSections(story({ season: undefined, season_episode: undefined, season_length: undefined, read: 2 }), [past(1), past(2)]);
    expect(sections.map((s) => s.season)).toEqual([0]);
  });
});
