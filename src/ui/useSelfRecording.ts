import {
  getRecordingPermissionsAsync, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync,
  useAudioPlayer, useAudioRecorder, type AudioMode, type AudioSource, type RecordingStatus,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { TAKE_LIMIT_SECONDS } from '../core/selfRecording';
import { haptic } from './haptics';
import { useOutputWake } from './useOutputWake';

/**
 * Record yourself (src/core/selfRecording.ts): one take of your own voice for whatever `key`
 * names (a card, a line), played on demand, alone or after the native recording (Compare). The take is a file in the
 * caches folder, deleted when the key changes, a new take replaces it, or the screen closes.
 *
 * The audio session allows recording only while a take is being made: iOS's play-and-record
 * category sends Bluetooth headphones into call quality, so `mode` (the screen's own audio mode)
 * is put back as soon as the take stops.
 */
/** The native recording Compare plays before the take, with the speed it plays at (1 when left out). */
export interface CompareOriginal {
  source: AudioSource;
  rate?: number;
}

/** What the take's player is doing: the take alone, or Compare's two halves in turn. */
export type SelfPlaying = 'take' | 'compare-original' | 'compare-take' | null;

export interface SelfRecording {
  recording: boolean;
  /** How long the take being made has run, for the Stop chip. */
  millis: number;
  /** Whether there's a take for the current key. */
  hasTake: boolean;
  /** The take's file, for the pitch line (PitchLine.tsx); null with none. */
  takeUri: string | null;
  start: () => void;
  /** Ends the take and plays it back, unless `playBack` is false (the screen is about to play something). */
  stop: (playBack?: boolean) => void;
  /** Whether Compare is offered: there's a take and the screen has a native recording to play before it. */
  canCompare: boolean;
  playing: SelfPlaying;
  /** Plays the take, or stops it while it plays. */
  playTake: () => void;
  /** Plays the native recording, then the take, or stops them while they play. */
  compare: () => void;
  /** Stops the take or Compare playing, before the screen plays something else. */
  stopTake: () => void;
}

export function useSelfRecording(key: string | null, mode: Partial<AudioMode>, opts: {
  /** Called before recording or playing a take, so the screen can stop its own audio first. */
  onBeforeAudio: () => void;
  /** What Compare plays before the take, for the key now; null when there's no native recording (no Compare). */
  original?: (() => CompareOriginal | Promise<CompareOriginal>) | null;
}): SelfRecording {
  const [take, setTake] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  // The key the take being made belongs to: a take that ends after the key moved on is thrown away.
  const recordingFor = useRef<string | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const before = useRef(opts.onBeforeAudio);
  before.current = opts.onBeforeAudio;
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playAfter = useRef(true);
  const original = useRef(opts.original);
  original.current = opts.original;

  const player = useAudioPlayer(null);
  // Bluetooth headphones that have been quiet lose the start of the next sound (useOutputWake): a take
  // or a Compare starts once they're awake. Compare going on to the take follows straight on, so it doesn't wait.
  const wake = useOutputWake();
  const [playing, setPlaying] = useState<SelfPlaying>(null);
  // What the player is on, read when a clip ends (the listener below outlives a render), and a count
  // of plays started so a Compare still loading its first clip gives way to whatever was tapped since.
  const playingRef = useRef<SelfPlaying>(null);
  const plays = useRef(0);
  const setPlayingNow = useCallback((to: SelfPlaying) => { playingRef.current = to; setPlaying(to); }, []);
  const playUri = useCallback((uri: string) => {
    before.current();
    player.setPlaybackRate(1, 'high');
    player.replace({ uri });
    setPlayingNow(playingRef.current === 'compare-original' ? 'compare-take' : 'take');
    player.play();
  }, [player, setPlayingNow]);
  const takeUri = useRef<string | null>(null);
  // Compare goes on to the take when the native recording ends; anything else that ends just stops.
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (!status.didJustFinish) return;
      if (playingRef.current === 'compare-original' && takeUri.current) playUri(takeUri.current);
      else setPlayingNow(null);
    });
    return () => sub.remove();
  }, [player, playUri, setPlayingNow]);

  // A take ends here whichever way it stopped: Stop, the time limit, or iOS ending it (a call).
  const finished = useRef<(status?: RecordingStatus) => void>(() => undefined);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status) => {
    if (status.isFinished || status.hasError) finished.current(status);
  });
  // The Stop chip's clock, counted here rather than by polling the recorder while nothing records.
  const [millis, setMillis] = useState(0);
  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    setMillis(0);
    const tick = setInterval(() => setMillis(Date.now() - startedAt), 250);
    return () => clearInterval(tick);
  }, [recording]);

  finished.current = (status) => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    if (limit.current) clearTimeout(limit.current);
    limit.current = null;
    setRecording(false);
    setAudioModeAsync(modeRef.current).catch(() => undefined);
    const uri = status?.url ?? recorder.uri;
    if (!uri || status?.hasError || recordingFor.current !== keyRef.current) {
      if (uri) remove(uri);
      return;
    }
    setTake((old) => {
      if (old && old !== uri) remove(old);
      return uri;
    });
    if (!playAfter.current) return;
    const mine = ++plays.current;
    void wake().then(() => { if (plays.current === mine) playUri(uri); });
  };

  const stop = useCallback((playBack = true) => {
    if (!recordingRef.current) return;
    if (playBack) haptic.tap();
    playAfter.current = playBack;
    recorder.stop().then(() => finished.current(), () => finished.current());
  }, [recorder]);

  // A second tap while the first is still asking for the microphone or preparing does nothing.
  const starting = useRef(false);
  // The screen can be left while start is awaiting the microphone or the recorder, and the cleanup
  // below only stops a take already running: this keeps a late start from recording after it.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const start = useCallback(async () => {
    if (recordingRef.current || starting.current) return;
    starting.current = true;
    haptic.tap();
    const forKey = keyRef.current;
    try {
      if (!(await microphoneAllowed()) || forKey !== keyRef.current || !mounted.current) return;
      before.current();
      plays.current++;
      player.pause();
      setPlayingNow(null);
      try {
        await setAudioModeAsync({ ...modeRef.current, allowsRecording: true });
        await recorder.prepareToRecordAsync();
        if (forKey !== keyRef.current || !mounted.current) throw new Error('moved on');
        recorder.record();
      } catch {
        setAudioModeAsync(modeRef.current).catch(() => undefined);
        return;
      }
    } finally {
      starting.current = false;
    }
    recordingRef.current = true;
    recordingFor.current = forKey;
    playAfter.current = true;
    setRecording(true);
    limit.current = setTimeout(() => { recorder.stop().then(() => finished.current(), () => finished.current()); }, TAKE_LIMIT_SECONDS * 1000);
  }, [recorder, player, setPlayingNow]);

  // A new card or line starts with no take; one being made for the old one stops and is dropped.
  useEffect(() => {
    if (recordingRef.current) recorder.stop().then(() => finished.current(), () => finished.current());
    plays.current++;
    player.pause();
    setPlayingNow(null);
    setTake((old) => {
      if (old) remove(old);
      return null;
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to the key only

  // Leaving the screen: stop, put the audio mode back, delete the take.
  const takeRef = useRef(take);
  takeRef.current = take;
  takeUri.current = take;
  useEffect(() => () => {
    if (limit.current) clearTimeout(limit.current);
    if (recordingRef.current) {
      recordingRef.current = false;
      recorder.stop().catch(() => undefined);
      setAudioModeAsync(modeRef.current).catch(() => undefined);
    }
    if (takeRef.current) remove(takeRef.current);
  }, [recorder]);

  const stopTake = useCallback(() => {
    plays.current++;
    player.pause();
    setPlayingNow(null);
  }, [player, setPlayingNow]);
  const playTake = () => {
    if (!take) return;
    haptic.tap();
    if (playingRef.current) { stopTake(); return; }
    const mine = ++plays.current;
    const uri = take;
    void wake().then(() => { if (plays.current === mine) playUri(uri); });
  };
  const compare = () => {
    const load = original.current;
    if (!take || !load) return;
    haptic.tap();
    if (playingRef.current) { stopTake(); return; }
    const mine = ++plays.current;
    const forKey = keyRef.current;
    // The native recording may be fetched first (a line's audio comes from the server), so a tap or a
    // new card meanwhile wins over it.
    Promise.resolve(load()).then(async (first) => {
      if (plays.current !== mine || forKey !== keyRef.current) return;
      await wake();
      if (plays.current !== mine || forKey !== keyRef.current) return;
      before.current();
      player.replace(first.source);
      player.setPlaybackRate(first.rate ?? 1, 'high');
      setPlayingNow('compare-original');
      player.play();
    }, () => undefined);
  };
  return {
    recording,
    millis: recording ? millis : 0,
    hasTake: !!take,
    takeUri: take,
    start: () => { start(); },
    stop,
    canCompare: !!take && !!original.current,
    playing,
    playTake,
    compare,
    stopTake,
  };
}

/** Asks for the microphone the first time; once it's been refused, says where to turn it back on, for `purpose` ("record yourself"). */
export async function microphoneAllowed(purpose = 'record yourself'): Promise<boolean> {
  try {
    const now = await getRecordingPermissionsAsync();
    if (now.granted) return true;
    if (now.canAskAgain) return (await requestRecordingPermissionsAsync()).granted;
  } catch {
    return false;
  }
  Alert.alert(
    'Microphone is off for Franki',
    `To ${purpose}, turn on the microphone for Franki in the Settings app.`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => undefined); } }],
  );
  return false;
}

function remove(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch { /* already gone */ }
}
