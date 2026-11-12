"""How often each grammar point has come up in the texts the owner has read, and which known points
to work into the next texts (docs/read-and-listen/architecture.md, Grammar, "Exposure").

A point's uses are found with its finder (grammar.py) in every text read to the end, so a text
written before this was counted too, and a point that was never asked for still counts when the
model used it. Finders miss some forms on purpose, so the counts are a floor: good for ranking,
not exact.

The Grammar screen's "Seen least" card and the generator both call `review_points`, so the screen
names the points the next texts are actually asked for.
"""

import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from franki_reader import grammar, store
from franki_reader.coverage import Checker, parse_line
from franki_reader.languages import LANGUAGES, Code
from franki_reader.store import GrammarState

# Known points worked into each text for review.
REVIEW_POINTS = 2
# Lines a point's page shows from texts read (docs/grammar.md, step 4).
EXAMPLES = 3


@dataclass(frozen=True)
class Exposure:
    texts: int = 0  # texts read to the end that use the point
    uses: int = 0  # matches across those texts
    last_seen: datetime | None = None  # when the latest of them was read


# Each text's matches, by text id: a text's lines never change, so it's found once per process.
Cache = dict[int, dict[str, int]]


def exposure(
    conn: sqlite3.Connection, lexicon: Checker, language: Code, cache: Cache
) -> dict[str, Exposure]:
    """Every point of the language, with how often it came up in the texts read to the end."""
    ids = tuple(p.id for p in grammar.points_for(language))
    out = {pid: Exposure() for pid in ids}
    for text, read_at in store.finished_texts(conn, language):
        counts = cache.get(text.id)
        if counts is None:
            found = grammar.find_in_lines([ln.text for ln in text.lines], lexicon, ids)
            counts = {pid: len(matches) for pid, matches in found.items() if matches}
            cache[text.id] = counts
        for pid, n in counts.items():
            if pid not in out:
                continue
            was = out[pid]
            last = read_at if was.last_seen is None or read_at > was.last_seen else was.last_seen
            out[pid] = Exposure(was.texts + 1, was.uses + n, last)
    return out


def review_points(
    choices: Mapping[str, GrammarState],
    seen: Mapping[str, Exposure],
    offered: Mapping[str, datetime],
    language: Code,
) -> tuple[str, ...]:
    """The known ("normal") points to work into the next text: the ones longest since they were
    last read or last asked for, never-met ones first, then the fewest texts. Counting the asking
    as well as the reading rotates the list even when the model passes a point over, and when
    several texts are written ahead of reading."""

    def key(pid: str) -> tuple[datetime, int, int]:
        times = [t for t in (seen[pid].last_seen if pid in seen else None, offered.get(pid)) if t]
        order = [p.id for p in grammar.points_for(language)].index(pid)
        return (max(times) if times else datetime.min, seen[pid].texts if pid in seen else 0, order)

    known = [p.id for p in grammar.points_for(language) if choices.get(p.id) == "normal"]
    return tuple(sorted(known, key=key)[:REVIEW_POINTS])


@dataclass(frozen=True)
class Example:
    text_id: int
    title: str
    line: str  # plain, as shown
    english: str
    words: tuple[str, ...]  # what the finder matched, as `grammar.words` gives them


def examples(
    conn: sqlite3.Connection, lexicon: Checker, point_id: str, limit: int = EXAMPLES
) -> list[Example]:
    """Lines using the point from texts read to the end, the latest read first, one per text."""
    point = grammar.POINTS[point_id]
    spaced = LANGUAGES[point.language].spaced
    out: list[Example] = []
    read = sorted(store.finished_texts(conn, point.language), key=lambda t: t[1], reverse=True)
    for text, _ in read:
        for ln in text.lines:
            words = grammar.find_in_lines([ln.text], lexicon, (point_id,))[point_id]
            if words:
                plain = parse_line(ln.text, spaced)[0]
                out.append(Example(text.id, text.title, plain, ln.english, tuple(words)))
                break
        if len(out) >= limit:
            break
    return out


def unset_points(choices: Mapping[str, GrammarState], language: Code) -> tuple[str, ...]:
    """The language's points the owner hasn't marked at all."""
    return tuple(p.id for p in grammar.points_for(language) if p.id not in choices)
