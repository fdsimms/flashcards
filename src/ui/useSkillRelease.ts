import { useEffect, useRef } from 'react';
import { saveNote, setCardStates, type NoteStore } from '../anki/noteService';
import { skillsPausedIn } from '../anki/skillSettings';
import { isSettled } from '../core/progress';
import { DRILL_MAX_INTERVAL_DAYS, drillDueTooFar, setAsideOf, SKILL_COVERED_TAG } from '../core/skillTag';
import { setDueDates } from '../anki/rescheduleService';
import type { Card, Note } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import type { AnkiLink } from '../db/ankiLink';
import { coverable, drillOfTags, holdable, knownIn, missingByCard, releasable } from '../tools/skills';

/**
 * Releases a skill card's next drill step (src/tools/skills.ts) once the step before has settled:
 * started, and its next review a week or more out (the progress gate's line, `isSettled`), and the
 * deck knows the words the step needs (`stepNeeds`: the months for dates, a hundred for the hundreds),
 * each one's card settled the same way. A first step that waits only for words is released once they are
 * known, and a step that's live without them is held back again (`holdable`). A step a later one of its ladder asks everything
 * of is set aside once that one has settled (`coverable`): tagged `skill::covered` and suspended. A drill card due more than a week
 * out is brought into the week with Set Due Date (`drillDueTooFar`), so the weekly cap holds for one scheduled before it. Nothing is released or held while the deck's skill
 * cards are paused. Run once when a review session's cards are first loaded, behind any answer being
 * written. Suspending and unsuspending go through `setCardStates`, as the review menu's do, so Anki and
 * sync carry them. `onSaved` gets the cards and notes as written, for the open session to take them in:
 * a step set aside leaves it, and a card brought into the week can come up in it.
 */
export function useSkillRelease(
  repo: NoteStore & Pick<AnkiLink, 'setAnkiCardStates' | 'ankiSkillSettings'>, cards: Card[] | null, notes: Map<string, Note>, dayStartsAtHour: number,
  onSaved: (cards: Card[], notes: Note[]) => void,
) {
  const saved = useRef(onSaved);
  saved.current = onSaved;
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
        return [{ card, state: { id: card.id, stepId: drill.step.id, language: drill.language, suspended: !!card.suspended, settled: isSettled(card), paused: skillsPausedIn(note.deck, settings), missing: missing.get(card.id), setAside: setAsideOf(note.tags) } }];
      });
      const states = skill.map((s) => s.state);
      const release = new Set(releasable(states));
      const cover = new Set(coverable(states));
      const hold = new Set(holdable(states).filter((id) => !cover.has(id)));
      for (const id of cover) release.delete(id);
      // A drill card due more than a week out (scheduled before the weekly cap, or answered in Anki) is brought into the week, as Set Due Date does.
      const far = skill.filter((sk) => !cover.has(sk.card.id) && !hold.has(sk.card.id) && drillDueTooFar(sk.card, new Date(), dayStartsAtHour)).map((sk) => sk.card);
      if (!release.size && !hold.size && !cover.size && !far.length) return;
      const targets = (ids: Set<string>) => skill.filter((s) => ids.has(s.card.id)).map((s) => s.card);
      reviewWrites.add(async () => {
        const now = new Date();
        // Each card as last written, so a later write starts from an earlier one's and the session gets the last.
        const written = new Map<string, Card>();
        const savedNotes: Note[] = [];
        const latest = (list: Card[]) => list.map((cd) => written.get(cd.id) ?? cd);
        const keep = (list: Card[]) => { for (const cd of list) written.set(cd.id, cd); };
        try {
          // The tag first, so a card the suspend below doesn't reach is still passed by from now on.
          const covering = targets(cover);
          for (const noteId of new Set(covering.map((cd) => cd.noteId))) {
            const n = notes.get(noteId);
            if (n && !n.tags.includes(SKILL_COVERED_TAG)) savedNotes.push(await saveNote(repo, { id: n.id, deck: n.deck, model: n.model, fields: n.fields, tags: [...n.tags, SKILL_COVERED_TAG] }, now));
          }
          const toSuspend = new Set([...hold, ...covering.filter((cd) => !cd.suspended).map((cd) => cd.id)]);
          if (release.size) keep((await setCardStates(repo, targets(release), (s) => ({ ...s, suspended: false }), now, dayStartsAtHour)).cards);
          if (toSuspend.size) keep((await setCardStates(repo, latest(targets(toSuspend)), (s) => ({ ...s, suspended: true }), now, dayStartsAtHour)).cards);
          if (far.length) keep((await setDueDates(repo, latest(far), { min: 0, max: DRILL_MAX_INTERVAL_DAYS, forceReset: false }, now)).cards);
        } finally {
          if (written.size || savedNotes.length) saved.current([...written.values()], savedNotes);
        }
      }).catch(() => undefined); // Nothing to show: what didn't happen is worked out again at the next session.
    })();
  }, [repo, cards, notes, dayStartsAtHour]);
}
