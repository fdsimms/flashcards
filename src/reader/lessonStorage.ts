import * as SecureStore from 'expo-secure-store';
import { parseNarrator, parseParticle, type Particle } from './lessons';
import { parseWait } from './lessonWaits';

/** The English voice that narrates audio lessons, kept in the Keychain beside the reader's other settings: this phone's own. '' is the server's own. */
const NARRATOR_KEY = 'reader.lessonNarrator';

export async function loadNarrator(): Promise<string> {
  try {
    return parseNarrator(await SecureStore.getItemAsync(NARRATOR_KEY));
  } catch {
    return '';
  }
}

/** A failed save only means the choice resets next launch. */
export function saveNarrator(voice: string): void {
  SecureStore.setItemAsync(NARRATOR_KEY, voice).catch(() => undefined);
}

/** The polite ending Thai lessons are made for, kept the same way: ครับ unless chosen otherwise. */
const PARTICLE_KEY = 'reader.lessonParticle';

export async function loadParticle(): Promise<Particle> {
  try {
    return parseParticle(await SecureStore.getItemAsync(PARTICLE_KEY));
  } catch {
    return 'khrap';
  }
}

export function saveParticle(particle: Particle): void {
  SecureStore.setItemAsync(PARTICLE_KEY, particle).catch(() => undefined);
}

/** Whether a lesson stops at each place the learner speaks and waits for Continue (lessonWaits.ts), kept the same way: off unless turned on. */
const WAIT_KEY = 'reader.lessonWait';

export async function loadWait(): Promise<boolean> {
  try {
    return parseWait(await SecureStore.getItemAsync(WAIT_KEY));
  } catch {
    return false;
  }
}

export function saveWait(on: boolean): void {
  SecureStore.setItemAsync(WAIT_KEY, on ? 'on' : 'off').catch(() => undefined);
}

/**
 * The lesson player's microphone settings, kept the same way and off unless turned on: Carry on when
 * I stop talking (`listen`) and Play my answer back (`playBack`), useLessonTurns.
 */
export type TurnPrefs = { listen: boolean; playBack: boolean };
const TURN_KEYS: Record<keyof TurnPrefs, string> = { listen: 'reader.lessonListen', playBack: 'reader.lessonPlayBack' };

export async function loadTurnPrefs(): Promise<TurnPrefs> {
  const read = async (key: string) => {
    try {
      return parseWait(await SecureStore.getItemAsync(key));
    } catch {
      return false;
    }
  };
  return { listen: await read(TURN_KEYS.listen), playBack: await read(TURN_KEYS.playBack) };
}

export function saveTurnPref(pref: keyof TurnPrefs, on: boolean): void {
  SecureStore.setItemAsync(TURN_KEYS[pref], on ? 'on' : 'off').catch(() => undefined);
}
