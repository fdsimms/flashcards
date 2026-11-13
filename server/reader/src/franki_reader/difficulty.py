"""How hard the next text is, adjusted from the last rating (docs/read-and-listen/brief.md, design principle 11):
"too hard" raises the coverage target and cuts a stretch word, "too easy" does the reverse. A poor
score on the check after reading also raises the target a step, unless the rating already did
(`adapt_to_check`); a good score changes nothing, since understanding a text is what it's for.

The coverage target stays between FLOOR and 99%, and stretch words within 1 to 3. A text must land
between the target and CEILING_GAP above it: one with more known words than that is too easy and
is revised, which the 95% floor alone never caught.
"""

from dataclasses import dataclass, replace

from franki_reader.coverage import CEILING_GAP, FLOOR
from franki_reader.grammar import UNSET_USES

# Where a new language starts: about 1 word in 12 new to the learner.
DEFAULT_FLOOR = 0.92
MAX_FLOOR = 0.99
FLOOR_STEP = 0.01
MIN_STRETCH = 1
MAX_STRETCH = 3

RATINGS = ("too_easy", "about_right", "too_hard")
# The check after reading moves difficulty only with at least this many answers, and only when
# fewer than this share of them were right.
CHECK_MIN_ASKED = 3
CHECK_LOW = 0.6


@dataclass(frozen=True)
class Difficulty:
    floor: float = DEFAULT_FLOOR
    stretch: int = 2
    # How many times a text may use grammar the owner hasn't marked. Not moved by a rating: the
    # Grammar dial on the wrap-up screen sets it (app.py, PUT /api/grammar/stretch).
    unset_uses: int = UNSET_USES

    @property
    def ceiling(self) -> float:
        return min(1.0, round(self.floor + CEILING_GAP, 2))


def adapt(current: Difficulty, rating: str | None) -> Difficulty:
    if rating == "too_hard":
        return replace(
            current,
            floor=round(min(MAX_FLOOR, current.floor + FLOOR_STEP), 2),
            stretch=max(MIN_STRETCH, current.stretch - 1),
        )
    if rating == "too_easy":
        return replace(
            current,
            floor=round(max(FLOOR, current.floor - FLOOR_STEP), 2),
            stretch=min(MAX_STRETCH, current.stretch + 1),
        )
    return current


def adapt_to_check(
    current: Difficulty, rating: str | None, right: int | None, asked: int | None
) -> Difficulty:
    """After `adapt`: a check with under `CHECK_LOW` right raises the coverage target one step, and
    leaves the stretch words alone (they're the rating's to change). Not after "too hard", which
    already raised it, so a hard text isn't counted twice."""
    if rating == "too_hard" or right is None or not asked or asked < CHECK_MIN_ASKED:
        return current
    if right / asked >= CHECK_LOW:
        return current
    return replace(current, floor=round(min(MAX_FLOOR, current.floor + FLOOR_STEP), 2))
