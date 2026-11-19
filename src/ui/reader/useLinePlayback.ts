import { setAudioModeAsync, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Api, ReaderText, Word } from '../../reader/api';
import { firstLine, nextLine, previousLine, nextRepeatCount } from '../../reader/playback';
import { lineAudio } from '../../reader/lineAudio';
import { NORMAL_RATE } from '../../reader/playbackRate';
import { hasSlow } from '../../reader/prefs';
import { withTimes } from '../../reader/spoken';
import { prefs, savePrefs } from '../../reader/storage';
import { IDLE_MODE, LISTENING_MODE } from '../listeningAudio';
import { useSelfRecording } from '../useSelfRecording';
import type { ReaderPlayerHost } from '../useReaderPlayer';
import { useSpokenWords } from './useSpokenWords';

/** Listening goes on with the screen locked or in another app, while the reader is open. */
const READER_AUDIO_MODE = LISTENING_MODE;

/**
 * The reader's audio, line by line (Reader.tsx's header says how it behaves): the shared player,
 * the line playing, Play all, the speed, repeats, Record yourself for the line, and which words the
 * voice has reached. The screen hears about three things: a line starting or resuming (`onPlay`, to
 * count it as heard at that speed), a line played to its end or with no sound (`onLineHeard`), and
 * Play all reaching the end of the text (`onPlayedThrough`).
 *
 * Kept out of Reader.tsx so the screen holds what's read and this holds what's heard; the logic of
 * which line comes next is src/reader/playback.ts.
 */
export function useLinePlayback({ api, playerHost, text, onPlay, onLineHeard, onPlayedThrough }: {
  api: Api;
  playerHost: ReaderPlayerHost;
  text: ReaderText | null;
  onPlay: (rate: number) => void;
  onLineHeard: (line: number) => void;
  onPlayedThrough: () => void;
}) {
  const player = playerHost.player;
  // The reader opening takes over from a Play all that carried on after the last one closed.
  useEffect(() => { playerHost.claim(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, as it opens
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<number | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  // A line has been asked for and hasn't started sounding yet (its audio is loading). With the gap after
  // a line ends, this is when the player isn't playing but the reader is still going: the play button
  // keeps showing Pause through it instead of flashing to Play between lines.
  const [awaitingSound, setAwaitingSound] = useState(false);
  const sounding = status.playing || awaitingSound || (playingAll && status.didJustFinish);
  useEffect(() => { if (status.playing) setAwaitingSound(false); }, [status.playing]);
  // The line to shade: the one sounding now. `current` stays set after a pause or the end of a line
  // (Play and the "Line n of m" label need it), so shading it would leave a stopped line lit. Between
  // two lines of Play all the player is briefly not playing, so that gap keeps the shade too.
  const shaded = status.playing || status.isBuffering || (playingAll && status.didJustFinish) ? current : null;
  const [chosenRate, setRate] = useState(prefs().rate);
  // The speed played at: the one chosen, or normal in a language that doesn't offer Slow (Settings).
  const slowOffered = text ? hasSlow(prefs(), text.language) : true;
  const rate = slowOffered ? chosenRate : NORMAL_RATE;
  // Slow recordings' word times by `<text id>:<line>`, and whether the line sounding now is the slow
  // one (null before any line has played). `playedRate` is the speed the player's line was started at.
  const [slowTimed, setSlowTimed] = useState<Record<string, (Word['time'] | null)[]>>({});
  const [playedSlow, setPlayedSlow] = useState<boolean | null>(null);
  const playedRate = useRef(rate);
  // Counts line starts: a slow line is fetched before it plays, and a tap on another line meanwhile wins.
  const starting = useRef(0);
  // Record yourself, for shadowing: a take of the line that's playing or last played.
  const self = useSelfRecording(text && current !== null ? `${text.id}:${current}` : null, READER_AUDIO_MODE, {
    onBeforeAudio: () => player.pause(),
    // Compare plays the line as it was played (the speed chosen), then the take.
    original: text && current !== null && text.lines[current]?.audio
      ? async () => {
        const audio = await lineAudio(api, text.id, current, playedRate.current, slowTimed[`${text.id}:${current}`]);
        return { source: audio.source, rate: audio.stretch };
      }
      : null,
  });

  // READER_AUDIO_MODE while the reader is open. Review's card audio doesn't need background
  // playback, so it's turned off again on the way out, unless Play all is running: that carries on
  // on the tab bar's mini-player, which keeps the mode (see `leaving` in Reader.tsx). Declared after Record
  // yourself, so this cleanup runs after the one that puts the reader's mode back when it closes mid-take.
  useEffect(() => {
    setAudioModeAsync(READER_AUDIO_MODE).catch(() => undefined);
    return () => {
      const l = carryOn.current;
      if (l.text && l.playingAll && l.current !== null && l.playing) {
        playerHost.handOff(api, { textId: l.text.id, title: l.text.title, language: l.text.language, lines: l.text.lines, current: l.current, repeat: l.repeat, played: l.played, rate: l.rate });
        return;
      }
      playerHost.release();
      setAudioModeAsync(IDLE_MODE).catch(() => undefined);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads the latest values from `carryOn` as it closes

  const [silentLine, setSilentLine] = useState<number | null>(null);
  // Plays per line (1 is off, Infinity is until turned off) and how many the current line has had in this round.
  const [repeat, setRepeat] = useState<number>(1);
  const [played, setPlayed] = useState(1);
  // What the mini-player needs to carry on, as of the latest render, for when this closes.
  const carryOn = useRef({ text: null as ReaderText | null, current: null as number | null, playingAll: false, playing: false, repeat: 1, played: 1, rate: NORMAL_RATE });
  carryOn.current = { text, current, playingAll, playing: status.playing || status.isBuffering || (playingAll && status.didJustFinish), repeat, played, rate: playedRate.current };
  // The words being spoken in the line playing, lit as the voice reaches them (useSpokenWords.ts),
  // unless that's turned off in Read & Listen's settings. Read from prefs on each render rather than
  // kept in state, so a change made there shows here without reopening the text.
  // Only the line sounding now (`shaded`), so a paused or finished line doesn't keep a word lit.
  const playingWords = text && shaded !== null && prefs().followWords ? text.lines[shaded]?.words ?? null : null;
  // A slow recording is timed apart from the normal one (`api.slowTimes`, fetched when a line is first
  // played slowly), so those times light the words while it plays. `playingWords` itself stays the
  // text's, since what's lit is found by index. A line with no slow times (the fetch failed, and it was
  // played stretched instead) keeps the normal ones.
  const slowTimes = playedSlow !== null && text && shaded !== null ? slowTimed[`${text.id}:${shaded}`] : undefined;
  const timedWords = useMemo(() => (playingWords && slowTimes && playedSlow ? withTimes(playingWords, slowTimes) : playingWords), [playingWords, slowTimes, playedSlow]);
  const spokenNow = useSpokenWords(player, timedWords, status.playing);
  const spoken = new Set(playingWords ? spokenNow.map((i) => playingWords[i]) : []);

  // Plays a line at `r`. A slow line is recorded by the server the first time (`api.slowTimes` waits for
  // that and brings its word times); if that fails, the normal recording plays stretched instead.
  const startLine = async (i: number, r: number) => {
    if (!text) return;
    const mine = ++starting.current;
    const key = `${text.id}:${i}`;
    setAwaitingSound(true);
    // The line fetched while the last one played, when this is it; else loaded now.
    let audio;
    try {
      audio = (await playerHost.preloader.take(text.id, i, r)) ?? (await lineAudio(api, text.id, i, r, slowTimed[key]));
    } catch (e) {
      if (starting.current === mine) setAwaitingSound(false);
      throw e;
    }
    if (starting.current !== mine) return;
    if (audio.times) setSlowTimed((prev) => ({ ...prev, [key]: audio.times! }));
    setPlayedSlow(audio.slow);
    playedRate.current = r;
    player.replace(audio.source);
    player.setPlaybackRate(audio.stretch, 'high');
    player.play();
    // Now Playing, on the lock screen and in Control Center: the text's title, with play and pause. The progress bar there is the line's.
    player.setActiveForLockScreen(true, { title: text.title, artist: 'Franki', albumTitle: 'Read & Listen' });
  };

  // While a line plays in Play all, the next one is fetched (src/reader/preload.ts), so it can start as
  // soon as this ends. That's the line after the last repeat of this one; a line repeated forever has no
  // next. Asking again for the held line does nothing, and a line asked for that isn't it (another line
  // tapped, the speed changed) loads as usual. Marking a line heard stays with `didJustFinish` below.
  useEffect(() => {
    if (!text || current === null || !playingAll || !(status.playing || status.isBuffering)) return;
    if (!Number.isFinite(repeat)) return;
    const next = nextLine(text.lines, current, true, repeat, repeat);
    if (next !== null && next !== current) playerHost.preloader.prefetch(api, text.id, next, rate, slowTimed[`${text.id}:${next}`]);
  }, [text, current, playingAll, status.playing, status.isBuffering, repeat, rate]); // eslint-disable-line react-hooks/exhaustive-deps -- `slowTimed` only saves asking for times again

  const playLine = (i: number, all: boolean, r = rate) => {
    if (!text) return;
    self.stop(false);
    self.stopTake();
    setSilentLine(null);
    startLine(i, r);
    setCurrent(i);
    setPlayed(1);
    setPlayingAll(all);
    onPlay(r);
  };

  // Previous and next line, for a story with no play button on each line. Plays on from there.
  const skip = (step: -1 | 1) => {
    if (!text) return;
    const to = current === null ? firstLine(text.lines) : step < 0 ? previousLine(text.lines, current) : firstLine(text.lines, current + 1);
    if (to !== null) playLine(to, true);
  };

  const togglePlay = () => {
    if (!text) return;
    self.stop(false);
    self.stopTake();
    if (sounding) {
      // Pause, including in the gap between lines: a line still loading is dropped, not started.
      starting.current++;
      setAwaitingSound(false);
      player.pause();
    } else if (current !== null && playedRate.current === rate && !status.didJustFinish && status.currentTime < status.duration) {
      player.play();
      onPlay(rate);
    } else {
      const start = firstLine(text.lines, current === null ? 0 : current + 1) ?? firstLine(text.lines);
      if (start !== null) playLine(start, true);
    }
  };

  // The speed is a different recording, so a line playing starts again at the new one.
  const changeRate = (next: number) => {
    savePrefs({ rate: next });
    setRate(next);
    if (status.playing && current !== null) playLine(current, playingAll, next);
  };

  // The repeat chip: the next count, starting the current line's round over.
  const cycleRepeat = () => {
    setRepeat((r) => nextRepeatCount(r));
    setPlayed(1);
  };

  // A new text: nothing playing and no line chosen.
  const reset = () => {
    player.pause();
    starting.current++;
    setAwaitingSound(false);
    playerHost.preloader.clear();
    setCurrent(null);
    setPlayingAll(false);
    setSilentLine(null);
  };

  useEffect(() => {
    if (!status.didJustFinish || current === null || !text) return;
    onLineHeard(current);
    const next = nextLine(text.lines, current, playingAll, repeat, played);
    if (next === current) {
      // The same source again: rewind rather than reload it.
      setPlayed((n) => n + 1);
      player.seekTo(0).then(() => player.play(), () => undefined);
      return;
    }
    if (next !== null) playLine(next, true);
    else {
      setPlayingAll(false);
      setAwaitingSound(false);
      if (playingAll) onPlayedThrough();
    }
  }, [status.didJustFinish]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to a line ending only

  // A line whose audio didn't load (the server had none for it): note it and move on.
  useEffect(() => {
    if (!status.error || current === null || !text) return;
    setSilentLine(current);
    onLineHeard(current); // nothing to wait for on a line with no sound
    const next = nextLine(text.lines, current, playingAll);
    if (next !== null) playLine(next, true);
    else { setPlayingAll(false); setAwaitingSound(false); }
  }, [status.error]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to a load error only

  return {
    player, status, sounding, current, shaded, rate, slowOffered, repeat, played, silentLine, self, spoken,
    playLine, skip, togglePlay, changeRate, cycleRepeat, reset,
  };
}
