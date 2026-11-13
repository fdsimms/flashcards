"""Which words to stretch on: words already reviewed today first, then young ones
(docs/read-and-listen/brief.md, design principle 4, with "today's due words" read as below). A
mature word reviewed today counts, since it was tested today; other mature words don't need the push.

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
from collections.abc import Mapping

from franki_reader.lexicon import Entry

RETURN_DAYS = 3


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
) -> list[Entry]:
    """`practiced` maps a word to the number of earlier days it was a stretch word in a text read.
    `days` is how many study days ago the snapshot of `entries` was read (0: today).
    `reviewed_only` picks only words reviewed today (the shelf's "due" text)."""
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
            if e.tier == "young" and e.note_id not in picked and not waiting(e, days)
        ]
    )
    returning = [e for e in reviewed + young if returns(e)]
    reviewed = [e for e in reviewed if not returns(e)]
    young = [e for e in young if not returns(e)]
    rng.shuffle(returning)
    rng.shuffle(reviewed)
    rng.shuffle(young)
    return (returning + reviewed + young)[:count]
