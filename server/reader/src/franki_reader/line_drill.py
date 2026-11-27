"""Lines from your reading: a hands-free drill made from lines of texts already read (#302).

An audio lesson like a review (lesson.build_lines): the narrator asks for each line in English, there
is a pause to say it aloud, and the line's own recording answers, in the voice it was read in. No
Claude call and no new recording of a line; only the narrator's English is spoken new. It's made and
played like any lesson, so it plays with the screen locked, and nothing in it grades a card.

Which lines (`pick_lines`): from texts read to the end in the last `MAX_AGE_DAYS`, the most recent
first, lines of `MIN_WORDS` to `MAX_WORDS` words with a translation, at most `PER_TEXT` from one
text, spread through it, and none drilled in the last `REST_DAYS`, so each drill brings others.
"""

import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from franki_reader import lesson, store
from franki_reader.coverage import parse_line
from franki_reader.languages import LANGUAGES, Code

MAX_LINES = 20
PER_TEXT = 5
MIN_WORDS = 3
MAX_WORDS = 12
MAX_AGE_DAYS = 30
REST_DAYS = 7
# Fewer lines than this isn't worth a drill; the Lessons tab offers none.
MIN_LINES = 4
# Texts read to the end looked through, most recent first.
LOOK_BACK = 50
# About how long the narrator's prompt and a line's recording take, for the card's minutes.
PROMPT_MS = 2500
LINE_MS = 2500


@dataclass(frozen=True)
class DrillLine:
    text_id: int
    line: int  # the line's index in its text
    title: str  # the text's title, for the Lessons card
    text: str  # the line as plain text
    english: str


@dataclass(frozen=True)
class ReadText:
    """A text read to the end, as `pick_lines` needs it: its lines as (plain text, English)."""

    id: int
    title: str
    lines: tuple[tuple[str, str], ...]


def _spread(indexes: list[int], n: int) -> list[int]:
    """`n` of `indexes`, spread evenly through them (all of them when there are no more than `n`)."""
    if len(indexes) <= n:
        return indexes
    step = len(indexes) / n
    return [indexes[int(i * step)] for i in range(n)]


def pick_lines(
    texts: Sequence[ReadText], drilled: set[str], count_words: Callable[[str], int]
) -> list[DrillLine]:
    """The drill's lines from `texts` (most recent first): each line once, by its text, not one in
    `drilled` (lines in drills made in the last `REST_DAYS`)."""
    picked: list[DrillLine] = []
    seen = set(drilled)
    for text in texts:
        fits = [
            i
            for i, (line, english) in enumerate(text.lines)
            if english.strip() and MIN_WORDS <= count_words(line) <= MAX_WORDS
        ]
        for i in _spread(fits, PER_TEXT):
            line, english = text.lines[i]
            if line in seen:
                continue
            seen.add(line)
            picked.append(DrillLine(text.id, i, text.title, line, english.strip()))
            if len(picked) == MAX_LINES:
                return picked
    return picked


def minutes(lines: Sequence[DrillLine], count_words: Callable[[str], int]) -> int:
    """About how long the drill runs: each line asked twice, with its pause to answer."""
    one = sum(
        PROMPT_MS + lesson.pause_ms(count_words(d.text)) + LINE_MS + lesson.AFTER_NATIVE_MS
        for d in lines
    )
    return max(1, round(2 * one / 60_000))


def read_texts(conn: sqlite3.Connection, language: Code, now: datetime) -> list[ReadText]:
    """The texts read to the end in the last `MAX_AGE_DAYS`, most recent first, each once."""
    since = now - timedelta(days=MAX_AGE_DAYS)
    spaced = LANGUAGES[language].spaced
    out: list[ReadText] = []
    seen: set[int] = set()
    for past in store.past_texts(conn, LOOK_BACK, language):
        if past.id in seen or past.read_at < since:
            continue
        seen.add(past.id)
        text = store.get_text(conn, past.id)
        if text is None:
            continue
        lines = tuple((parse_line(ln.text, spaced)[0].strip(), ln.english) for ln in text.lines)
        out.append(ReadText(text.id, text.title, lines))
    return out


def drilled_lines(conn: sqlite3.Connection, language: Code, now: datetime) -> set[str]:
    """The lines of drills made in the last `REST_DAYS`, by their text."""
    since = now - timedelta(days=REST_DAYS)
    return {
        p["text"]
        for row in store.lessons(conn, language)
        if row.title == lesson.LINES_TITLE and row.created_at >= since
        for p in row.plan.get("phrases", [])
        if isinstance(p, dict) and isinstance(p.get("text"), str)
    }


def lines_for(conn: sqlite3.Connection, language: Code, now: datetime) -> list[DrillLine]:
    """The lines a drill made now would ask for."""
    return pick_lines(
        read_texts(conn, language, now), drilled_lines(conn, language, now), lesson.word_count
    )


def offer(lines: Sequence[DrillLine]) -> dict[str, Any] | None:
    """The Lessons card's summary: how many lines, about how long, and from which texts; None with
    too few lines for a drill."""
    if len(lines) < MIN_LINES:
        return None
    counts: dict[int, tuple[str, int]] = {}
    for d in lines:
        title, n = counts.get(d.text_id, (d.title, 0))
        counts[d.text_id] = (title, n + 1)
    return {
        "lines": len(lines),
        "minutes": minutes(lines, lesson.word_count),
        "texts": [{"title": t, "count": n} for t, n in counts.values()],
    }
