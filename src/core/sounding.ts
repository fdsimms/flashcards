/**
 * Which button's sound is playing now, so a play button can turn into a pause button while its
 * audio runs and stop it when tapped again. Nothing here plays audio: whatever does (the phone's
 * voice, a recording) reports `begin` and `end`, and a button reports that it was pressed.
 *
 * A sound belongs to the button pressed last: a screen's other play buttons stay play buttons while
 * it sounds, and audio nobody pressed for (autoplay) shows no pause button at all. Only the latest
 * sound counts: `end` with an old token (a stopped sound's callback arriving after the next one
 * began) leaves the new one alone. Starting a sound doesn't stop the previous one; the code that
 * plays already does that, and a second stop here could cut off a queued utterance.
 */
export interface Sounding {
  /** A sound started. `stop` ends it. Returns the token `end` takes. */
  begin(stop: () => void): number;
  /** The sound that started with `token` finished or was stopped. A token that is no longer the current one is ignored. */
  end(token: number): void;
  /** The button `id` was pressed. */
  press(id: unknown): void;
  /** Stops the sound that's playing, if any. */
  stop(): void;
  /** Whether a sound is playing and `id` is the button pressed last. */
  playing(id: unknown): boolean;
  /** When the last sound ended (ms since the epoch), -Infinity before any, or null while one plays. */
  quietSince(): number | null;
  subscribe(listener: () => void): () => void;
}

export function createSounding(clock: () => number = Date.now): Sounding {
  let next = 0;
  let current: { token: number; stop: () => void } | null = null;
  let quietAt = Number.NEGATIVE_INFINITY;
  let pressed: unknown = null;
  const listeners = new Set<() => void>();
  const emit = () => { for (const l of [...listeners]) l(); };
  return {
    begin(stop) {
      const token = ++next;
      current = { token, stop };
      emit();
      return token;
    },
    end(token) {
      if (current?.token !== token) return;
      current = null;
      quietAt = clock();
      emit();
    },
    press(id) {
      if (pressed === id) return;
      pressed = id;
      emit();
    },
    stop() {
      const c = current;
      if (!c) return;
      current = null;
      quietAt = clock();
      try { c.stop(); } catch { /* already gone */ }
      emit();
    },
    playing: (id) => current !== null && pressed === id,
    quietSince: () => (current ? null : quietAt),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The app's one: every play button and every sound reports here. */
export const sounding = createSounding();
