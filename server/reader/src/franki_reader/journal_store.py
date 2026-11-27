"""The journal's rows (journal.py; the tables are in store.py's schema, `journal_entries` and
`journal_mistakes`). An entry keeps its latest text and check; its mistakes are those of its first
check, the ones made before any hint, so trying again never changes what the counts say."""

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from franki_reader import journal
from franki_reader.languages import Code


@dataclass(frozen=True)
class Entry:
    id: int
    language: Code
    prompt: str
    text: str
    check: dict[str, Any]
    tries: int
    created_at: datetime
    checked_at: datetime


@dataclass(frozen=True)
class Tally:
    """One kind of mistake: how many times since a date, and its latest example."""

    group: str
    kind: str
    count: int
    was: str
    now: str
    written: str
    corrected: str


_COLUMNS = "id, language, prompt, text, check_json, tries, created_at, checked_at"


def _entry(row: tuple[Any, ...]) -> Entry:
    return Entry(
        row[0],
        row[1],
        row[2],
        row[3],
        json.loads(row[4]),
        row[5],
        datetime.fromisoformat(row[6]),
        datetime.fromisoformat(row[7]),
    )


def get(conn: sqlite3.Connection, entry_id: int) -> Entry | None:
    row = conn.execute(
        f"SELECT {_COLUMNS} FROM journal_entries WHERE id = ?", (entry_id,)
    ).fetchone()
    return _entry(row) if row else None


def by_key(conn: sqlite3.Connection, client_key: str) -> Entry | None:
    row = conn.execute(
        f"SELECT {_COLUMNS} FROM journal_entries WHERE client_key = ?", (client_key,)
    ).fetchone()
    return _entry(row) if row else None


def entries(conn: sqlite3.Connection, language: Code, limit: int = 100) -> list[Entry]:
    """The language's entries, newest first."""
    return [
        _entry(row)
        for row in conn.execute(
            f"SELECT {_COLUMNS} FROM journal_entries WHERE language = ? ORDER BY id DESC LIMIT ?",
            (language, limit),
        )
    ]


def add(
    conn: sqlite3.Connection,
    language: Code,
    client_key: str | None,
    prompt: str,
    text: str,
    check: dict[str, Any],
    now: datetime,
) -> Entry:
    """A new entry with its first check, whose mistakes are kept for the counts."""
    with conn:
        cursor = conn.execute(
            "INSERT INTO journal_entries (language, client_key, prompt, text, check_json, tries,"
            " created_at, checked_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
            (
                language,
                client_key,
                prompt,
                text,
                journal.dumps(check),
                now.isoformat(),
                now.isoformat(),
            ),
        )
        entry_id = int(cursor.lastrowid or 0)
        conn.executemany(
            "INSERT INTO journal_mistakes (entry_id, language, grp, kind, was, now, written,"
            " corrected, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    entry_id,
                    language,
                    journal.group_of(m["kind"], m.get("case")),
                    m["kind"],
                    m["was"],
                    m["now"],
                    m["written"],
                    m["corrected"],
                    now.isoformat(),
                )
                for m in journal.mistakes_of(check)
            ],
        )
    entry = get(conn, entry_id)
    assert entry is not None
    return entry


def recheck(
    conn: sqlite3.Connection, entry_id: int, text: str, check: dict[str, Any], now: datetime
) -> Entry | None:
    """The entry as written again and checked again; its first check's mistakes stay as counted."""
    with conn:
        changed = conn.execute(
            "UPDATE journal_entries SET text = ?, check_json = ?, tries = tries + 1, checked_at = ?"
            " WHERE id = ?",
            (text, journal.dumps(check), now.isoformat(), entry_id),
        ).rowcount
    return get(conn, entry_id) if changed else None


def remove(conn: sqlite3.Connection, entry_id: int) -> bool:
    with conn:
        return conn.execute("DELETE FROM journal_entries WHERE id = ?", (entry_id,)).rowcount > 0


def tallies(conn: sqlite3.Connection, language: Code, since: datetime | None) -> list[Tally]:
    """Each kind of mistake the language's first checks found since `since` (all time with None),
    the most frequent first, with its latest example."""
    rows = conn.execute(
        "SELECT grp, kind, was, now, written, corrected FROM journal_mistakes"
        " WHERE language = ? AND at >= ? ORDER BY at DESC, rowid DESC",
        (language, since.isoformat() if since else ""),
    ).fetchall()
    counts: dict[str, int] = {}
    latest: dict[str, tuple[Any, ...]] = {}
    for row in rows:
        counts[row[0]] = counts.get(row[0], 0) + 1
        latest.setdefault(row[0], row)
    order = sorted(counts, key=lambda g: (-counts[g], list(latest).index(g)))
    return [Tally(g, latest[g][1], counts[g], *latest[g][2:]) for g in order]


def slips(conn: sqlite3.Connection, point_id: str, since: datetime) -> int:
    """How many entries since `since` had a mistake on `point_id` in their first check."""
    row = conn.execute(
        "SELECT COUNT(DISTINCT entry_id) FROM journal_mistakes WHERE kind = ? AND at >= ?",
        (point_id, since.isoformat()),
    ).fetchone()
    return int(row[0])
