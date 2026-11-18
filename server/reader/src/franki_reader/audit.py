"""Past texts for review after the fact (the MCP's `list_texts` and `get_text`). Read-only and
language-agnostic: unlike `/api/texts`, which lists the current language's finished texts for the
app, this lists every language and every text that was shown, and a text comes back as plain
lines with the words the deck didn't know, not the app's word-by-word rendering."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from typing import Any

from . import store


def _instant(at: str | datetime | None) -> str | None:
    """A stored time (naive UTC) with its offset, as every time in a response has."""
    if at is None:
        return None
    parsed = datetime.fromisoformat(at) if isinstance(at, str) else at
    return parsed.isoformat() + ("" if parsed.tzinfo else "+00:00")


def list_texts(
    conn: sqlite3.Connection,
    now: datetime,
    *,
    language: str | None = None,
    story_id: int | None = None,
    days: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Texts that were shown (ready or read, never a dropped draft), newest first; a story's
    episodes, first to last. `reads` counts finished readings."""
    where: list[str] = ["x.status IN ('ready', 'read')"]
    args: list[Any] = []
    if language is not None:
        where.append("x.language = ?")
        args.append(language)
    if story_id is not None:
        where.append("x.story_id = ?")
        args.append(story_id)
    if days is not None:
        where.append("x.created_at >= ?")
        args.append((now - timedelta(days=days)).isoformat())
    order = "x.episode, x.id" if story_id is not None else "x.id DESC"
    rows = conn.execute(
        f"""SELECT x.id, x.language, x.title, x.form, x.status, x.created_at, x.coverage,
                   x.episode, x.story_id, COALESCE(NULLIF(s.title, ''), t.name),
                   (SELECT COUNT(*) FROM readings r WHERE r.text_id = x.id AND r.finished = 1),
                   (SELECT r.rating FROM readings r WHERE r.text_id = x.id AND r.finished = 1
                    ORDER BY r.id DESC LIMIT 1)
            FROM texts x JOIN topics t ON t.id = x.topic_id LEFT JOIN stories s ON s.id = x.story_id
            WHERE {" AND ".join(where)} ORDER BY {order} LIMIT ?""",
        (*args, limit),
    )
    return [
        {
            "id": i,
            "language": lang,
            "title": title,
            "topic": topic,
            "form": form,
            "status": status,
            "created_at": _instant(created),
            "coverage": coverage,
            "story_id": sid,
            "episode": episode,
            "reads": reads,
            "last_rating": rating,
        }
        for i, lang, title, form, status, created, coverage, episode, sid, topic, reads, rating in rows
    ]


def readings(conn: sqlite3.Connection, text_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT logged_at, mode, rating, finished, words_flagged, seconds FROM readings"
        " WHERE text_id = ? ORDER BY id",
        (text_id,),
    )
    return [
        {
            "logged_at": _instant(at),
            "mode": mode,
            "rating": rating,
            "finished": bool(finished),
            "words_flagged": json.loads(flagged) if flagged else [],
            "seconds": seconds,
        }
        for at, mode, rating, finished, flagged, seconds in rows
    ]


def compact(
    text: store.StoredText,
    rendered: dict[str, Any],
    status: str | None,
    story: store.Story | None,
    topic: str,
    reads: list[dict[str, Any]],
) -> dict[str, Any]:
    """One text for a reviewer. `rendered` is the app's rendering (reader.render), which already
    knows each word's status against the deck as it stands now, so `unknown` and `partial` are
    what the deck doesn't cover today, not necessarily when the text was written."""
    lines = []
    for n, (line, out) in enumerate(zip(text.lines, rendered["lines"], strict=True)):
        words = out["words"]
        lines.append(
            {
                "n": n,
                "speaker": line.speaker,
                "text": "".join(w["text"] for w in words),
                "english": line.english,
                "register": line.register,
                "paragraph": line.paragraph,
                # Who the model named for each quotation, in order (a story episode's voices).
                "quotes": list(line.quotes),
                "unknown": [w["text"] for w in words if w["status"] == "unknown"],
                "partial": [w["text"] for w in words if w["status"] == "partial"],
            }
        )
    return {
        "id": text.id,
        "language": text.language,
        "title": text.title,
        "topic": topic,
        "form": text.form,
        "status": status,
        "model": text.model,
        "created_at": _instant(text.created_at),
        "coverage": text.coverage,
        "practice_words": list(text.stretch),
        "grammar": [
            {"id": g["id"], "name": g["name"], "role": g["role"]} for g in rendered["grammar"]
        ],
        "glosses": text.own_glosses,
        "characters": text.characters,
        "story": (
            {
                "id": story.id,
                "title": story.title,
                "about": story.about,
                "cast": story.cast,
                "plan": story.plan,
                "voices": {
                    name: {"gender": v.gender, "age": v.age, "voice": v.voice, "pitch": v.pitch}
                    for name, v in story.voices.items()
                },
            }
            if story
            else None
        ),
        "episode": text.episode,
        "recap": text.recap,
        "lines": lines,
        "questions": rendered["questions"],
        "choices": [
            {"english": c.english, "text": "".join(w["text"] for w in r["words"])}
            for c, r in zip(text.choices, rendered["choices"], strict=True)
        ],
        "chosen": text.chosen,
        "readings": reads,
    }
