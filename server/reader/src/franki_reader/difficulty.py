"""How hard the texts are: the coverage target, HARDER_FLOOR (93%), STANDARD_FLOOR (95%) or
EASIER_FLOOR (97%) known words (docs/read-and-listen/brief.md, design principles 2 and 11).

What makes a text harder is how many of its words are outside the learner's deck, so that is the one
thing that varies. The research gives the range (95% is the least adequate for reading and for
listening, which can't be reread, and 98% is the comfortable end), and a text never holds more than
MAX_CEILING (98%) known words: above that it has about one new word in 50, too few to learn from. From
95% to 97% a text goes from about 5 new words in 100 to about 3. Harder (93%) is below the research's
least, about 7 in 100: the evidence is that coverage helps gradually, not as a cliff, and the reader
has a gloss on every word, but expect more lookups. It is only ever a deliberate choice.

The learner chooses (Settings, Read & Listen: Text difficulty). A poor score on the check after
reading, which measures understanding, steps one level easier by itself (`after_reading`: Harder to
Standard, Standard to Easier); the learner steps back. A rating of a text no longer moves anything: it's a feeling, which tracks fluency more
than learning, and in a range this narrow a tap on every text bought a point or two. The number of
practice words isn't a difficulty setting either: they are words the learner has already studied and
count as known, so more of them repeat a few words more without making a text harder.

A text must land between the target and CEILING_GAP above it, never above MAX_CEILING: one with more
known words than that is too easy and is revised, which the 95% floor alone never caught.
"""

from dataclasses import dataclass, replace

from franki_reader.coverage import CEILING_GAP
from franki_reader.grammar import UNSET_USES

HARDER_FLOOR = 0.93
STANDARD_FLOOR = 0.95
EASIER_FLOOR = 0.97
# Easiest last: a poor check steps along this.
FLOORS = (HARDER_FLOOR, STANDARD_FLOOR, EASIER_FLOOR)
# A new language starts at the research's least.
DEFAULT_FLOOR = STANDARD_FLOOR
MAX_CEILING = 0.98

# The check after reading steps easier only on the answers from this text and the last one that
# had a check taken together (`engine.record_reading`), so one bad text can't: at least this many
# answers between them, and fewer than `CHECK_LOW` of them right. The app says low scores make the
# next text easier (CHECK_MIN_ASKED in src/reader/check.ts, which tests/reader/check.test.ts keeps
# equal to this).
CHECK_MIN_ASKED = 6
CHECK_LOW = 0.6


@dataclass(frozen=True)
class Difficulty:
    floor: float = DEFAULT_FLOOR
    # How many practice words a text carries (1 to 4, generator.MAX_STRETCH). Not a difficulty: they
    # are words already studied. Nothing moves it; a saved count is kept.
    stretch: int = 2
    # How many times a text may use grammar the owner hasn't marked. Not moved by anything here: the
    # Grammar dial on the wrap-up screen sets it (routes/grammar.py, PUT /api/grammar/stretch).
    unset_uses: int = UNSET_USES

    @property
    def ceiling(self) -> float:
        return min(MAX_CEILING, round(self.floor + CEILING_GAP, 2))


def _poor_check(right: int | None, asked: int | None) -> bool:
    if right is None or not asked or asked < CHECK_MIN_ASKED:
        return False
    return right / asked < CHECK_LOW


def nearest_floor(floor: float) -> float:
    """The level (`FLOORS`) closest to a saved target."""
    return min(FLOORS, key=lambda f: abs(f - floor))


def after_reading(current: Difficulty, right: int | None, asked: int | None) -> Difficulty:
    """The difficulty after a reading with `right` of `asked` answers on the check, which is this
    text's and the last checked text's taken together: under `CHECK_LOW` right steps one level easier
    (Harder to Standard, Standard to Easier). A good score, or too few answers, changes nothing:
    understanding a text is what it's for."""
    if not _poor_check(right, asked):
        return current
    at = FLOORS.index(nearest_floor(current.floor))
    return replace(current, floor=FLOORS[min(at + 1, len(FLOORS) - 1)])
