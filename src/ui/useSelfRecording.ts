import {
  getRecordingPermissionsAsync, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync,
  useAudioPlayer, useAudioRecorder, type AudioMode, type RecordingStatus,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { TAKE_LIMIT_SECONDS } from '../core/selfRecording';
import { haptic } from './haptics';

/**
 * Record yourself (src/core/selfRecording.ts): one take of your own voice for whatever `key`
 * names (a card, a line), played back after it's made and on demand. The take is a file in the
 * caches folder, deleted when the key changes, a new take replaces it, or the screen closes.
 *
 * The audio session allows recording only while a take is being made: iOS's play-and-record
 * category sends Bluetooth headphones into call quality, so `mode` (the screen's own audio mode)
 * is put back as soon as the take stops.
 */
export interface SelfRecording {
  recording: boolean;
  /** How long the take being made has run, for the Stop chip. */
  millis: number;
  /** Whether there's a take for the current key. */
  hasTake: boolean;
  start: () => void;
  /** Ends the take and plays it back, unless `playBack` is false (the screen is about to play something). */
  stop: (playBack?: boolean) => void;
  playTake: () => void;
  /** Stops the take playing, before the screen plays something else. */
  stopTake: () => void;
}

export function useSelfRecording(key: string | null, mode: Partial<AudioMode>, opts: {
  /** Called before recording or playing a take, so the screen can stop its own audio first. */
  onBeforeAudio: () => void;
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

  const player = useAudioPlayer(null);
  const playUri = useCallback((uri: string) => {
    before.current();
    player.replace({ uri });
    player.play();
  }, [player]);

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
    if (playAfter.current) playUri(uri);
  };

  const stop = useCallback((playBack = true) => {
    if (!recordingRef.current) return;
    if (playBack) haptic.tap();
    playAfter.current = playBack;
    recorder.stop().then(() => finished.current(), () => finished.current());
  }, [recorder]);

  // A second tap while the first is still asking for the microphone or preparing does nothing.
  const starting = useRef(false);
  const start = useCallback(async () => {
    if (recordingRef.current || starting.current) return;
    starting.current = true;
    haptic.tap();
    const forKey = keyRef.current;
    try {
      if (!(await microphoneAllowed()) || forKey !== keyRef.current) return;
      before.current();
      player.pause();
      try {
        await setAudioModeAsync({ ...modeRef.current, allowsRecording: true });
        await recorder.prepareToRecordAsync();
        if (forKey !== keyRef.current) throw new Error('moved on');
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
  }, [recorder, player]);

  // A new card or line starts with no take; one being made for the old one stops and is dropped.
  useEffect(() => {
    if (recordingRef.current) recorder.stop().then(() => finished.current(), () => finished.current());
    player.pause();
    setTake((old) => {
      if (old) remove(old);
      return null;
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to the key only

  // Leaving the screen: stop, put the audio mode back, delete the take.
  const takeRef = useRef(take);
  takeRef.current = take;
  useEffect(() => () => {
    if (limit.current) clearTimeout(limit.current);
    if (recordingRef.current) {
      recordingRef.current = false;
      recorder.stop().catch(() => undefined);
      setAudioModeAsync(modeRef.current).catch(() => undefined);
    }
    if (takeRef.current) remove(takeRef.current);
  }, [recorder]);

  const stopTake = useCallback(() => player.pause(), [player]);
  return {
    recording,
    millis: recording ? millis : 0,
    hasTake: !!take,
    start: () => { start(); },
    stop,
    playTake: () => { if (take) { haptic.tap(); playUri(take); } },
    stopTake,
  };
}

/** Asks for the microphone the first time; once it's been refused, says where to turn it back on. */
async function microphoneAllowed(): Promise<boolean> {
  try {
    const now = await getRecordingPermissionsAsync();
    if (now.granted) return true;
    if (now.canAskAgain) return (await requestRecordingPermissionsAsync()).granted;
  } catch {
    return false;
  }
  Alert.alert(
    'Microphone is off for Franki',
    'To record yourself, turn on the microphone for Franki in the Settings app.',
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
