import type { Api, Word } from './api';
import { isSlow, NORMAL_RATE, SLOW_RATE } from './playbackRate';

/**
 * What to play for one line at a speed (the reader's startLine, and the mini-player carrying on
 * after the reader is left). A slow line is recorded by the server the first time, so its word
 * times are fetched first (`api.slowTimes` waits for that recording to exist); if that fails the
 * normal recording is played stretched instead, and `slow` says so.
 */
export type LineAudio = {
  /** A server address with the passphrase, or (once preloaded, src/reader/preload.ts) a file on the phone. */
  source: { uri: string; headers?: Record<string, string> };
  /** The player's own playback rate: stretched only for the fallback. */
  stretch: number;
  /** Whether what plays is the slow recording. */
  slow: boolean;
  /** The slow recording's word times when they were fetched now; undefined when `known` had them or it isn't slow. */
  times?: (Word['time'] | null)[];
};

export async function lineAudio(
  api: Pick<Api, 'audioSource' | 'slowTimes'>,
  textId: number,
  line: number,
  rate: number,
  /** Word times already fetched for this line's slow recording, so they aren't asked for again. */
  known?: (Word['time'] | null)[] | null,
): Promise<LineAudio> {
  if (!isSlow(rate)) return { source: api.audioSource(textId, line, rate), stretch: NORMAL_RATE, slow: false };
  if (known) return { source: api.audioSource(textId, line, rate), stretch: NORMAL_RATE, slow: true };
  try {
    const { times } = await api.slowTimes(textId, line);
    return { source: api.audioSource(textId, line, rate), stretch: NORMAL_RATE, slow: true, times };
  } catch {
    return { source: api.audioSource(textId, line), stretch: SLOW_RATE, slow: false };
  }
}
