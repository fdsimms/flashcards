"""How hard the next text is, adjusted from the last rating (docs/read-and-listen/brief.md, design principle 11).

What makes a text harder is how many of its words are outside the learner's deck, so that is what a
rating moves: "too hard" raises the coverage target a step (fewer new words), "too easy" lowers it
a step, within MIN_FLOOR (95%, the least the research says reading and listening need) and
MAX_FLOOR (97%), with a text never above MAX_CEILING (98%). The number of practice words isn't a
difficulty setting: they are words the learner has already studied and count as known, so more of
them repeat a few words more without making a text harder, and a rating leaves them alone. A poor
score on the check after reading, which measures understanding, also raises the target a step,
unless the rating already did (`adapt_to_check`); a good score changes nothing, since understanding
a text is what it's for.

Each step is taken from the level the rated text was written at, not the current one
(`after_reading`): texts written ahead at the old level don't stack their ratings, so three of
them rated "too hard" move the target one step, as one would.

A text must land between the target and CEILING_GAP above it, never above MAX_CEILING: one with more
known words than that is too easy and is revised, which the 95% floor alone never caught.
"""

from dataclasses import dataclass, replace

from franki_reader.coverage import CEILING_GAP
from franki_reader.grammar import UNSET_USES

# Where a new language starts, and the lowest the target goes: about 1 word in 20 new to the learner.
# 95% is the least known-word coverage the research finds adequate for reading, and for listening
# (which can't be reread); below it comprehension varies widely (docs/read-and-listen/brief.md,
# Evidence base). The target stops at 97% and a text at 98%: above that a text has about one new
# word in 50, too few to learn from, and the research calls 98% the comfortable end of adequate
# coverage. From 95% to 97% a text goes from about 5 new words in 100 to about 3.
DEFAULT_FLOOR = 0.95
MIN_FLOOR = 0.95
MAX_FLOOR = 0.97
MAX_CEILING = 0.98
FLOOR_STEP = 0.01
MIN_STRETCH = 1
MAX_STRETCH = 4

RATINGS = ("too_easy", "about_right", "too_hard")
# The check after reading moves difficulty only on the answers from this text and the last one that
# had a check taken together (`engine.record_reading`), so one bad text can't: at least this many
# answers between them, and fewer than `CHECK_LOW` of them right. The app says low scores make the
# next text easier (CHECK_MIN_ASKED in src/reader/check.ts, which tests/reader/check.test.ts keeps
# equal to this).
CHECK_MIN_ASKED = 6
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
        return min(MAX_CEILING, round(self.floor + CEILING_GAP, 2))


def adapt(current: Difficulty, rating: str | None) -> Difficulty:
    if rating == "too_hard":
        return replace(current, floor=round(min(MAX_FLOOR, current.floor + FLOOR_STEP), 2))
    if rating == "too_easy":
        return replace(current, floor=round(max(MIN_FLOOR, current.floor - FLOOR_STEP), 2))
    return current


def _poor_check(rating: str | None, right: int | None, asked: int | None) -> bool:
    if rating == "too_hard" or right is None or not asked or asked < CHECK_MIN_ASKED:
        return False
    return right / asked < CHECK_LOW


def adapt_to_check(
    current: Difficulty, rating: str | None, right: int | None, asked: int | None
) -> Difficulty:
    """After `adapt`: a check with under `CHECK_LOW` right raises the coverage target one step. Not
    after "too hard", which already raised it, so a hard text isn't counted twice."""
    if not _poor_check(rating, right, asked):
        return current
    return replace(current, floor=round(min(MAX_FLOOR, current.floor + FLOOR_STEP), 2))


def after_reading(
    current: Difficulty,
    written: Difficulty,
    rating: str | None,
    right: int | None,
    asked: int | None,
) -> Difficulty:
    """The difficulty after a reading of a text written at `written` (its coverage target). `adapt`
    and `adapt_to_check` step from that level, and the result only moves the current target in the
    same direction: "too hard" leaves it at the higher of the current one and a step above the text's,
    "too easy" at the lower of the current one and a step below. So a rating of a text written before
    the last change, at the level that change already moved past, moves nothing, and texts written
    ahead at an old level don't stack. A poor check with "too easy" cancels out. The practice word
    count and the grammar allowance are the current ones, untouched."""
    moved = adapt_to_check(adapt(written, rating), rating, right, asked)
    direction = (
        int(rating == "too_hard")
        - int(rating == "too_easy")
        + int(_poor_check(rating, right, asked))
    )
    if direction > 0:
        floor = max(current.floor, moved.floor)
    elif direction < 0:
        floor = min(current.floor, moved.floor)
    else:
        floor = current.floor
    return replace(current, floor=floor)
