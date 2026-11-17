import { describe, expect, it, vi } from 'vitest';
import { createPreloader } from '../../src/reader/preload';
import { NORMAL_RATE, SLOW_RATE } from '../../src/reader/playbackRate';

const api = (slowTimes: () => Promise<{ times: never[] }> = async () => ({ times: [] })) => ({
  audioSource: (id: number, line: number, rate = 1) => ({ uri: `/${id}/${line}${rate < 1 ? '?slow' : ''}`, headers: { Authorization: 'Bearer x' } }),
  slowTimes: vi.fn(slowTimes),
});

const setup = (fail = false) => {
  const download = vi.fn(async (_source: { uri: string }, name: string) => {
    if (fail) throw new Error('offline');
    return `file:///cache/${name}`;
  });
  const remove = vi.fn();
  return { download, remove, preloader: createPreloader({ download, remove }) };
};

describe('createPreloader', () => {
  it('hands over the held line from a file on the phone, without the passphrase', async () => {
    const { preloader, download } = setup();
    preloader.prefetch(api(), 3, 2, NORMAL_RATE);
    const got = await preloader.take(3, 2, NORMAL_RATE);
    expect(got).toMatchObject({ slow: false, stretch: NORMAL_RATE, source: { uri: expect.stringMatching(/^file:\/\/\/cache\/line-\d+\.mp3$/) } });
    expect(got!.source.headers).toBeUndefined();
    expect(download).toHaveBeenCalledWith({ uri: '/3/2', headers: { Authorization: 'Bearer x' } }, expect.any(String));
  });

  it('gives nothing for a line or speed that is not the held one', async () => {
    const { preloader } = setup();
    preloader.prefetch(api(), 3, 2, NORMAL_RATE);
    expect(await preloader.take(3, 3, NORMAL_RATE)).toBeNull();
    expect(await preloader.take(3, 2, SLOW_RATE)).toBeNull();
    expect(await preloader.take(4, 2, NORMAL_RATE)).toBeNull();
    // A miss leaves the held line for whoever asks for it.
    expect(await preloader.take(3, 2, NORMAL_RATE)).not.toBeNull();
  });

  it('fetches a slow line\'s word times with it and passes them on', async () => {
    const a = api();
    const { preloader } = setup();
    preloader.prefetch(a, 3, 2, SLOW_RATE);
    expect(await preloader.take(3, 2, SLOW_RATE)).toMatchObject({ slow: true, times: [] });
    expect(a.slowTimes).toHaveBeenCalledWith(3, 2);
  });

  it('does not start a second fetch for the line it already holds', async () => {
    const { preloader, download } = setup();
    preloader.prefetch(api(), 3, 2, NORMAL_RATE);
    preloader.prefetch(api(), 3, 2, NORMAL_RATE);
    await preloader.take(3, 2, NORMAL_RATE);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('replaces the held line with a newer one and deletes the old file', async () => {
    const { preloader, remove } = setup();
    preloader.prefetch(api(), 3, 2, NORMAL_RATE);
    preloader.prefetch(api(), 3, 5, NORMAL_RATE);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await preloader.take(3, 2, NORMAL_RATE)).toBeNull();
    expect(await preloader.take(3, 5, NORMAL_RATE)).not.toBeNull();
  });

  it('gives nothing when the fetch failed, so the caller loads the line itself, and cleans up', async () => {
    const { preloader, remove } = setup(true);
    preloader.prefetch(api(), 3, 2, NORMAL_RATE);
    expect(await preloader.take(3, 2, NORMAL_RATE)).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('keeps at most the playing file and the one on its way', async () => {
    const { preloader, remove } = setup();
    preloader.prefetch(api(), 3, 1, NORMAL_RATE);
    const first = await preloader.take(3, 1, NORMAL_RATE);
    preloader.prefetch(api(), 3, 2, NORMAL_RATE);
    expect(remove).not.toHaveBeenCalled();
    await preloader.take(3, 2, NORMAL_RATE);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(first!.source.uri).toContain(String(remove.mock.calls[0][0]));
  });

  it('deletes everything when cleared', async () => {
    const { preloader, remove } = setup();
    preloader.prefetch(api(), 3, 1, NORMAL_RATE);
    await preloader.take(3, 1, NORMAL_RATE);
    preloader.prefetch(api(), 3, 2, NORMAL_RATE);
    preloader.clear();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await preloader.take(3, 2, NORMAL_RATE)).toBeNull();
  });
});
