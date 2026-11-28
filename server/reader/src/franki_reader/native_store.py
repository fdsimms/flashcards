"""Native recordings found for a word (franki_speech.commons), kept so each word is looked up on
Commons once in a long while rather than every time a card is saved. The table is in store.py's
schema (`native_lookups`)."""

import json
import sqlite3
from dataclasses import asdict
from datetime import datetime, timedelta

from franki_speech.commons import Recording

# A word with recordings is looked up again after this long (a new speaker may have recorded it).
FOUND_DAYS = 180
# A word with none, sooner: Lingua Libre's volunteers record new words every week.
NONE_DAYS = 30


def fresh(
    conn: sqlite3.Connection, language: str, word: str, now: datetime
) -> list[Recording] | None:
    """The recordings kept for the word, or None when it hasn't been looked up recently enough."""
    row = conn.execute(
        "SELECT recordings, looked_at FROM native_lookups WHERE language = ? AND word = ?",
        (language, word),
    ).fetchone()
    if row is None:
        return None
    recordings = [Recording(**r) for r in json.loads(row[0])]
    days = FOUND_DAYS if recordings else NONE_DAYS
    if now - datetime.fromisoformat(row[1]) > timedelta(days=days):
        return None
    return recordings


def keep(
    conn: sqlite3.Connection, language: str, word: str, recordings: list[Recording], now: datetime
) -> None:
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO native_lookups (language, word, recordings, looked_at)"
            " VALUES (?, ?, ?, ?)",
            (
                language,
                word,
                json.dumps([asdict(r) for r in recordings], ensure_ascii=False),
                now.isoformat(),
            ),
        )


def recording(conn: sqlite3.Connection, title: str) -> Recording | None:
    """A recording some lookup found, by its file's title: the audio route serves only these, so it
    can't be used to fetch anything else from Commons."""
    like = '%"title": ' + json.dumps(title, ensure_ascii=False) + "%"
    for (raw,) in conn.execute(
        "SELECT recordings FROM native_lookups WHERE recordings LIKE ?", (like,)
    ):
        for r in json.loads(raw):
            if r["title"] == title:
                return Recording(**r)
    return None
