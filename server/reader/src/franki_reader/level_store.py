"""Your level's figure for each day (level.py), kept for the trend. The table is in store.py's
schema (`level_days`): one row per language per study day, the latest figure that day kept, and
rows older than `level.KEEP_DAYS` dropped as new ones are written."""

import sqlite3
from datetime import date, timedelta

from franki_reader.level import KEEP_DAYS, Level, LevelDay


def keep(conn: sqlite3.Connection, language: str, day: date, figure: Level) -> None:
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO level_days (language, day, known_top, speech) VALUES (?, ?, ?, ?)",
            (language, day.isoformat(), figure.known_top, figure.speech),
        )
        conn.execute(
            "DELETE FROM level_days WHERE day < ?",
            ((day - timedelta(days=KEEP_DAYS)).isoformat(),),
        )


def has_day(conn: sqlite3.Connection, language: str, day: date) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM level_days WHERE language = ? AND day = ?",
            (language, day.isoformat()),
        ).fetchone()
        is not None
    )


def history(conn: sqlite3.Connection, language: str) -> list[LevelDay]:
    """The language's kept figures, oldest first."""
    return [
        LevelDay(date.fromisoformat(day), known_top, speech)
        for day, known_top, speech in conn.execute(
            "SELECT day, known_top, speech FROM level_days WHERE language = ? ORDER BY day",
            (language,),
        )
    ]
