import { planPriorityStamps } from '../core/priority';
import type { DeckSettings, Note } from '../core/types';
import type { Repo } from './repo';

/**
 * Saves when Franki first saw each "tagged cards first" tag on a note (`planPriorityStamps`) and
 * returns the settings as they are now. Anki doesn't record when a tag was added, so this is the
 * start of the note's window. Nothing is written unless a stamp changes.
 */
export async function applyPriorityStamps(repo: Pick<Repo, 'saveDeckSettings'>, notes: Note[], settings: Map<string, DeckSettings>, now: Date): Promise<Map<string, DeckSettings>> {
  const changes = planPriorityStamps(notes, settings, now);
  if (!changes.size) return settings;
  const next = new Map(settings);
  for (const [deck, s] of changes) {
    await repo.saveDeckSettings(deck, s);
    next.set(deck, s);
  }
  return next;
}
