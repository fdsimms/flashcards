"""Whether words met as stretch words in a text were remembered better at their next Anki review than
similar words that weren't (docs/read-and-listen/architecture.md, Logging).

The brief's randomized comparison was dropped (19 October 2026), so this is the next best thing: an
observational one, run on the readings log and Anki's own review history. It can show an association,
never proof, because which words became stretch words wasn't random (they're young words, the most
fragile first, `stretch.py`).

A review is *exposed* when its word was a stretch word in a text read after the card's previous
review and no later than this one. Each exposed review is compared with unexposed reviews of cards at
about the same interval before the review (`_bucket`), since a card's interval is the strongest
single predictor of whether it's remembered; the pass rates are averaged over the exposed reviews'
mix of intervals, so a difference isn't just exposed words having shorter or longer ones. Anything
else that sets stretch words apart (how hard the word is) is not controlled for.

Pure: the rows come from `collection.read_reviews` and `store.exposures`. Nothing here grades FSRS or
changes a card.
"""

import math
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from itertools import pairwise

# Exposed reviews needed before the comparison says anything but "not enough yet".
MIN_EXPOSED = 40
# 95% two-sided.
Z = 1.96


@dataclass(frozen=True)
class Review:
    """One answer in Anki's review log: the card and its note, when (Unix milliseconds), whether it
    was remembered (not Again), the interval in days the card had before it (`lastIvl`, 0 or less for
    a learning step) and whether it was a review of a card in the review queue (Anki's type 1) as
    against a learning step."""

    card_id: int
    note_id: int
    at: int
    passed: bool
    last_ivl: int
    is_review: bool


@dataclass(frozen=True)
class Exposure:
    """A stretch word's note in a text read at this time (Unix milliseconds)."""

    note_id: int
    at: int


@dataclass(frozen=True)
class Effect:
    exposed: int  # exposed reviews compared
    control: int  # unexposed reviews they were compared with
    exposed_rate: float | None  # share of the exposed ones remembered
    control_rate: float | None  # the controls' rate at the exposed reviews' mix of intervals
    difference: float | None  # exposed less control, in rate (0.05 is five points)
    low: float | None  # 95% interval around it
    high: float | None
    verdict: str  # "not_enough", "no_clear_difference", "better" or "worse"


_EDGES = (1, 2, 3, 5, 8, 14, 21, 42, 90, 180)


def _bucket(last_ivl: int) -> int:
    """Intervals grouped so the groups hold comparable cards: days 1, 2, 3-4, 5-7, 8-13, 14-20..."""
    return sum(1 for edge in _EDGES if last_ivl >= edge)


def compare(
    reviews: Iterable[Review], exposures: Iterable[Exposure], since: int | None = None
) -> Effect:
    """`reviews` is the whole review log of the notes (the previous answer of a card may be older
    than the window), `since` Unix milliseconds: only answers from then on are compared."""
    by_note: dict[int, list[int]] = defaultdict(list)
    for e in exposures:
        by_note[e.note_id].append(e.at)
    by_card: dict[int, list[Review]] = defaultdict(list)
    for r in reviews:
        by_card[r.card_id].append(r)

    # bucket -> [exposed passes, exposed n, control passes, control n]
    cells: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    for answers in by_card.values():
        answers.sort(key=lambda r: r.at)
        for before, r in pairwise(answers):
            if not r.is_review or r.last_ivl < 1 or (since is not None and r.at < since):
                continue
            seen = any(before.at < at <= r.at for at in by_note.get(r.note_id, ()))
            cell = cells[_bucket(r.last_ivl)]
            offset = 0 if seen else 2
            cell[offset] += int(r.passed)
            cell[offset + 1] += 1
    return _effect(cells)


def _effect(cells: dict[int, list[int]]) -> Effect:
    used = {b: c for b, c in cells.items() if c[1] and c[3]}
    exposed = sum(c[1] for c in used.values())
    control = sum(c[3] for c in used.values())
    if exposed < MIN_EXPOSED:
        return Effect(exposed, control, None, None, None, None, None, "not_enough")
    exposed_rate = sum(c[0] for c in used.values()) / exposed
    control_rate = 0.0
    variance = 0.0
    for c in used.values():
        weight = c[1] / exposed
        pe, pc = c[0] / c[1], c[2] / c[3]
        control_rate += weight * pc
        variance += weight**2 * (pe * (1 - pe) / c[1] + pc * (1 - pc) / c[3])
    difference = exposed_rate - control_rate
    margin = Z * math.sqrt(variance)
    low, high = difference - margin, difference + margin
    verdict = "better" if low > 0 else "worse" if high < 0 else "no_clear_difference"
    return Effect(exposed, control, exposed_rate, control_rate, difference, low, high, verdict)


def exposures_of(
    readings: Iterable[tuple[int, Sequence[str]]], note_ids: dict[str, int]
) -> list[Exposure]:
    """Exposures from readings as (time in Unix milliseconds, the text's stretch words). A word with
    no single note in the deck (gone, or the same spelling on two notes) is left out."""
    return [
        Exposure(note_ids[word], at) for at, words in readings for word in words if word in note_ids
    ]
