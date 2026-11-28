"""The podcast episode a text was made from (podcast.py), kept beside the text. The table is in
store.py's schema (`podcast_texts`)."""

import json
import sqlite3
from dataclasses import dataclass


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
