import { describe, expect, it } from 'vitest';
import { canPick, episodeDetail, episodeRowDetail, hasNewEpisode, isLink, newestWithTranscript, parseShows, REMEMBERED_SHOWS, rememberShow, transcribeAsk, transcriptsLabel, type RememberedShow } from '../../src/reader/podcasts';

const show = (feed: string, usedAt = 1): RememberedShow => ({ title: feed, author: '', feed, artwork: '', usedAt });

describe('podcasts', () => {
  it('remembers a show once, newest first, up to a few', () => {
    let list: RememberedShow[] = [];
    for (let i = 0; i < REMEMBERED_SHOWS + 2; i++) list = rememberShow(list, show(`f${i}`, i));
    expect(list).toHaveLength(REMEMBERED_SHOWS);
    expect(list[0].feed).toBe(`f${REMEMBERED_SHOWS + 1}`);
    list = rememberShow(list, show('f5', 99));
    expect(list.filter((s) => s.feed === 'f5')).toHaveLength(1);
    expect(list[0]).toMatchObject({ feed: 'f5', usedAt: 99 });
  });

  it('reads what the phone kept leniently', () => {
    expect(parseShows([{ title: 'A', feed: 'https://x/f', usedAt: 3, newestGuid: 'g' }, { title: 'B' }, null, 'x'])).toEqual([
      { title: 'A', author: '', feed: 'https://x/f', artwork: '', usedAt: 3, newestGuid: 'g' },
    ]);
    expect(parseShows({})).toEqual([]);
  });

  it('says what a show has and when an episode came out', () => {
    expect(transcriptsLabel('most')).toBe('Most episodes have a transcript');
    expect(transcriptsLabel('none')).toBe('No transcripts');
    expect(transcriptsLabel(null)).toBeNull();
    const now = new Date(2026, 10, 28, 12);
    expect(episodeDetail({ published: new Date(2026, 10, 24, 9).toISOString(), seconds: 730 }, now)).toBe('24 Nov · 12 min');
    expect(episodeDetail({ published: new Date(2025, 0, 3, 9).toISOString(), seconds: null }, now)).toBe('3 Jan 2025');
    expect(episodeDetail({}, now)).toBe('');
  });

  it('notices a newer episode with a transcript than last time', () => {
    const episodes = [{ guid: 'new', transcript: false }, { guid: 'mid', transcript: true }];
    expect(newestWithTranscript(episodes)).toBe('mid');
    expect(hasNewEpisode({ ...show('f'), newestGuid: 'old' }, 'mid')).toBe(true);
    expect(hasNewEpisode({ ...show('f'), newestGuid: 'mid' }, 'mid')).toBe(false);
    expect(hasNewEpisode(show('f'), 'mid')).toBe(false);
  });

  it('tells a link from words to search for', () => {
    expect(isLink(' https://podcasts.apple.com/pl/podcast/x/id1 ')).toBe(true);
    expect(isLink('polski z anią')).toBe(false);
  });
});

describe('transcribing an episode', () => {
  const now = new Date(2026, 10, 28, 12);
  const published = new Date(2026, 10, 10, 9).toISOString();
  it('says its price, or that it has none, in the list', () => {
    expect(episodeRowDetail({ published, seconds: 1860, transcript: false, transcribe_usd: 0.52 }, now)).toBe('Transcribe · $0.52 · 10 Nov · 31 min');
    expect(episodeRowDetail({ published, seconds: 1860, transcript: false, transcribe_usd: null }, now)).toBe('No transcript · 10 Nov · 31 min');
    expect(episodeRowDetail({ published, seconds: 1860, transcript: true }, now)).toBe('10 Nov · 31 min');
    expect(canPick({ transcript: false, transcribe_usd: 0.1 })).toBe(true);
    expect(canPick({ transcript: false })).toBe(false);
  });

  it('asks with the length and the price', () => {
    expect(transcribeAsk({ seconds: 1860, transcript: false, transcribe_usd: 0.52 })).toBe(
      "31 minutes of audio, about $0.52 with Azure. Then you'll see how much of it you'd understand before adding it. A transcript is made once and kept.",
    );
    expect(transcribeAsk({ transcript: false, transcribe_usd: 0.2 }).startsWith('About $0.20')).toBe(true);
  });
});
