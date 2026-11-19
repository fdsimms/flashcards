import { IDLE_MODE, LISTENING_MODE } from './listeningAudio';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Api, AudioLesson } from '../reader/api';
import { afterLine, linePosition, skipTo, type Handoff } from '../reader/handoff';
import { lineAudio } from '../reader/lineAudio';
import { SKIP_SECONDS, skipTo as skipLessonTo } from '../reader/lessons';
import { createPreloader, type Preloader } from '../reader/preload';
import { preloadFiles } from './preloadFiles';
import { attachListeningPlayer, beginListening, endListening, setListeningDetail, type ListeningControls } from './listeningActivity';
import { lineDetail } from '../reader/listeningActivity';
import { lessonAudioMode, useLessonTurns, type LessonTurns } from './useLessonTurns';
import { useLessonWaits, type LessonWaits } from './useLessonWaits';

/**
 * The one audio player Read & Listen's reader plays lines on, kept above the router so that Play
 * all can carry on after the reader is closed: the mini-player on the tab bar shows what's playing
 * and steps through the rest of the text (src/reader/handoff.ts has the rules). The reader owns the
 * player while it's open (`claim`), and hands over only when it closes with Play all running.
 * An audio lesson plays on the same player and is handed over the same way: leaving the lesson's
 * screen while it plays keeps it going on the tab bar, with back and forward 15 seconds, and a tap
 * on the pill reopens the lesson where it is (`resumeLesson`).
 *
 * The line-by-line playing here is imperative (a listener on the player, not a status hook), so a
 * line ending or a progress tick never re-renders the app; only what the pill shows does.
 */

/** What the pill shows, and what a tap on it opens. */
export type MiniPlayer =
  | {
    kind: 'text';
    textId: number;
    title: string;
    playing: boolean;
    /** "Line n of m", among the lines that have audio. */
    line: { n: number; of: number };
  }
  | {
    kind: 'lesson';
    /** The lesson as its screen was given it, so a tap on the pill opens that screen again. */
    lesson: AudioLesson;
    title: string;
    playing: boolean;
  };

export interface ReaderPlayerHost {
  /** Plays the reader's lines. Shared, so the reader never creates one of its own. */
  player: AudioPlayer;
  /** Fetches the next line while one plays; shared so a line fetched in the reader is there for the mini-player. */
  preloader: Preloader;
  /** What's playing after the reader was closed on Play all; null when nothing is. */
  mini: MiniPlayer | null;
  /** The reader (or a lesson that's about to play) opened: whatever was carrying on stops, and it plays from here. */
  claim: () => void;
  /** A lesson's screen closed while it played (or waited at a pause for the learner): carry on from where it is. */
  handOffLesson: (lesson: AudioLesson) => void;
  /** A lesson's screen opened: true when it's the lesson carrying on, which then plays on under the screen instead of stopping. */
  resumeLesson: (id: number) => boolean;
  /** The reader closed on Play all: carry on from `handoff`. */
  handOff: (api: Api, handoff: Handoff) => void;
  /** The reader closed without Play all: stop what it was playing. */
  release: () => void;
  toggle: () => void;
  /** The previous or next line, or 15 seconds back or forward in a lesson. */
  skip: (step: -1 | 1) => void;
  stop: () => void;
  /** Wait for my answer: a lesson on this player stops at each place the learner speaks (useLessonWaits). */
  waits: LessonWaits;
  /** The learner's turns: listening for the end of an answer, playing it back, Again (useLessonTurns). */
  turns: LessonTurns;
  /** A lesson is now on the player (or none, null): its pauses are waited at and its turns followed. */
  watchLesson: (lesson: AudioLesson | null, api?: Api | null) => void;
}

const BACKGROUND_MODE = LISTENING_MODE;
const FOREGROUND_MODE = IDLE_MODE;

function useReaderPlayer(): ReaderPlayerHost {
  const player = useRef<AudioPlayer | null>(null);
  player.current ??= createAudioPlayer(null, { keepAudioSessionActive: true });
  attachListeningPlayer(player.current);
  const preloader = useRef<Preloader | null>(null);
  preloader.current ??= createPreloader(preloadFiles);
  const carrying = useRef<{ api: Api; handoff: Handoff } | null>(null);
  // The lesson carrying on after its screen was closed; never set together with `carrying`.
  const carryingLesson = useRef<AudioLesson | null>(null);
  const listener = useRef<{ remove: () => void } | null>(null);
  // Counts line starts: a slow line is fetched before it plays, and a newer start wins.
  const starting = useRef(0);
  const [mini, setMini] = useState<MiniPlayer | null>(null);
  const waits = useLessonWaits(player.current);
  const turns = useLessonTurns(player.current, waits);
  const wantsRecording = useRef(turns.wantsRecording);
  wantsRecording.current = turns.wantsRecording;
  const watchLesson = useCallback((lesson: AudioLesson | null, api?: Api | null) => {
    waits.watch(lesson);
    turns.watch(lesson, api);
  }, [waits.watch, turns.watch]); // eslint-disable-line react-hooks/exhaustive-deps -- both are stable

  const show = useCallback((playing: boolean) => {
    const c = carrying.current;
    const lesson = carryingLesson.current;
    if (!c && !lesson) { setMini(null); return; }
    if (!c) {
      setMini((prev) => (prev?.kind === 'lesson' && prev.lesson.id === lesson!.id && prev.playing === playing ? prev : { kind: 'lesson', lesson: lesson!, title: lesson!.title, playing }));
      return;
    }
    const { textId, title } = c.handoff;
    const line = linePosition(c.handoff);
    setMini((prev) => (prev?.kind === 'text' && prev.textId === textId && prev.playing === playing && prev.line.n === line.n ? prev : { kind: 'text', textId, title, playing, line }));
  }, []);

  const end = useCallback((pause: boolean) => {
    listener.current?.remove();
    listener.current = null;
    carrying.current = null;
    carryingLesson.current = null;
    starting.current++;
    if (pause) player.current!.pause();
    player.current!.clearLockScreenControls();
    endListening();
    preloader.current!.clear();
    watchLesson(null);
    setMini(null);
    setAudioModeAsync(FOREGROUND_MODE).catch(() => undefined);
  }, [watchLesson]);

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
    setListeningDetail(lineDetail(linePosition(c.handoff)));
    // The line after this one's last repeat, fetched while this plays (a line repeated forever has none).
    const after = Number.isFinite(c.handoff.repeat) ? afterLine({ ...c.handoff, played: c.handoff.repeat }) : null;
    if (after?.kind === 'line') preloader.current!.prefetch(api, handoff.textId, after.line, handoff.rate);
  }, [show]);

  const onStatus = useCallback((status: { didJustFinish: boolean; playing: boolean; isBuffering: boolean; error?: unknown }) => {
    const c = carrying.current;
    if (!c) return;
    if (status.error) {
      // A line with no sound is passed over, as the reader does. Not around to the first line: a text whose only voiced line fails would loop forever.
      const step = afterLine({ ...c.handoff, repeat: 1, loop: false });
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

  // The lesson is one recording, so there is no next line: it carries on until it ends or is stopped.
  const onLessonStatus = useCallback((status: { didJustFinish: boolean; playing: boolean; isBuffering: boolean; error?: unknown }) => {
    if (!carryingLesson.current) return;
    if (status.error || status.didJustFinish) { end(false); return; }
    show(status.playing || status.isBuffering);
  }, [end, show]);

  const claim = useCallback(() => {
    if (!carrying.current && !carryingLesson.current) return;
    end(true);
  }, [end]);

  const handOffLesson = useCallback((lesson: AudioLesson) => {
    listener.current?.remove();
    carrying.current = null;
    carryingLesson.current = lesson;
    listener.current = player.current!.addListener('playbackStatusUpdate', onLessonStatus);
    // Recording stays allowed while a microphone setting needs it: iOS won't start a recording in the background otherwise.
    setAudioModeAsync(lessonAudioMode(wantsRecording.current())).catch(() => undefined);
    // Playing, or stopped at a pause waiting for the learner, where Play goes on.
    show(player.current!.playing);
    beginListening({ kind: 'lesson', title: lesson.title, detail: '' }, () => buttons.current);
  }, [onLessonStatus, show]);

  const resumeLesson = useCallback((id: number) => {
    if (carryingLesson.current?.id !== id) return false;
    // The lesson's screen takes the listening and the lock screen's controls over as they are.
    listener.current?.remove();
    listener.current = null;
    carryingLesson.current = null;
    setMini(null);
    return true;
  }, []);

  const handOff = useCallback((api: Api, handoff: Handoff) => {
    listener.current?.remove();
    carryingLesson.current = null;
    carrying.current = { api, handoff };
    listener.current = player.current!.addListener('playbackStatusUpdate', onStatus);
    // The reader's own switch to background playing is undone as it closes; carrying on needs it kept.
    setAudioModeAsync(BACKGROUND_MODE).catch(() => undefined);
    show(true);
    beginListening({ kind: 'text', title: handoff.title, detail: lineDetail(linePosition(handoff)) }, () => buttons.current);
  }, [onStatus, show]);

  const release = useCallback(() => {
    preloader.current!.clear();
    player.current!.pause();
    player.current!.clearLockScreenControls();
    endListening();
  }, []);

  const toggle = useCallback(() => {
    const p = player.current!;
    // Held at a lesson's pause, Play is Continue: on past the rest of the silence.
    if (waits.held) waits.goOn();
    else if (p.playing) p.pause(); else p.play();
  }, [waits]);

  const skip = useCallback((step: -1 | 1) => {
    if (carryingLesson.current) {
      const p = player.current!;
      waits.moved();
      p.seekTo(skipLessonTo(p.currentTime, step * SKIP_SECONDS, p.duration)).catch(() => undefined);
      return;
    }
    const c = carrying.current;
    if (!c) return;
    const to = skipTo(c.handoff, step);
    if (to !== null) void playLine(to);
  }, [playLine, waits]);

  const stop = useCallback(() => end(true), [end]);
  // What the Live Activity's buttons do once the mini-player carries on (the reader's and a lesson's screens answer them while open).
  const buttons = useRef<ListeningControls>({ previous: () => undefined, toggle: () => undefined, next: () => undefined });
  buttons.current = { previous: () => skip(-1), toggle, next: () => skip(1) };

  useEffect(() => () => { listener.current?.remove(); player.current?.remove(); }, []);

  return { player: player.current, preloader: preloader.current, mini, claim, handOff, handOffLesson, resumeLesson, release, toggle, skip, stop, waits, turns, watchLesson };
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
