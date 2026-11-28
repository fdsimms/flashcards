"""The podcast episode a text was made from (podcast.py), kept beside the text. The table is in
store.py's schema (`podcast_texts`)."""

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime

from franki_reader.video import Cue


@dataclass(frozen=True)
class PodcastText:
    feed: str
    guid: str
    show: str
    artwork: str
    audio: str
    # Each line's start and end in milliseconds, line for line with the text's.
    times: tuple[tuple[int, int], ...]


def keep(conn: sqlite3.Connection, text_id: int, episode: PodcastText) -> None:
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO podcast_texts (text_id, feed, guid, show, artwork, audio, times)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                text_id,
                episode.feed,
                episode.guid,
                episode.show,
                episode.artwork,
                episode.audio,
                json.dumps([list(t) for t in episode.times]),
            ),
        )


def of(conn: sqlite3.Connection, text_id: int) -> PodcastText | None:
    row = conn.execute(
        "SELECT feed, guid, show, artwork, audio, times FROM podcast_texts WHERE text_id = ?",
        (text_id,),
    ).fetchone()
    if row is None:
        return None
    return PodcastText(
        row[0], row[1], row[2], row[3], row[4], tuple((a, b) for a, b in json.loads(row[5]))
    )


def keep_transcript(
    conn: sqlite3.Connection, feed: str, guid: str, cues: list[Cue], cost_usd: float, now: datetime
) -> None:
    """An episode's transcript made by Azure (podcast.py), kept so it's never paid for twice."""
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO podcast_transcripts (feed, guid, cues, cost_usd, made_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                feed,
                guid,
                json.dumps([[c.start_ms, c.end_ms, c.text] for c in cues], ensure_ascii=False),
                cost_usd,
                now.isoformat(),
            ),
        )


def transcript(conn: sqlite3.Connection, feed: str, guid: str) -> list[Cue] | None:
    row = conn.execute(
        "SELECT cues FROM podcast_transcripts WHERE feed = ? AND guid = ?", (feed, guid)
    ).fetchone()
    return None if row is None else [Cue(a, b, t) for a, b, t in json.loads(row[0])]


def transcribed(conn: sqlite3.Connection, feed: str) -> set[str]:
    """The episodes of a show with a transcript Azure made."""
    return {
        g for (g,) in conn.execute("SELECT guid FROM podcast_transcripts WHERE feed = ?", (feed,))
    }
