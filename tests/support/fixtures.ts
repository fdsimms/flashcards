import { omnilanguageFieldNames } from '../../src/import/models';
import type { Note } from '../../src/core/types';

/**
 * Fixtures are local times (no trailing `Z`). A `...Z` literal read back as a local date names a
 * different day far from Greenwich, so a test built on one passes in UTC and fails in CI's UTC+14.
 */
export const NOW = new Date(2026, 10, 11, 12, 0);

export function omniNote(over: Record<string, string> = {}): Note {
  const fields: Record<string, string> = Object.fromEntries(omnilanguageFieldNames.map((n) => [n, '']));
  Object.assign(fields, { Entry: 'หนังสือ', Meaning: 'book', Language: 'Thai', Transliteration: 'nǎng-sǔue' }, over);
  return { id: 'n1', deck: '👅 Languages::🐘 ภาษาไทย', model: 'Omnilanguage', fields, tags: ['noun'] };
}
