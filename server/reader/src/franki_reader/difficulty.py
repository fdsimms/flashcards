"""How hard the next text is, adjusted from the last rating (docs/read-and-listen/brief.md, design principle 11):
"too hard" raises the coverage target and cuts a stretch word, "too easy" does the reverse.

The coverage target stays between FLOOR and 99%, and stretch words within 1 to 3. A text must land
between the target and CEILING_GAP above it: one with more known words than that is too easy and
is revised, which the 95% floor alone never caught.
"""

from dataclasses import dataclass, replace

from franki_reader.coverage import CEILING_GAP, FLOOR

# Where a new language starts: about 1 word in 12 new to the learner.
DEFAULT_FLOOR = 0.92
MAX_FLOOR = 0.99
FLOOR_STEP = 0.01
MIN_STRETCH = 1
MAX_STRETCH = 3

RATINGS = ("too_easy", "about_right", "too_hard")


@dataclass(frozen=True)
class Difficulty:
    floor: float = DEFAULT_FLOOR
    stretch: int = 2

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
