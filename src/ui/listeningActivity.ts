import type { AudioPlayer } from 'expo-audio';
import { listeningActivityNative } from '../../modules/listening-activity';
import { prefs } from '../reader/storage';
import {
  activityStep, idleExpired, IDLE_END_MS, kindLabel, parseAction, type Listening, type Sent, type Snapshot,
} from '../reader/listeningActivity';

/**
 * The listening Live Activity (lock screen and Dynamic Island) for the shared reader player: an audio
 * lesson or a Read & Listen text playing. What it shows and when it's told something is
 * src/reader/listeningActivity.ts; this is the one place that owns the activity, so the reader, a
 * lesson's screen and the tab bar's mini-player all go through it. They `begin` it with what's
 * playing and who answers the buttons (the latest owner's win: a screen handing over to the
 * mini-player calls `begin` again with the same listening, which keeps the activity and swaps the
 * buttons), and `end` it when they stop.
 *
 * It follows the player through one listener, so a progress tick re-renders nothing. The buttons run
 * in the app's process without opening it (ListeningControlIntent.swift); the app stays alive for
 * them through its background audio.
 */

export interface ListeningControls {
  previous: () => void;
  toggle: () => void;
  next: () => void;
}

const native = listeningActivityNative;

let player: AudioPlayer | null = null;
let listening: Listening | null = null;
let controls: (() => ListeningControls) | null = null;
let sent: Sent | null = null;
let skipsBySeconds = false;
let pausedSince: number | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let actions: { remove: () => void } | null = null;

function snapshot(): Snapshot {
  return {
    playing: player?.playing ?? false,
    position: Math.max(0, player?.currentTime ?? 0),
    duration: Math.max(0, player?.duration ?? 0),
  };
}

function clearIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  pausedSince = null;
}

/** Tells the activity what changed, if anything did. */
function sync(snap: Snapshot = snapshot()) {
  if (!native || !listening) return;
  const now = Date.now();
  const step = activityStep(sent, listening, snap, now);
  if (snap.playing) clearIdle();
  else if (pausedSince === null) {
    pausedSince = now;
    idleTimer = setTimeout(() => { if (idleExpired(pausedSince, Date.now())) end(); }, IDLE_END_MS);
  }
  if (step === null) return;
  try {
    if (step === 'start') {
      native.start(listening.title, kindLabel(listening.kind), skipsBySeconds, snap.playing, listening.detail, snap.position, snap.duration);
    } else {
      native.update(snap.playing, listening.detail, snap.position, snap.duration);
    }
    sent = { ...snap, listening: { ...listening }, at: now };
  } catch {
    // The activity is a convenience on top of the lock screen's own controls: a refusal changes nothing.
  }
}

function onAction(event: { action: string }) {
  const action = parseAction(event.action);
  const c = controls?.();
  if (!action || !c) return;
  c[action]();
}

/** Follows `shared` for the rest of the app's life; the same player is only attached once. */
export function attachListeningPlayer(shared: AudioPlayer) {
  if (player === shared) return;
  player = shared;
  shared.addListener('playbackStatusUpdate', (status) => {
    // A lesson that played to its end is over; a text's line ending is only the next line starting.
    if (status.didJustFinish && listening?.kind === 'lesson') { end(); return; }
    sync({ playing: status.playing, position: Math.max(0, status.currentTime), duration: Math.max(0, status.duration) });
  });
}

/**
 * Something is playing, or about to: show it, with `buttons` answering the activity's buttons. Called
 * again with the same title it keeps the activity and only changes who answers.
 */
export function beginListening(what: Listening, buttons: () => ListeningControls) {
  if (!native || !prefs().listeningActivity) return;
  listening = what;
  controls = buttons;
  skipsBySeconds = what.kind === 'lesson';
  actions ??= native.addListener('onAction', onAction);
  sync();
}

/** What a text's activity says changed (the line); the title and the buttons stay. */
export function setListeningDetail(detail: string) {
  if (!listening || listening.detail === detail) return;
  listening = { ...listening, detail };
  sync();
}

/** Nothing is playing any more. */
export function endListening() {
  end();
}

function end() {
  clearIdle();
  listening = null;
  controls = null;
  sent = null;
  if (!native) return;
  actions?.remove();
  actions = null;
  try { native.end(); } catch { /* nothing to end */ }
}
