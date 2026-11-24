/**
 * Waking Bluetooth headphones before a word. Their link sleeps after a few seconds of quiet, and
 * the first half second or so of the next sound is lost while it wakes: all of a one-word
 * recording. On AirPods a card's word stayed silent on Show answer at random (after the learner had
 * thought for a while), and Play right after worked, the lost word having woken the link. Near
 * silence played first (`useOutputWake`, src/ui/useOutputWake.ts) takes the loss instead.
 */

/** How long the app's sound can be quiet before Bluetooth headphones may have let their link sleep. */
export const WAKE_AFTER_QUIET_MS = 1500;
/** How long the silence plays before the word starts. */
export const WAKE_LEAD_MS = 600;

/**
 * Whether to wake the output before a sound: only for Bluetooth (`bluetooth` null when the build
 * can't tell, which leaves it alone), and only after `WAKE_AFTER_QUIET_MS` of quiet, so words
 * played one after another aren't held up. `quietSince` is `sounding.quietSince()`: null while a
 * sound plays.
 */
export function needsWake(bluetooth: boolean | null, quietSince: number | null, now: number): boolean {
  return bluetooth === true && quietSince !== null && now - quietSince >= WAKE_AFTER_QUIET_MS;
}
