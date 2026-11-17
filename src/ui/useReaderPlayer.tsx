import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Api } from '../reader/api';
import { afterLine, linePosition, skipTo, type Handoff } from '../reader/handoff';
import { lineAudio } from '../reader/lineAudio';
import { createPreloader, type Preloader } from '../reader/preload';
import { preloadFiles } from './preloadFiles';

/**
 * The one audio player Read & Listen's reader plays lines on, kept above the router so that Play
 * all can carry on after the reader is closed: the mini-player on the tab bar shows what's playing
 * and steps through the rest of the text (src/reader/handoff.ts has the rules). The reader owns the
 * player while it's open (`claim`), and hands over only when it closes with Play all running.
 *
 * The line-by-line playing here is imperative (a listener on the player, not a status hook), so a
 * line ending or a progress tick never re-renders the app; only what the pill shows does.
 */

/** What the pill shows, and what a tap on it opens. */
export interface MiniPlayer {
  textId: number;
  title: string;
  playing: boolean;
  /** "Line n of m", among the lines that have audio. */
  line: { n: number; of: number };
}

export interface ReaderPlayerHost {
  /** Plays the reader's lines. Shared, so the reader never creates one of its own. */
  player: AudioPlayer;
  /** Fetches the next line while one plays; shared so a line fetched in the reader is there for the mini-player. */
  preloader: Preloader;
  /** What's playing after the reader was closed on Play all; null when nothing is. */
  mini: MiniPlayer | null;
  /** The reader opened: whatever was carrying on stops, and the reader plays from here. */
  claim: () => void;
  /** The reader closed on Play all: carry on from `handoff`. */
  handOff: (api: Api, handoff: Handoff) => void;
  /** The reader closed without Play all: stop what it was playing. */
  release: () => void;
  toggle: () => void;
  skip: (step: -1 | 1) => void;
  stop: () => void;
}

const BACKGROUND_MODE = { playsInSilentMode: true, shouldPlayInBackground: true };
const FOREGROUND_MODE = { playsInSilentMode: true, shouldPlayInBackground: false };

function useReaderPlayer(): ReaderPlayerHost {
  const player = useRef<AudioPlayer | null>(null);
  player.current ??= createAudioPlayer(null, { keepAudioSessionActive: true });
  const preloader = useRef<Preloader | null>(null);
  preloader.current ??= createPreloader(preloadFiles);
  const carrying = useRef<{ api: Api; handoff: Handoff } | null>(null);
  const listener = useRef<{ remove: () => void } | null>(null);
  // Counts line starts: a slow line is fetched before it plays, and a newer start wins.
  const starting = useRef(0);
  const [mini, setMini] = useState<MiniPlayer | null>(null);

  const show = useCallback((playing: boolean) => {
    const c = carrying.current;
    if (!c) { setMini(null); return; }
    const { textId, title } = c.handoff;
    const line = linePosition(c.handoff);
    setMini((prev) => (prev && prev.textId === textId && prev.playing === playing && prev.line.n === line.n ? prev : { textId, title, playing, line }));
  }, []);

  const end = useCallback((pause: boolean) => {
    listener.current?.remove();
    listener.current = null;
    carrying.current = null;
    starting.current++;
    if (pause) player.current!.pause();
    player.current!.clearLockScreenControls();
    preloader.current!.clear();
    setMini(null);
    setAudioModeAsync(FOREGROUND_MODE).catch(() => undefined);
  }, []);

  const playLine = useCallback(async (line: number) => {
    const c = carrying.current;
    if (!c) return;
    const mine = ++starting.current;
    const { api, handoff } = c;
    const audio = (await preloader.current!.take(handoff.textId, line, handoff.rate)) ?? (await lineAudio(api, handoff.textId, line, handoff.rate));
    if (starting.current !== mine || carrying.current !== c) return;
    c.handoff = { ...handoff, current: line, played: 1 };
    player.current!.replace(audio.source);
    player.current!.setPlaybackRate(audio.stretch, 'high');
    player.current!.play();
    player.current!.setActiveForLockScreen(true, { title: handoff.title, artist: 'Franki', albumTitle: 'Read & Listen' });
    show(true);
    // The line after this one's last repeat, fetched while this plays (a line repeated forever has none).
    const after = Number.isFinite(c.handoff.repeat) ? afterLine({ ...c.handoff, played: c.handoff.repeat }) : null;
    if (after?.kind === 'line') preloader.current!.prefetch(api, handoff.textId, after.line, handoff.rate);
  }, [show]);

  const onStatus = useCallback((status: { didJustFinish: boolean; playing: boolean; isBuffering: boolean; error?: unknown }) => {
    const c = carrying.current;
    if (!c) return;
    if (status.error) {
      // A line with no sound is passed over, as the reader does.
      const step = afterLine({ ...c.handoff, repeat: 1 });
      if (step.kind === 'line') void playLine(step.line); else end(false);
      return;
    }
    if (status.didJustFinish) {
      const step = afterLine(c.handoff);
      if (step.kind === 'again') {
        c.handoff = { ...c.handoff, played: c.handoff.played + 1 };
        player.current!.seekTo(0).then(() => player.current!.play(), () => undefined);
      } else if (step.kind === 'line') void playLine(step.line);
      else end(false);
      return;
    }
    show(status.playing || status.isBuffering);
  }, [playLine, end, show]);

  const claim = useCallback(() => {
    if (!carrying.current) return;
    end(true);
  }, [end]);

  const handOff = useCallback((api: Api, handoff: Handoff) => {
    listener.current?.remove();
    carrying.current = { api, handoff };
    listener.current = player.current!.addListener('playbackStatusUpdate', onStatus);
    // The reader's own switch to background playing is undone as it closes; carrying on needs it kept.
    setAudioModeAsync(BACKGROUND_MODE).catch(() => undefined);
    show(true);
  }, [onStatus, show]);

  const release = useCallback(() => {
    preloader.current!.clear();
    player.current!.pause();
    player.current!.clearLockScreenControls();
  }, []);

  const toggle = useCallback(() => {
    const p = player.current!;
    if (p.playing) p.pause(); else p.play();
  }, []);

  const skip = useCallback((step: -1 | 1) => {
    const c = carrying.current;
    if (!c) return;
    const to = skipTo(c.handoff, step);
    if (to !== null) void playLine(to);
  }, [playLine]);

  const stop = useCallback(() => end(true), [end]);

  useEffect(() => () => { listener.current?.remove(); player.current?.remove(); }, []);

  return { player: player.current, preloader: preloader.current, mini, claim, handOff, release, toggle, skip, stop };
}

const Host = createContext<ReaderPlayerHost | null>(null);

/** Holds the shared player above the router, so it outlives the reader screen. */
export function ReaderPlayerProvider({ children }: { children: React.ReactNode }) {
  const host = useReaderPlayer();
  return <Host.Provider value={host}>{children}</Host.Provider>;
}

export function useReaderPlayerHost(): ReaderPlayerHost {
  const host = useContext(Host);
  if (!host) throw new Error('useReaderPlayerHost needs a ReaderPlayerProvider above it.');
  return host;
}
