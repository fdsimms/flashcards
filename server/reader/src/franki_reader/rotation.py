"""Grammar rotation (docs/read-and-listen/architecture.md, Grammar, "Rotation"): a practiced point
that has been learned moves to Know it, and the language's easiest point not yet practiced or
known (`grammar.next_to_learn`) takes its place, before the next text is written.

Learned means both of these:
- enough texts read to the end that were written to practice it, since it last started being
  practiced, spread over enough study days that a single binge doesn't count: `TEXTS` with drill
  answers to judge by, `TEXTS_UNDRILLED` with fewer than `DRILL_MIN`, over `DAYS` study days;
- the practice questions on it, when there are any, mostly right: `DRILL_PASS` of the latest
  `DRILL_WINDOW` answers, the share a drill round already counts as gone well
  (src/core/grammarDrills.ts, `DRILL_PASS`);
- no journal entry in the last `JOURNAL_DAYS` days, since it started being practiced, with a
  mistake on it in its first check (journal.py): a point still getting wrong in one's own writing
  isn't learned, however the texts and drills went.

Pure: the engine gathers the counts (`store.practiced_reads`, `store.recent_grammar_answers`) and
makes the swap. Nothing here schedules or grades a card: it changes which grammar texts are asked
for, and the owner can take each swap back.
"""

from collections.abc import Sequence
from dataclasses import dataclass

TEXTS = 8
TEXTS_UNDRILLED = 12
DAYS = 4
DRILL_WINDOW = 10
DRILL_MIN = 5
DRILL_PASS = 0.8
JOURNAL_DAYS = 7


@dataclass(frozen=True)
class Progress:
    """How far a practiced point has come: texts read and the study days they span, and its latest
    practice answers."""

    texts: int
    days: int
    drill_right: int
    drill_asked: int
    # Journal entries within `JOURNAL_DAYS` whose first check found a mistake on the point.
    journal_slips: int = 0


def progress(texts: int, days: int, answers: Sequence[bool], journal_slips: int = 0) -> Progress:
    """`answers` latest first; only the latest `DRILL_WINDOW` count."""
    latest = answers[:DRILL_WINDOW]
    return Progress(texts, days, sum(latest), len(latest), journal_slips)


def graduates(p: Progress) -> bool:
    if p.journal_slips:
        return False
    if p.drill_asked and p.drill_right < DRILL_PASS * p.drill_asked:
        return False
    needed = TEXTS if p.drill_asked >= DRILL_MIN else TEXTS_UNDRILLED
    return p.texts >= needed and p.days >= DAYS
