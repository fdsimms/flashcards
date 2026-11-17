import { requireOptionalNativeModule } from 'expo';

const mod = requireOptionalNativeModule<{ supportsOnDevice(locale: string): boolean }>('SpeechOnDevice');

/**
 * Whether iOS recognizes speech in `locale` on the phone, so it can be heard with no connection;
 * null when that can't be told (a build made before this module was added).
 */
export function supportsOnDevice(locale: string): boolean | null {
  try {
    return mod ? mod.supportsOnDevice(locale) : null;
  } catch {
    return null;
  }
}
