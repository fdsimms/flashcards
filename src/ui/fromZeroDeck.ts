import { saveDeckNewLimit } from '../anki/presetService';
import { goalTarget } from '../core/dailyGoal';
import { FROM_ZERO_NEW_PER_DAY } from '../core/fromZero';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';

/**
 * A deck started from zero takes `FROM_ZERO_NEW_PER_DAY` new cards a day (src/core/fromZero.ts), where the
 * limit is the deck's to set: its own Anki limit, or Franki's for a deck with no preset. Not under a daily
 * goal or a progress gate, which set it themselves. Kept apart from fromZeroActions.ts, which talks to Read &
 * Listen and so may not import a database writer (tests/reader/noGrading.test.ts).
 */
export async function setFromZeroNewPerDay(repo: Repo & AnkiLink, deck: string): Promise<void> {
  const [all, params] = await Promise.all([repo.listDeckSettings(), repo.listDeckParams()]);
  const settings = all.get(deck) ?? {};
  if (settings.dailyGoal) return;
  const target = goalTarget(deck, settings, params);
  try {
    if (target === 'anki') await saveDeckNewLimit(repo, deck, FROM_ZERO_NEW_PER_DAY);
    else if (target === 'own') await repo.saveDeckSettings(deck, { ...settings, newPerDay: FROM_ZERO_NEW_PER_DAY });
  } catch {
    // The deck keeps its limit: Deck options can set it, and the path says how many it suggests.
  }
}
