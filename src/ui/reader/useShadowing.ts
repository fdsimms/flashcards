import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { failureText } from '../../core/failure';
import type { Api, ReaderText } from '../../reader/api';
import { nextShadowLine, shadowStart, shadowTick } from '../../reader/shadow';
import { haptic } from '../haptics';
import { LISTENING_MODE } from '../listeningAudio';
import { useSelfRecording, type SelfRecording } from '../useSelfRecording';
import type { Media } from './VideoPane';

/** What the player is doing for the shadowed line: playing it, playing it before your take (Both), or waiting for your turn. */
export type ShadowPhase = 'playing' | 'both' | 'turn';

export interface Shadowing {
  on: boolean;
  /** The line being shadowed; -1 while Shadow is off. */
  line: number;
  phase: ShadowPhase;
  rec: SelfRecording;
  /** A podcast's line as a file on the phone, for the pitch line and Compare; null for a video's, or until it's fetched. */
  clipUri: string | null;
  /** Why the podcast's clip couldn't be had; the line still plays from the episode. */
  clipError: string | null;
  toggle: () => void;
  /** Plays line `i` once, from its start, and stops for your turn. */
  playLine: (i: number) => void;
  /** A video's line, then your take (a podcast's Compare does this from the clip). */
  both: () => void;
  next: () => void;
  /** Called with the player's time: stops the line at its end. */
  onTime: (ms: number) => void;
}

/**
 * Shadowing in Watch (src/reader/shadow.ts): Shadow plays each line once and stops, Record yourself
 * makes a take (the microphone on only while it records, so Bluetooth headphones keep their quality),
 * and Next line moves on. A podcast's line is fetched as a clip (server/reader routes/clips.py) for the
 * pitch line and Compare; a video's sound can't be had from YouTube's player, so it compares by ear.
 */
export function useShadowing({ api, text, media, current }: {
  api: Api;
  text: ReaderText | null;
  media: RefObject<Media | null>;
  /** The line the player is in, where Shadow starts. */
  current: number;
}): Shadowing {
  const [on, setOn] = useState(false);
  const [line, setLine] = useState(-1);
  const [phase, setPhase] = useState<ShadowPhase>('turn');
  const [clip, setClip] = useState<{ line: number; uri: string } | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const live = useRef({ on, line, phase, begun: false });
  live.current = { ...live.current, on, line, phase };
  const times = text?.video?.times ?? text?.podcast?.times ?? [];
  const timesNow = useRef(times);
  timesNow.current = times;
  const clipUri = clip && clip.line === line ? clip.uri : null;

  const rec = useSelfRecording(on && text && line >= 0 ? `${text.id}:shadow:${line}` : null, LISTENING_MODE, {
    onBeforeAudio: () => media.current?.pause(),
    original: clipUri ? () => ({ source: { uri: clipUri } }) : null,
  });
  const recNow = useRef(rec);
  recNow.current = rec;

  const start = useCallback((i: number, next: ShadowPhase) => {
    const t = timesNow.current[i];
    if (!t) return;
    recNow.current.stopTake();
    live.current.begun = false;
    setLine(i);
    setPhase(next);
    media.current?.seek(t[0] / 1000);
    media.current?.play();
  }, [media]);

  const playLine = useCallback((i: number) => start(i, 'playing'), [start]);

  const toggle = useCallback(() => {
    haptic.select();
    if (live.current.on) {
      recNow.current.stop(false);
      setOn(false);
      setLine(-1);
      return;
    }
    const first = shadowStart(current, timesNow.current.length);
    if (first < 0) return;
    setOn(true);
    start(first, 'playing');
  }, [current, start]);

  const both = useCallback(() => {
    if (live.current.line >= 0) start(live.current.line, 'both');
  }, [start]);

  const next = useCallback(() => {
    const n = nextShadowLine(live.current.line, timesNow.current.length);
    if (n !== null) start(n, 'playing');
  }, [start]);

  const onTime = useCallback((ms: number) => {
    const now = live.current;
    if (!now.on || now.phase === 'turn') return;
    const tick = shadowTick(timesNow.current, now.line, now.begun, ms);
    now.begun = tick.begun;
    if (!tick.done) return;
    media.current?.pause();
    if (now.phase === 'both') recNow.current.playTake();
    setPhase('turn');
  }, [media]);

  // A podcast's line as a file, for the pitch line and Compare. Kept in the caches folder while the
  // screen is open, and deleted when it closes.
  const made = useRef(new Set<string>());
  const podcast = !!text?.podcast;
  const textId = text?.id;
  useEffect(() => {
    if (!on || !podcast || textId === undefined || line < 0) return;
    let current = true;
    setClipError(null);
    void (async () => {
      try {
        const file = new File(Paths.cache, `shadow-${textId}-${line}.mp3`);
        if (!file.exists) {
          const bytes = await api.lineClip(textId, line);
          file.create({ overwrite: true });
          await file.write(bytes);
          made.current.add(file.uri);
        }
        if (current) setClip({ line, uri: file.uri });
      } catch (e) {
        if (current) setClipError(failureText(e, { what: "Couldn't fetch the line's clip, so there's no pitch line.", next: 'The line still plays from the episode.' }));
      }
    })();
    return () => { current = false; };
  }, [on, podcast, textId, line, api]);
  useEffect(() => () => {
    for (const uri of made.current) {
      try { new File(uri).delete(); } catch { /* already gone */ }
    }
  }, []);

  return { on, line, phase, rec, clipUri, clipError, toggle, playLine, both, next, onTime };
}
