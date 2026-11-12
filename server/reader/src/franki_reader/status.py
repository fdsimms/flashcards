"""What's due in Anki right now, for another app to show: dundundun's "Franki" task reads it
through `GET /api/status` (docs/read-and-listen/architecture.md, Status).

Every count is Anki's own (`deck_due_tree`, the numbers Anki's deck list shows, each deck's daily
review limit included), so this never predicts Anki's queue with a lookalike of it. New cards are
left out on purpose: Franki's progress gate (`DeckSettings.gateCap`) is Franki's own and Anki
doesn't know it, so Anki's new count can differ from the one Franki's deck list shows. Reviews and
learning cards are counted the same way by both.

Anki decides which study day it is from the process's time zone (the `TZ` setting in server/.env),
so the counts are for the day in that zone.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from anki.collection import Collection
from anki.decks import DeckTreeNode

# Anki's default "Learn ahead limit" (collapseTime, in seconds), for a collection that never set it.
LEARN_AHEAD_DEFAULT = 1200


@dataclass(frozen=True)
class DeckDue:
    name: str
    reviews: int  # Review cards due today (queue 2), within the deck's review limit
    # Learning cards due now: steps within the day inside the learn-ahead limit (queue 1) and steps
    # that crossed into today (queue 3), as Anki's deck list counts them
    learning: int


@dataclass(frozen=True)
class LearningLater:
    at: datetime  # aware, in UTC
    count: int


@dataclass(frozen=True)
class DueStatus:
    reviews: int  # every top-level deck's, added up
    learning: int
    # Every deck with something due, by its full name ("Polski::Odmiana"), in Anki's order. A deck's
    # counts include its subdecks', within its limits, as Anki's deck list shows them, so they
    # don't add up to the totals above.
    decks: list[DeckDue]
    learning_later: list[LearningLater]  # learning cards coming due later this study day, in order
    day_ends_at: datetime  # when Anki's next study day starts (aware, in UTC)


def read_due(col: Collection, now: int) -> DueStatus:
    """The collection's due counts at `now` (Unix seconds). Reads only."""
    tree = col.sched.deck_due_tree()
    decks: list[DeckDue] = []

    def walk(node: DeckTreeNode, parent: str) -> None:
        for child in node.children:
            name = f"{parent}::{child.name}" if parent else child.name
            if child.review_count or child.learn_count:
                decks.append(DeckDue(name, child.review_count, child.learn_count))
                walk(child, name)

    walk(tree, "")
    cutoff = col.sched.day_cutoff
    learn_ahead = int(col.get_config("collapseTime", LEARN_AHEAD_DEFAULT))
    assert col.db is not None  # open: deck_due_tree just used it
    # Queue 1 is a learning step within the day: due at an exact instant (Unix seconds). One already
    # inside the learn-ahead limit is in a deck's `learning` count above.
    rows = col.db.all(
        "select due, count() from cards where queue = 1 and due > ? and due < ? "
        "group by due order by due",
        now + learn_ahead,
        cutoff,
    )
    later = [LearningLater(datetime.fromtimestamp(due, UTC), count) for due, count in rows]
    return DueStatus(
        sum(c.review_count for c in tree.children),
        sum(c.learn_count for c in tree.children),
        decks,
        later,
        datetime.fromtimestamp(cutoff, UTC),
    )
