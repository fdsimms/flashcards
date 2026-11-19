import type { AudioMode } from 'expo-audio';

/**
 * The audio session while Read & Listen or an audio lesson is open. 'doNotMix' pauses whatever else is
 * playing (a podcast) and makes Franki the app on the lock screen's Now Playing controls; with the
 * default mixing, the other app keeps playing and keeps those controls.
 */
export const LISTENING_MODE: Partial<AudioMode> = {
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'doNotMix',
};

/** The audio session once listening ends: card audio and the like mix with other apps again. */
export const IDLE_MODE: Partial<AudioMode> = {
  playsInSilentMode: true,
  shouldPlayInBackground: false,
  interruptionMode: 'mixWithOthers',
};
