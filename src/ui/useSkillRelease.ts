import { useEffect, useRef } from 'react';
import { setCardStates, type NoteStore } from '../anki/noteService';
import { isInProgress } from '../core/progress';
import type { Card, Note } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import type { AnkiLink } from '../db/ankiLink';
import { drillOfTags, releasable } from '../tools/skills';

/**
 * Releases a skill card's next drill step (src/tools/skills.ts) once the step before has settled:
 * started, and its next review a week or more out (the progress gate's line, `isInProgress`). Run
 * once when a review session's cards are first loaded, behind any answer being written; a step
 * released now comes up from the next session. Unsuspending goes through `setCardStates`, as the
 * review menu's does, so Anki and sync carry it.
 */
export function useSkillRelease(repo: NoteStore & Pick<AnkiLink, 'setAnkiCardStates'>, cards: Card[] | null, notes: Map<string, Note>, dayStartsAtHour: number) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !cards || !notes.size) return;
    done.current = true;
    const skill = cards.flatMap((card) => {
      const drill = notes.get(card.noteId) && drillOfTags(notes.get(card.noteId)!.tags);
      if (!drill || card.retired) return [];
      const settled = card.sched.state !== 0 && !isInProgress(card);
      return [{ card, state: { id: card.id, stepId: drill.step.id, language: drill.language, suspended: !!card.suspended, settled } }];
    });
    const ids = new Set(releasable(skill.map((s) => s.state)));
    if (!ids.size) return;
    const targets = skill.filter((s) => ids.has(s.card.id)).map((s) => s.card);
    reviewWrites.add(async () => {
      await setCardStates(repo, targets, (s) => ({ ...s, suspended: false }), new Date(), dayStartsAtHour);
    });
  }, [repo, cards, notes, dayStartsAtHour]);
}
