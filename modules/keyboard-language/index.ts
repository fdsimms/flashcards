import { requireOptionalNativeModule } from 'expo';

const mod = requireOptionalNativeModule<{ set(language: string | null): Promise<void> }>('KeyboardLanguage');

/**
 * Asks iOS to open the focused text field on the keyboard for `language` (a primary subtag, "ru"),
 * or hands the choice back with null. Does nothing when the person hasn't enabled a keyboard for it,
 * and in a build made before this module was added.
 */
export function setKeyboardLanguage(language: string | null): void {
  try {
    mod?.set(language).catch(() => {});
  } catch {
    // The keyboard stays as it was.
  }
}
