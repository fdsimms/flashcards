"""How hard the next text is, adjusted from the last rating (docs/read-and-listen/brief.md, design principle 11).

The coverage target doesn't move: it is the research's range, 95% to 98% known words (DEFAULT_FLOOR
to MAX_CEILING), the same for every learner and language. A learner's rating is a feeling, which
tracks fluency more than learning, and inside a range this narrow the target would move a point or
two, so what a rating controls is how many stretch words a text carries (1 to 4), the new words it
teaches: "too hard" cuts one, "too easy" adds one. A poor score on the check after reading, which
measures understanding, also cuts one, unless the rating already did (`adapt_to_check`); a good
score changes nothing, since understanding a text is what it's for.

Each step is taken from the level the rated text was written at, not the current one
(`after_reading`): texts written ahead at the old level don't stack their ratings, so three of
them rated "too hard" cut one stretch word, as one would.

A text must land between the target and CEILING_GAP above it, never above MAX_CEILING: one with more
known words than that is too easy and is revised, which the 95% floor alone never caught.
"""

from dataclasses import dataclass, replace

from franki_reader.coverage import CEILING_GAP
from franki_reader.grammar import UNSET_USES

# The coverage target: about 1 word in 20 new to the learner. 95% is the least known-word coverage the
# research finds adequate for reading, and for listening (which can't be reread); below it
# comprehension varies widely (docs/read-and-listen/brief.md, Evidence base). A text holds at most
# 98%: above that it has about one new word in 50, too few to learn from, and the research calls 98%
# the comfortable end of adequate coverage.
DEFAULT_FLOOR = 0.95
MAX_CEILING = 0.98
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
        return replace(current, stretch=max(MIN_STRETCH, current.stretch - 1))
    if rating == "too_easy":
        return replace(current, stretch=min(MAX_STRETCH, current.stretch + 1))
    return current


def _poor_check(rating: str | None, right: int | None, asked: int | None) -> bool:
    if rating == "too_hard" or right is None or not asked or asked < CHECK_MIN_ASKED:
        return False
    return right / asked < CHECK_LOW


def adapt_to_check(
    current: Difficulty, rating: str | None, right: int | None, asked: int | None
) -> Difficulty:
    """After `adapt`: a check with under `CHECK_LOW` right cuts a stretch word. Not after "too hard",
    which already cut one, so a hard text isn't counted twice."""
    if not _poor_check(rating, right, asked):
        return current
    return replace(current, stretch=max(MIN_STRETCH, current.stretch - 1))


def after_reading(
    current: Difficulty,
    written: Difficulty,
    rating: str | None,
    right: int | None,
    asked: int | None,
) -> Difficulty:
    """The difficulty after a reading of a text written at `written` (its stretch word count, where
    the text recorded one). `adapt` and `adapt_to_check` step from that level, and the result only
    moves the current count in the same direction: "too hard" leaves it at the lower of the current
    one and a step below the text's, "too easy" at the higher of the current one and a step above. So
    a rating of a text written before the last change, at the level that change already moved past,
    moves nothing, and texts written ahead at an old level don't stack. A poor check with "too
    easy" cancels out, as a rating of "too hard" would not."""
    moved = adapt_to_check(adapt(written, rating), rating, right, asked)
    direction = (
        int(rating == "too_easy")
        - int(rating == "too_hard")
        - int(_poor_check(rating, right, asked))
    )
    if direction > 0:
        stretch = max(current.stretch, moved.stretch)
    elif direction < 0:
        stretch = min(current.stretch, moved.stretch)
    else:
        stretch = current.stretch
    return replace(current, stretch=stretch)
