"""Your level (docs/read-and-listen/architecture.md, "Your level"): how many of a language's most
common words are studied, by frequency band, and what share of everyday speech they make up.

Known means what it means for a text: a deck entry with a studied card, young or mature (the
snapshot's tiers, lexicon.py), and for Japanese the words learned in WaniKani. The common-words
setting is left out on purpose: it counts words as known that nobody studied, which would make the
figure say only what the setting says. Each word is placed in the frequency list as the deck writes
it (`frequency.entry_place`), the same placing the deck's tiering uses. The share of speech is the
summed frequency of the families known, from data/<code>_shares.txt (scripts/build_common.py): per
million words, so the sum over the known families is the share of running speech they cover.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from functools import cache

from franki_reader.coverage import Checker
from franki_reader.frequency import entry_place, has_frequency_list
from franki_reader.lexicon import Entry

# The bands the page shows, by place in the frequency list (1 is the most common).
BANDS: tuple[tuple[int, int], ...] = (
    (1, 500),
    (501, 1000),
    (1001, 2000),
    (2001, 5000),
    (5001, 10000),
)
# The headline figure: how many of this many most common words are known.
HEADLINE = 2000
# How long each day's figure is kept, for the trend.
KEEP_DAYS = 366


@dataclass(frozen=True)
class Band:
    start: int
    end: int
    known: int


@dataclass(frozen=True)
class Level:
    bands: list[Band]
    # How many of the `HEADLINE` most common words are known.
    known_top: int
    # The share of everyday speech (0 to 1) the known words make up, None for a language with no
    # frequencies to measure it by.
    speech: float | None
    # Every word counted as known, ranked or not (a phrase, or a word past the list's end).
    studied: int


@dataclass(frozen=True)
class LevelDay:
    day: date
    known_top: int
    speech: float | None


@cache
def shares(code: str) -> tuple[float, ...] | None:
    """Each word of the language's list's frequency per million words, in the list's order, or None
    when there's no file for it."""
    from franki_reader.spaced import _DATA  # the one place the lists are read from

    path = _DATA / f"{code}_shares.txt"
    if not path.exists():
        return None
    lines = path.read_text(encoding="utf-8").splitlines()
    return tuple(float(line) for line in lines if line and not line.startswith("#"))


def known_words(entries: Iterable[Entry], wanikani: Iterable[str] = ()) -> list[str]:
    """The words counted as known: studied deck entries, then WaniKani's (Japanese), once each."""
    words = [e.text for e in entries if e.tier != "unreviewed"]
    return list(dict.fromkeys([*words, *wanikani]))


def level(code: str, words: Iterable[str], lexicon: Checker) -> Level | None:
    """The language's level from the words counted as known, or None for a language with no
    frequency list to place them in (Toki Pona's is a short list of particles that all count)."""
    if not has_frequency_list(lexicon):
        return None
    known = list(words)
    ranks = {r for w in known if (r := entry_place(w, lexicon).rank) is not None}
    bands = [Band(a, b, sum(1 for r in ranks if a <= r <= b)) for a, b in BANDS]
    per_million = shares(code)
    speech = (
        None
        if per_million is None
        else min(1.0, sum(per_million[r - 1] for r in ranks if r <= len(per_million)) / 1e6)
    )
    return Level(
        bands=bands,
        known_top=sum(1 for r in ranks if r <= HEADLINE),
        speech=speech,
        studied=len(known),
    )
