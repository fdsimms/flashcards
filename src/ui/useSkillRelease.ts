import { useEffect, useRef } from 'react';
import { setCardStates, type NoteStore } from '../anki/noteService';
import { skillsPausedIn } from '../anki/skillSettings';
import { isSettled } from '../core/progress';
import type { Card, Note } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import type { AnkiLink } from '../db/ankiLink';
import { drillOfTags, holdable, knownIn, missingByCard, releasable } from '../tools/skills';

/**
 * Releases a skill card's next drill step (src/tools/skills.ts) once the step before has settled:
 * started, and its next review a week or more out (the progress gate's line, `isSettled`), and the
 * deck knows the words the step needs (`stepNeeds`: the months for dates, a hundred for the hundreds),
 * each one's card settled the same way. A first step that waits only for words is released once they are
 * known, and a step that's live without them is held back again (`holdable`). Nothing is released or held while the deck's skill
 * cards are paused. Run once when a review session's cards are first loaded, behind any answer being
 * written; a step released now comes up from the next session. Suspending and unsuspending go through
 * `setCardStates`, as the review menu's do, so Anki and sync carry them.
 */
export function useSkillRelease(repo: NoteStore & Pick<AnkiLink, 'setAnkiCardStates' | 'ankiSkillSettings'>, cards: Card[] | null, notes: Map<string, Note>, dayStartsAtHour: number) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !cards || !notes.size) return;
    done.current = true;
    void (async () => {
      // Without the pause switches nothing is released: a paused deck's cards must stay as they are.
      let settings;
      try { settings = await repo.ankiSkillSettings(); } catch { return; }
      const missing = missingByCard(cards, notes, knownIn(notes.values(), cards));
      const skill = cards.flatMap((card) => {
        const note = notes.get(card.noteId);
        const drill = note && drillOfTags(note.tags);
        if (!note || !drill || card.retired) return [];
        return [{ card, state: { id: card.id, stepId: drill.step.id, language: drill.language, suspended: !!card.suspended, settled: isSettled(card), paused: skillsPausedIn(note.deck, settings), missing: missing.get(card.id) } }];
      });
      const states = skill.map((s) => s.state);
      const release = new Set(releasable(states));
      const hold = new Set(holdable(states));
      if (!release.size && !hold.size) return;
      const targets = (ids: Set<string>) => skill.filter((s) => ids.has(s.card.id)).map((s) => s.card);
      reviewWrites.add(async () => {
        const now = new Date();
        if (release.size) await setCardStates(repo, targets(release), (s) => ({ ...s, suspended: false }), now, dayStartsAtHour);
        if (hold.size) await setCardStates(repo, targets(hold), (s) => ({ ...s, suspended: true }), now, dayStartsAtHour);
      });
    })();
  }, [repo, cards, notes, dayStartsAtHour]);
}
