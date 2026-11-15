"""Which finished texts to offer for hearing again, and when: each is offered three times, 1, 4 and
10 study days after it was read, once for each listen heard so far (docs/read-and-listen/
architecture.md, Client, Listen again). Hearing a text again a few days on, with the words hidden,
is the repeated, spaced listening the research supports; by then it's easy to follow, so it's
fluency practice, not a test.

Nothing here grades a card, writes a reading or moves difficulty: a listen is only counted
(`store.log_listen`), so the schedule knows what's left.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

# Study days after a text was read at which each listen comes due, by how many listens are wanted:
# three at 1, 4 and 10 days, or one at 3 days (the app's setting, Hear texts again). A single listen
# comes a few days on, not the next day, since the gap should grow with how long it's to be remembered.
SCHEDULES = {1: (3,), 3: (1, 4, 10)}
DEFAULT_LISTENS = 3
# A text not heard again within this many study days of being read is let go, so a week away
# doesn't bring back a pile of old ones.
MAX_AGE_DAYS = 30
# Offered at a time, oldest first.
MAX_OFFERED = 3


@dataclass(frozen=True)
class Candidate:
    text_id: int
    read_day: date  # the study day it was read on
    listens: int  # times it has been heard again


def due(candidates: Iterable[Candidate], today: date, listens: int = DEFAULT_LISTENS) -> list[int]:
    """The ids of the texts to hear again today, with `listens` wanted per text (0 wants none): the
    next listen is due and the text isn't past `MAX_AGE_DAYS`, oldest read first, at most
    `MAX_OFFERED`."""
    schedule = SCHEDULES.get(listens, ())
    offered = []
    for c in candidates:
        if c.listens >= len(schedule):
            continue
        age = (today - c.read_day).days
        if schedule[c.listens] <= age <= MAX_AGE_DAYS:
            offered.append(c)
    offered.sort(key=lambda c: (c.read_day, c.text_id))
    return [c.text_id for c in offered[:MAX_OFFERED]]
