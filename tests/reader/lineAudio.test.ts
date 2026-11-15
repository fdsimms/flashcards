import { describe, expect, it, vi } from 'vitest';
import { lineAudio } from '../../src/reader/lineAudio';
import { NORMAL_RATE, SLOW_RATE } from '../../src/reader/playbackRate';

const api = (slowTimes: () => Promise<{ times: never[] }>) => ({
  audioSource: (id: number, line: number, rate = 1) => ({ uri: `/${id}/${line}${rate < 1 ? '?slow' : ''}`, headers: { Authorization: 'Bearer x' } }),
  slowTimes: vi.fn(slowTimes),
});

describe('lineAudio', () => {
  it('plays a normal line as it is, without asking for word times', async () => {
    const a = api(async () => ({ times: [] }));
    expect(await lineAudio(a, 3, 1, NORMAL_RATE)).toMatchObject({ slow: false, stretch: NORMAL_RATE, source: { uri: '/3/1' } });
    expect(a.slowTimes).not.toHaveBeenCalled();
  });

  it('asks for a slow line\'s times first, which also makes the recording, and returns them', async () => {
    const a = api(async () => ({ times: [] }));
    const got = await lineAudio(a, 3, 1, SLOW_RATE);
    expect(got).toMatchObject({ slow: true, stretch: NORMAL_RATE, source: { uri: '/3/1?slow' }, times: [] });
    expect(a.slowTimes).toHaveBeenCalledWith(3, 1);
  });

  it('does not ask again for times it already has', async () => {
    const a = api(async () => ({ times: [] }));
    const got = await lineAudio(a, 3, 1, SLOW_RATE, []);
    expect(got.slow).toBe(true);
    expect(got.times).toBeUndefined();
    expect(a.slowTimes).not.toHaveBeenCalled();
  });

  it('plays the normal recording stretched when the slow one can\'t be made', async () => {
    const a = api(async () => { throw new Error('no'); });
    expect(await lineAudio(a, 3, 1, SLOW_RATE)).toMatchObject({ slow: false, stretch: SLOW_RATE, source: { uri: '/3/1' } });
  });
});
