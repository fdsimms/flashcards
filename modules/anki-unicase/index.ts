import { requireOptionalNativeModule } from 'expo';

/**
 * Anki's `unicase` collation for every SQLite connection opened after `registerUnicase()`, so the
 * sync can write Anki's decks, deck options, note types and tags (see ios/unicase_register.c).
 * False when the running build doesn't include the module (a build made before it was added),
 * in which case the sync downloads whole collections instead of merging those tables.
 */
export function registerUnicase(): boolean {
  const mod = requireOptionalNativeModule<{ register(): boolean }>('AnkiUnicase');
  try {
    return mod?.register() ?? false;
  } catch {
    return false;
  }
}
