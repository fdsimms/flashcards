import type { GrammarState } from '../reader/api';
import { grammarStateWord } from '../reader/grammar';
import type { Colors } from './theme';

/**
 * A grammar point's state as a colored `Tag`: violet while it's practiced (the Grammar tool's
 * color), green once it's known, amber for one marked not known, quiet when it isn't set.
 */
export function grammarTag(c: Colors, state: GrammarState): { text: string; color: string; fill: string } {
  const [color, fill] = {
    practice: [c.violetInk, c.violetFill],
    normal: [c.goodInk, c.goodFill],
    avoid: [c.warningInk, c.warningFill],
    unset: [c.textSecondary, c.fill],
  }[state];
  return { text: grammarStateWord(state), color, fill };
}
