import type { Api } from './api';
import { lineAudio, type LineAudio } from './lineAudio';

/**
 * Fetches the next line's audio while the current one plays, so Play all doesn't wait on the
 * server between lines (the reader's startLine and the mini-player's playLine both take from it).
 *
 * It holds one line only: the one `nextLine` would pick. A line asked for that isn't the held one
 * (Pause then another line tapped, a speed change) gets nothing from it and loads as usual, and the
 * next `prefetch` replaces it, so a stale download is never played and the cache folder holds at
 * most one file. Preloading never marks a line heard: that stays with the line playing.
 *
 * Pure, so the rules are tested: the download and the file's removal are passed in (the phone's
 * are in src/ui/preloadFiles.ts).
 */
export type Preload = {
  /** Fetches `source` to a file on the phone and gives its address. */
  download: (source: LineAudio['source'], name: string) => Promise<string>;
  /** Deletes what `download` wrote. Failing is fine: it's in the cache folder. */
  remove: (name: string) => void;
};

type Held = { key: string; name: string; audio: Promise<LineAudio | null> };

export function createPreloader({ download, remove }: Preload) {
  let held: Held | null = null;
  // The file the player is on, from the last `take`. It goes when the next line is taken (the player
  // has moved on by then), so the cache folder holds this one and the one on its way, never a pile.
  let playing: string | null = null;
  let serial = 0;

  const drop = () => {
    if (held) remove(held.name);
    held = null;
  };

  return {
    /**
     * Starts fetching `line` at `rate`. A slow line's word times are fetched too (`known` has the
     * ones already in hand). Asking again for what's held does nothing.
     */
    prefetch(api: Pick<Api, 'audioSource' | 'slowTimes'>, textId: number, line: number, rate: number, known?: LineAudio['times'] | null): void {
      const key = `${textId}:${line}:${rate}`;
      if (held?.key === key) return;
      drop();
      const name = `line-${++serial}.mp3`;
      const audio = (async (): Promise<LineAudio | null> => {
        const got = await lineAudio(api, textId, line, rate, known);
        // The fallback (a slow line whose recording couldn't be made) plays the normal one stretched,
        // and so is just as loadable.
        return { ...got, source: { uri: await download(got.source, name) } };
      })().catch(() => null);
      held = { key, name, audio };
    },

    /**
     * The held line's audio when it's `line` at `rate`, waiting for it if it's still on its way;
     * null when it's another line, or the fetch failed (then the caller loads the line itself).
     * What's taken leaves the preloader, and its file is deleted once the line after it is taken.
     */
    async take(textId: number, line: number, rate: number): Promise<LineAudio | null> {
      const mine = held;
      if (!mine || mine.key !== `${textId}:${line}:${rate}`) return null;
      held = null;
      const audio = await mine.audio;
      if (!audio) {
        remove(mine.name);
        return null;
      }
      if (playing) remove(playing);
      playing = mine.name;
      return audio;
    },

    /** Forgets what's held and deletes the files, for a text closing. */
    clear() {
      drop();
      if (playing) remove(playing);
      playing = null;
    },
  };
}

export type Preloader = ReturnType<typeof createPreloader>;
