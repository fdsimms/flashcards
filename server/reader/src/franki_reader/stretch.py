"""Which words to stretch on: young words that aren't about to come due, the most fragile first, then
words already reviewed today (docs/read-and-listen/brief.md, design principle 4, with "today's due
words" read as below). A mature word reviewed today counts, since it was tested today; other mature
words don't need the push.

Why fragile first: an encounter helps a word most while its memory is weakest, and FSRS stability
(days until recall drops to 90%) says how weak that is. Retrievability can't rank them: FSRS
schedules a review for when it falls to the desired retention, so every word that isn't due sits
just above it. A word just reviewed today is at its strongest, so it comes last.

Never a word that's due today and not yet reviewed today. Reading it in context, with its gloss, just
before its Anki review turns that review into short-term recall: it's rated Good, and FSRS lengthens
an interval the learner didn't earn, the corruption principle 9 is there to prevent, arriving by
priming rather than grading. Once it has been answered today, on any device, reading it is the
consolidation the brief is after, so those words go first. Which words are which comes from the
snapshot (lexicon.Entry: `due`, `reviewed`, `due_in`), read on a study day that may be before today.

The same principle says a stretch word "comes back in later texts on later days", so a word that
was a stretch word in a text read on an earlier day goes ahead of both, until it has been one on
`RETURN_DAYS` different days. It still has to be reviewed today or young, and not waiting for its
review: a word that has matured since is left alone.
"""

import random
from collections.abc import Collection, Mapping

from franki_reader.lexicon import Entry

RETURN_DAYS = 3
# A young word coming due within this many study days isn't a stretch word: read that close to its
# review, the exposure would prime it (the same corruption as above, softened by the days between).
# A word reviewed today is exempt, since its next review is a full interval away.
PRIMING_DAYS = 2


def due_soon(entry: Entry, days: int) -> bool:
    """Whether a card of the entry comes due within `PRIMING_DAYS` study days from today, `days` after
    the snapshot's. No due date read (a snapshot from before they were) isn't soon."""
    return entry.due_in is not None and entry.due_in - days <= PRIMING_DAYS


def waiting(entry: Entry, days: int) -> bool:
    """Whether a card of the entry is due today and not yet answered today, `days` study days after
    the snapshot's. On the snapshot's own day that's what the snapshot read; on a later day nothing
    answered since is known, so any card due by then is waiting, and a studied note with no due date
    read (a snapshot from before they were) is taken as waiting too."""
    if days <= 0:
        return entry.due
    return entry.due_in is None or entry.due_in <= days


def reviewed_today(entry: Entry, days: int) -> bool:
    """Whether a card of the entry was answered today and none is still waiting: only a snapshot
    read today can say."""
    return days <= 0 and entry.reviewed and not entry.due


def reviewed_words(entries: list[Entry], days: int = 0) -> list[Entry]:
    """The words studied in the deck that were reviewed today and aren't waiting for a review."""
    return [e for e in entries if e.tier != "unreviewed" and reviewed_today(e, days)]


def pick_stretch(
    entries: list[Entry],
    count: int,
    rng: random.Random,
    practiced: Mapping[str, int] | None = None,
    days: int = 0,
    reviewed_only: bool = False,
    today: Collection[str] = (),
) -> list[Entry]:
    """`practiced` maps a word to the number of earlier days it was a stretch word in a text read.
    `days` is how many study days ago the snapshot of `entries` was read (0: today).
    `reviewed_only` picks only words reviewed today (the shelf's "due" text).
    `today` holds the words that were a stretch word in a text already read this study day: they go
    after every other candidate, so several texts in a day don't keep practicing the same words, but
    they still fill a pick the other words can't. A pick made only of them drops one word."""
    practiced = practiced or {}

    def returns(e: Entry) -> bool:
        return 0 < practiced.get(e.text, 0) < RETURN_DAYS

    reviewed = reviewed_words(entries, days)
    picked = {e.note_id for e in reviewed}
    young = (
        []
        if reviewed_only
        else [
            e
            for e in entries
            if e.tier == "young"
            and e.note_id not in picked
            and not waiting(e, days)
            and not due_soon(e, days)
        ]
    )
    returning = [e for e in reviewed + young if returns(e)]
    reviewed = [e for e in reviewed if not returns(e)]
    young = [e for e in young if not returns(e)]
    rng.shuffle(returning)
    rng.shuffle(reviewed)
    rng.shuffle(young)
    # Stable, so words of equal stability (or none read) stay in their shuffled order.
    young.sort(key=lambda e: float("inf") if e.stability is None else e.stability)
    ordered = returning + young + reviewed
    # A stable split: each group keeps the order above (returning, young, reviewed).
    fresh = [e for e in ordered if e.text not in today]
    repeats = [e for e in ordered if e.text in today]
    chosen = (fresh + repeats)[:count]
    if len(chosen) > 1 and not any(e.text not in today for e in chosen):
        # Nothing fresh to add: a pick made only of today's words drops one, so the text isn't
        # the same words again, and keeps the rest.
        chosen = chosen[:-1]
    return chosen
