import { requireOptionalNativeModule } from 'expo';

const mod = requireOptionalNativeModule<{ decode(uri: string, sampleRate: number, maxSeconds: number): Promise<number[]> }>('AudioSamples');

/** The rate audio is decoded at for the pitch line: plenty for a voice's pitch (under 500 Hz), and few samples to measure. */
export const PITCH_SAMPLE_RATE = 8000;

/** The most of a file decoded: a word, or a short phrase, with room to spare. */
const MAX_SECONDS = 8;

/**
 * A file on the phone (a take, a card's recording) as mono samples at `PITCH_SAMPLE_RATE`, decoded on
 * the phone. Null in a build made before this module was added; throws when the file can't be read.
 */
export async function decodeForPitch(uri: string): Promise<Float32Array | null> {
  if (!mod) return null;
  return Float32Array.from(await mod.decode(uri, PITCH_SAMPLE_RATE, MAX_SECONDS));
}
