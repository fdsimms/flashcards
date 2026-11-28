"""The video a text was made from (video.py), kept beside the text. The table is in store.py's
schema (`video_texts`)."""

import json
import sqlite3
from dataclasses import dataclass


@dataclass(frozen=True)
class VideoText:
    video_id: str
    channel: str
    generated: bool
    # Each line's start and end in milliseconds, line for line with the text's.
    times: tuple[tuple[int, int], ...]


def keep(conn: sqlite3.Connection, text_id: int, video: VideoText) -> None:
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO video_texts (text_id, video_id, channel, generated, times)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                text_id,
                video.video_id,
                video.channel,
                int(video.generated),
                json.dumps([list(t) for t in video.times]),
            ),
        )


def of(conn: sqlite3.Connection, text_id: int) -> VideoText | None:
    row = conn.execute(
        "SELECT video_id, channel, generated, times FROM video_texts WHERE text_id = ?", (text_id,)
    ).fetchone()
    if row is None:
        return None
    return VideoText(row[0], row[1], bool(row[2]), tuple((a, b) for a, b in json.loads(row[3])))
