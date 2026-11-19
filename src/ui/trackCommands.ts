import { listeningActivityNative } from '../../modules/listening-activity';

/**
 * The lock screen's, Control Center's and headphones' next and previous track buttons, for Up Next
 * (useAudioQueue.ts). expo-audio offers them only for its playlist player, and turns them off each
 * time a player is shown on the lock screen, so the listening-activity module takes them over
 * (ListeningActivityModule.swift, `setTrackCommands`): call this after each `setActiveForLockScreen`
 * while the shared player plays Up Next, and with false when it stops. A build from before the
 * module had them does nothing here, and the lock screen keeps play and pause.
 */
export function setTrackCommands(enabled: boolean) {
  try {
    listeningActivityNative?.setTrackCommands?.(enabled);
  } catch {
    // The buttons are a convenience: play and pause still work without them.
  }
}

/** Calls `onStep` for each press of next (1) or previous (-1); returns the unsubscribe. */
export function onTrackCommand(onStep: (step: -1 | 1) => void): () => void {
  if (!listeningActivityNative?.setTrackCommands) return () => undefined;
  const sub = listeningActivityNative.addListener('onTrack', (e) => {
    if (e.action === 'next') onStep(1);
    else if (e.action === 'previous') onStep(-1);
  });
  return () => sub.remove();
}
