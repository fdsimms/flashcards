import {
  createAudioPlayer, RecordingPresets, setAudioModeAsync, useAudioRecorder, type AudioMode, type AudioPlayer,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api, AudioLesson } from '../reader/api';
import { loadTurnPrefs, saveTurnPref, type TurnPrefs } from '../reader/lessonStorage';
import { markOf, scriptOf, slowAnswer, takeAfter, turnAt, type MarkReason, type ScriptEntry, type ScriptTurn } from '../reader/lessonScript';
import { pauseAt, pausesOf, type Pause } from '../reader/lessonWaits';
import { startVoice, voiceTick, type VoiceState } from '../reader/voiceEnd';
import type { LessonWaits } from './useLessonWaits';
import { microphoneAllowed } from './useSelfRecording';

/** How often the microphone's level is read while the learner answers. */
const METER_MS = 100;
/** Held longer than this, the learner was away rather than slow: the phrase isn't noted for a review. */
const AWAY_MS = 60_000;

/** The audio session for a lesson: playing in the background, and recording too while a microphone setting is on. */
export function lessonAudioMode(recording: boolean): Partial<AudioMode> {
  return { playsInSilentMode: true, shouldPlayInBackground: true, allowsRecording: recording };
}

export interface LessonTurns extends TurnPrefs {
  setListen: (on: boolean) => void;
  setPlayBack: (on: boolean) => void;
  /** Whether a lesson's audio session should allow recording now (a microphone setting is on, and applies). */
  wantsRecording: () => boolean;
  /** Recording the learner's answer at a turn now. */
  recording: boolean;
  /** The take of the last turn, and whether it's playing: for the player's two rows. */
  take: { turn: ScriptTurn; playing: boolean } | null;
  /** The lesson now on the player, with the server to note phrases on; null once nothing is. */
  watch: (lesson: AudioLesson | null, api?: Api | null) => void;
  /** Again, at a turn: its question (or the line to repeat) once more, and the phrase noted for a review. */
  again: () => void;
  /** Whether Again can be offered now: held at a turn of a lesson with a transcript. */
  canAgain: boolean;
  /** The answer and then the take once more (the Recording row). */
  replayAnswer: () => void;
  /** The take alone (the You row). */
  playTake: () => void;
}

type Recording = { turn: Pause; script: ScriptTurn | null; voice: VoiceState; uri: string | null };

/**
 * The learner's turns in an audio lesson (docs/read-and-listen/architecture.md, Audio lessons), on
 * Read & Listen's shared player beside useLessonWaits, so they go on in the mini-player too:
 * - Carry on when I stop talking: at a turn the lesson waits at, the microphone's level says when
 *   the answer is done (voiceEnd.ts), and the lesson goes on as Continue would.
 * - Play my answer back: the answer is recorded at each turn, and played once the native voice has
 *   given it (lessonScript.takeAfter). Kept in the caches folder until the next turn; never saved or sent.
 * - Again, and answers slower than the lesson's own pause, note the turn's phrase for a review.
 * Only the level is read, never the words; nothing said leaves the phone.
 */
export function useLessonTurns(player: AudioPlayer, waits: LessonWaits): LessonTurns {
  const [prefs, setPrefs] = useState<TurnPrefs>({ listen: false, playBack: false });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    let live = true;
    loadTurnPrefs().then((p) => { if (live) setPrefs(p); });
    return () => { live = false; };
  }, []);

  const lesson = useRef<{ id: number; script: ScriptEntry[] | null; pauses: Pause[]; api: Api | null } | null>(null);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const rec = useRef<Recording | null>(null);
  const [recording, setRecording] = useState(false);
  // The last take: where it plays, and whether it has.
  const takeRef = useRef<{ uri: string; turn: ScriptTurn; at: number; played: boolean } | null>(null);
  const [take, setTake] = useState<LessonTurns['take']>(null);
  const takePlayer = useRef<AudioPlayer | null>(null);
  takePlayer.current ??= createAudioPlayer(null);
  // After the take, the lesson goes on, unless it was played on its own (the You row).
  const resumeAfterTake = useRef(false);
  const waitsRef = useRef(waits);
  waitsRef.current = waits;

  const applies = (p: TurnPrefs) => p.playBack || (p.listen && waitsRef.current.on);

  const note = useCallback((turn: ScriptTurn | null, reason: MarkReason) => {
    const l = lesson.current;
    const mark = turn ? markOf(turn, reason) : null;
    if (l?.api && mark) l.api.markLessonPhrase(l.id, mark).catch(() => undefined);
  }, []);

  const dropTake = useCallback(() => {
    const t = takeRef.current;
    takeRef.current = null;
    setTake(null);
    takePlayer.current!.pause();
    if (t) remove(t.uri);
  }, []);

  const startRecording = useCallback(async (turn: Pause) => {
    if (rec.current) return;
    const l = lesson.current;
    const mine: Recording = { turn, script: l?.script ? turnAt(l.script, turn[0] / 1000 + 0.01) : null, voice: startVoice(Date.now()), uri: null };
    rec.current = mine;
    setRecording(true);
    try {
      await recorder.prepareToRecordAsync();
      if (rec.current !== mine) return;
      recorder.record();
    } catch {
      if (rec.current === mine) { rec.current = null; setRecording(false); }
    }
  }, [recorder]);

  /** Ends the take being made; kept to play after the answer when Play my answer back is on. */
  const stopRecording = useCallback(async (keep: boolean) => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setRecording(false);
    try { await recorder.stop(); } catch { /* stopped already */ }
    // A recording ending can leave the session set for it; the lesson's own is put back.
    if (lesson.current) setAudioModeAsync(lessonAudioMode(applies(prefsRef.current))).catch(() => undefined);
    const uri = recorder.uri;
    const script = lesson.current?.script;
    if (!uri) return;
    if (!keep || !prefsRef.current.playBack || !r.script || !script) { remove(uri); return; }
    if (takeRef.current) remove(takeRef.current.uri);
    takeRef.current = { uri, turn: r.script, at: takeAfter(script, r.script), played: false };
    setTake({ turn: r.script, playing: false });
  }, [recorder]);

  const playTakeNow = useCallback((thenResume: boolean) => {
    const t = takeRef.current;
    if (!t) return;
    t.played = true;
    resumeAfterTake.current = thenResume;
    player.pause();
    takePlayer.current!.replace({ uri: t.uri });
    takePlayer.current!.play();
    setTake({ turn: t.turn, playing: true });
  }, [player]);

  // The take ends: the lesson goes on, if the take came in its course.
  useEffect(() => {
    const sub = takePlayer.current!.addListener('playbackStatusUpdate', (status) => {
      if (!status.didJustFinish) return;
      const t = takeRef.current;
      if (t) setTake({ turn: t.turn, playing: false });
      if (resumeAfterTake.current) { resumeAfterTake.current = false; player.play(); }
    });
    return () => sub.remove();
  }, [player]);

  // The lesson's position: recording through a turn it doesn't wait at, and the take once the answer is given.
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      const l = lesson.current;
      if (!l || !status.playing) return;
      const ms = status.currentTime * 1000;
      const t = takeRef.current;
      if (t && !t.played && ms >= t.at) { playTakeNow(true); return; }
      if (!prefsRef.current.playBack || waitsRef.current.on) return;
      // Not waiting: the take is the lesson's own silence.
      const index = pauseAt(l.pauses, status.currentTime);
      const r = rec.current;
      if (index !== -1 && !r) { dropTake(); void startRecording(l.pauses[index]); }
      else if (r && (index === -1 || l.pauses[index] !== r.turn)) void stopRecording(true);
    });
    return () => sub.remove();
  }, [player, playTakeNow, dropTake, startRecording, stopRecording]);

  // Waiting at a turn: record it, for Carry on or Play my answer back. Going on ends the take, and an
  // answer that took longer than the lesson's pause notes the phrase.
  const heldAt = useRef<number | null>(null);
  useEffect(() => {
    const l = lesson.current;
    if (waits.held) {
      heldAt.current = Date.now();
      if (!l || !applies(prefsRef.current)) return;
      const index = pauseAt(l.pauses, player.currentTime);
      if (index === -1) return;
      dropTake();
      void startRecording(l.pauses[index]);
      return;
    }
    const since = heldAt.current;
    heldAt.current = null;
    const r = rec.current;
    if (since !== null && r?.script) {
      const took = Date.now() - since;
      if (took < AWAY_MS && slowAnswer(r.script, took)) note(r.script, 'slow');
    }
    void stopRecording(true);
  }, [waits.held]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to holding and going on only

  // Carry on when I stop talking: the microphone's level, read while a held turn is recorded.
  useEffect(() => {
    if (!recording || !waits.held || !prefs.listen) return;
    const meter = setInterval(() => {
      const r = rec.current;
      if (!r) return;
      const step = voiceTick(r.voice, { db: recorder.getStatus().metering ?? Number.NaN, now: Date.now() });
      r.voice = step.state;
      if (step.done) waitsRef.current.goOn();
    }, METER_MS);
    return () => clearInterval(meter);
  }, [recording, waits.held, prefs.listen, recorder]);

  const watch = useCallback((next: AudioLesson | null, api?: Api | null) => {
    void stopRecording(false);
    dropTake();
    lesson.current = next ? { id: next.id, script: scriptOf(next), pauses: pausesOf(next), api: api ?? null } : null;
  }, [stopRecording, dropTake]);

  // A setting changed while a lesson is on: the session allows recording only while one needs it.
  useEffect(() => {
    if (!lesson.current) return;
    setAudioModeAsync(lessonAudioMode(applies(prefs))).catch(() => undefined);
  }, [prefs, waits.on]); // eslint-disable-line react-hooks/exhaustive-deps -- `applies` reads the same refs

  const setPref = useCallback(async (pref: keyof TurnPrefs, on: boolean) => {
    if (on && !(await microphoneAllowed('hear your answers in a lesson'))) return;
    setPrefs((p) => ({ ...p, [pref]: on }));
    saveTurnPref(pref, on);
    if (!on) void stopRecording(false);
  }, [stopRecording]);

  const again = useCallback(() => {
    const l = lesson.current;
    const turn = l?.script ? turnAt(l.script, player.currentTime) : null;
    if (!turn) return;
    void stopRecording(false);
    note(turn, 'again');
    heldAt.current = null;
    player.seekTo(turn.replay / 1000).then(() => waitsRef.current.moved(), () => undefined);
  }, [player, note, stopRecording]);

  const replayAnswer = useCallback(() => {
    const t = takeRef.current;
    const script = lesson.current?.script;
    if (!t || !script) return;
    takePlayer.current!.pause();
    resumeAfterTake.current = false;
    const asked = t.at > t.turn.end;
    // A question's answer comes after the turn, and the take plays again after it. A repeat's line
    // was heard before the turn: heard again, the lesson comes back to the turn for another try.
    const from = asked
      ? script.find((e) => e.kind === 'say' && e.start >= t.turn.end)?.start
      : script.filter((e) => e.kind === 'say' && e.end <= t.turn.start).pop()?.start;
    if (from === undefined) return;
    if (asked) t.played = false;
    player.seekTo(from / 1000).then(() => player.play(), () => undefined);
  }, [player]);

  const canAgain = waits.held && !!lesson.current?.script && !!turnAt(lesson.current.script, player.currentTime);

  // Leaving it all: the take's file goes.
  useEffect(() => () => { dropTake(); takePlayer.current?.remove(); }, [dropTake]);

  return {
    ...prefs,
    setListen: (on) => { void setPref('listen', on); },
    setPlayBack: (on) => { void setPref('playBack', on); },
    wantsRecording: () => applies(prefsRef.current),
    recording,
    take,
    watch,
    again,
    canAgain,
    replayAnswer,
    playTake: () => playTakeNow(false),
  };
}

function remove(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch { /* already gone */ }
}
