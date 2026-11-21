"""Words looked up in a text that aren't in the deck, brought back in later texts.

A word outside the deck is met once, in the text that needed it, and then never planned again
unless the learner makes a card of it. Picking a word up from reading takes several meetings, and
the ones the learner tapped are the ones they wanted to know. So a word looked up in a text read to
the end, and still not known, is offered to the next texts until it has been met on `MET_DAYS`
different study days (the day it was looked up included), fewest meetings first.

It stays a word outside the list: it counts against the coverage target as any unfamiliar word
does, is glossed, and takes the place of another one rather than adding to them. The model uses one
only where it fits the topic, and nothing checks that it did: a meeting is counted from the texts
read, whichever text brought the word.

Nothing here touches a card: a word that should be studied is added from the reader's Marked words.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

from franki_reader.coverage import Checker, check

# Study days a looked-up word is met on before it's left alone.
MET_DAYS = 4
# How far back a lookup still counts, in days.
MET_WINDOW_DAYS = 30
# How many are offered to one text.
MET_OFFERED = 3


@dataclass(frozen=True)
class PastReading:
    """A text read to the end: its study day, its lines as stored (`|`-split), the words tapped or
    marked in it, and its glosses."""

    day: date
    lines: tuple[str, ...]
    looked_up: tuple[str, ...]
    glosses: dict[str, str]


@dataclass(frozen=True)
class MetWord:
    text: str
    meaning: str


def pick_met(
    readings: Iterable[PastReading], lexicon: Checker, today: date, count: int = MET_OFFERED
) -> list[MetWord]:
    """The looked-up words to offer a text written on `today`, from `readings` oldest first. A word
    is left out once the deck knows it, once it has been met on `MET_DAYS` days, and on a day it
    was already met, so two texts in a day don't both carry it."""
    meanings: dict[str, MetWord] = {}
    days: dict[str, set[date]] = {}
    for reading in readings:
        tokens = check(reading.lines, lexicon).tokens
        unknown = {t.text.casefold(): t.text for t in tokens if t.status != "known"}
        glosses = {word.casefold(): meaning for word, meaning in reading.glosses.items()}
        for word in reading.looked_up:
            key = word.casefold()
            if key in unknown and glosses.get(key) and key not in meanings:
                meanings[key] = MetWord(unknown[key], glosses[key])
        for key in {t.text.casefold() for t in tokens}:
            days.setdefault(key, set()).add(reading.day)
    offered = [key for key in meanings if len(days[key]) < MET_DAYS and today not in days[key]]
    # Stable: among words met equally often, the one looked up first comes first.
    offered.sort(key=lambda key: len(days[key]))
    return [meanings[key] for key in offered[:count]]
