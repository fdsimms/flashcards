import * as SecureStore from 'expo-secure-store';
import { parseNarrator, parseParticle, type Particle } from './lessons';

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
