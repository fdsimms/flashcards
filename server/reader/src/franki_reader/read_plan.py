"""Which languages get a Read & Listen task today, for the other app (dundundun) to show.

Franki decides this, not dundundun: which language to read next is a question about what the owner
has been reading, and Franki holds that. `/api/status` lists the answer (`read_and_listen_today`).

Each language is Every day (`daily`), Rotate or Off (Settings, Daily reading tasks). Every day
languages are listed on each study day while a text is waiting in them. Rotating languages take
turns, `rotate_count` of them a day, the one read least recently first: a language never read goes
before any that was, and of those the one with most texts waiting, so a language that has just
been started isn't passed over for its name. A rotating language read to the end today counts as
one of today's turns, whether or not it was the one picked, and once the turns are filled by what was
read, a pick still unread is dropped: a day has `rotate_count` rotation tasks, not one more.

The picks are kept for the study day (`store.load_read_plan`), so the list stays the same as texts
are read and written, and changing the count mid-day never takes a language away."""

import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from franki_reader import store

Mode = Literal["daily", "rotate", "off"]
MODES: tuple[Mode, ...] = ("daily", "rotate", "off")
DEFAULT_MODE: Mode = "rotate"
ROTATE_COUNT_RANGE = (1, 10)


@dataclass(frozen=True)
class Reading:
    """One language as the plan sees it."""

    language: str
    name: str
    waiting: int  # texts waiting on the shelf
    last_read: datetime | None  # when a text in it was last read to the end (naive UTC)


@dataclass(frozen=True)
class Entry:
    language: str
    name: str
    mode: Mode
    waiting: int
    done: bool  # a text in it was read to the end since the study day began


def _turn_order(r: Reading) -> tuple[bool, datetime, int, str]:
    """Least recently read first; never read before any, then the most texts waiting, then name."""
    return (r.last_read is not None, r.last_read or datetime.min, -r.waiting, r.name)


def plan(
    readings: list[Reading],
    modes: dict[str, Mode],
    rotate_count: int,
    day_start: datetime,
    picked: list[str],
) -> list[Entry]:
    """Today's list: the Every day languages, then the rotating ones. `day_start` is naive UTC, as
    the readings' times are. `picked` is the rotating languages chosen earlier today."""

    def mode_of(r: Reading) -> Mode:
        return modes.get(r.language, DEFAULT_MODE)

    def done(r: Reading) -> bool:
        return r.last_read is not None and r.last_read >= day_start

    daily = [r for r in readings if mode_of(r) == "daily" and (r.waiting > 0 or done(r))]
    rotating = [r for r in readings if mode_of(r) == "rotate"]
    # Read to the end today, picked or not: that is the day's turn, and it stays listed as done.
    finished = [r for r in rotating if done(r)]
    # Picked earlier and still unread. Once the reading done today fills the count they are dropped, so
    # reading one language on its own doesn't leave a second rotation task behind it.
    pending = [r for r in rotating if r.language in picked and not done(r)]
    room = max(0, rotate_count - len(finished))
    # With nothing read yet the picks stay, even where a lower count would no longer have chosen them.
    kept = pending[:room] if finished else pending
    turns = sorted(
        (r for r in rotating if r not in finished and r not in kept and r.waiting > 0),
        key=_turn_order,
    )
    chosen = [*finished, *kept, *turns[: max(0, room - len(kept))]]
    return [
        Entry(r.language, r.name, mode_of(r), r.waiting, done(r))
        for r in [*daily, *sorted(chosen, key=_turn_order)]
    ]


def today(
    conn: sqlite3.Connection,
    readings: list[Reading],
    settings: store.Settings,
    day_start: datetime,
) -> list[Entry]:
    """`plan` for the study day starting at naive-UTC `day_start`, keeping its rotating picks."""
    saved_day, picked = store.load_read_plan(conn)
    if saved_day != day_start:
        picked = []
    entries = plan(
        readings,
        {code: mode for code, mode in settings.daily_tasks.items() if mode in MODES},
        settings.daily_rotate_count,
        day_start,
        picked,
    )
    rotating = [e.language for e in entries if e.mode == "rotate"]
    if saved_day != day_start or rotating != picked:
        store.save_read_plan(conn, day_start, rotating)
    return entries
