import { requireOptionalNativeModule } from 'expo';

const mod = requireOptionalNativeModule<{ set(language: string | null): Promise<void>; enabled?(language: string): Promise<boolean> }>('KeyboardLanguage');

/**
 * Whether the person has a keyboard enabled for `language` (a primary subtag, "th"). Undefined when
 * it can't be told: a build made before this was added.
 */
export async function keyboardEnabled(language: string): Promise<boolean | undefined> {
  try {
    return mod?.enabled ? await mod.enabled(language) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Asks iOS to open the focused text field on the keyboard for `language` (primary subtags in order,
 * joined with commas: "ru", or "pl,en" for Polish else English), or hands the choice back with null.
 * Passes over a language the person hasn't enabled a keyboard for, and does nothing in a build made
 * before this module was added (or, for a list, before it took one: "pl,en" then matches nothing).
 */
export function setKeyboardLanguage(language: string | null): void {
  try {
    mod?.set(language).catch(() => {});
  } catch {
    // The keyboard stays as it was.
  }
}
