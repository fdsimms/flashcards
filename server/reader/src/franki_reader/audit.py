"""What Claude wrote, for review after the fact (the MCP's `list_read_and_listen_texts`,
`get_read_and_listen_text`, `list_audio_lessons`, `get_audio_lesson`, `list_grammar_pages`,
`get_grammar_page` and `list_practice_items`). Read-only and language-agnostic: unlike `/api/texts`,
which lists the current language's finished texts for the app, this lists every language, and a
text comes back as plain lines with the words the deck didn't know, not the app's word-by-word
rendering.

Nothing here may start a write, record audio or change a row: the app's own routes for the same
things can (`GET /api/grammar/{point_id}/lesson` writes a missing lesson and records its examples,
`GET /api/lessons` listens for a lesson's pauses), which is why the reviewer has routes of its own."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from typing import Any

from . import grammar, store

# Which texts `list_texts` lists, by `status`: "shown" is every text that reached the shelf and
# wasn't taken off it ("ready" waiting or "read"), "skipped" one taken off unread (Not this),
# "dropped" a draft that missed the known-words floor and was never shown (or got no usable answer
# at all, kept with no lines), only for its cost. "pending" (audio still being made) is never listed.
TEXT_STATUSES: dict[str, tuple[str, ...]] = {
    "shown": ("ready", "read"),
    "skipped": ("skipped",),
    "dropped": ("dropped",),
    "all": ("ready", "read", "skipped", "dropped"),
}
AUDITED = TEXT_STATUSES["all"]


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
    status: str = "shown",
) -> list[dict[str, Any]]:
    """Texts of a `status` in TEXT_STATUSES (shown ones unless asked), newest first; a story's
    episodes, first to last. `reads` counts finished readings; `floor` is the share of known words
    it was written to reach, which a dropped draft's `coverage` fell short of."""
    statuses = TEXT_STATUSES[status]
    where: list[str] = [f"x.status IN ({', '.join('?' for _ in statuses)})"]
    args: list[Any] = list(statuses)
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
        f"""SELECT x.id, x.language, x.title, x.form, x.status, x.created_at, x.coverage, x.floor,
                   x.episode, x.story_id, COALESCE(NULLIF(s.title, ''), t.name),
                   (SELECT COUNT(*) FROM readings r WHERE r.text_id = x.id AND r.finished = 1),
                   (SELECT r.rating FROM readings r WHERE r.text_id = x.id AND r.finished = 1
                    ORDER BY r.id DESC LIMIT 1)
            FROM texts x JOIN topics t ON t.id = x.topic_id LEFT JOIN stories s ON s.id = x.story_id
            WHERE {" AND ".join(where)} ORDER BY {order} LIMIT ?""",
        (*args, limit),
    )
    keys = (
        "id",
        "language",
        "title",
        "form",
        "status",
        "created_at",
        "coverage",
        "floor",
        "episode",
        "story_id",
        "topic",
        "reads",
        "last_rating",
    )
    listed = [dict(zip(keys, row, strict=True)) for row in rows]
    for text in listed:
        text["created_at"] = _instant(text["created_at"])
    return listed


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
    floor: float | None,
    questions_asked: list[dict[str, Any]],
) -> dict[str, Any]:
    """One text for a reviewer, with what Claude answered when its lines were asked about
    (`asked`, see `asked`). `rendered` is the app's rendering (reader.render), which already
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
        "floor": floor,
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
        "asked": questions_asked,
    }


def floor_of(conn: sqlite3.Connection, text_id: int) -> float | None:
    row = conn.execute("SELECT floor FROM texts WHERE id = ?", (text_id,)).fetchone()
    return float(row[0]) if row else None


# Explain's versions, by the `simple` it was asked with (store.py, Explanations: the two flags add up).
EXPLAIN_VERSIONS = {0: "full", 1: "plain", 2: "in the language", 3: "plain, in the language"}


def asked(conn: sqlite3.Connection, text_id: int) -> list[dict[str, Any]]:
    """Everything Claude answered about a text's lines on the owner's taps, by line: Explain
    (`explain`, in the version asked for), Does this sound natural? (`natural`), a selected
    phrase's explanation (`phrase`) and the questions asked about it (`phrase_chat`, kept only
    briefly: store.PHRASE_CHAT_TTL), and why a word has its form (`form`). Answers are as kept, the
    shapes the app shows; a line nobody asked about has nothing here."""
    found: list[tuple[int, str, str, dict[str, Any]]] = []
    for line, simple, points, at in conn.execute(
        "SELECT line, simple, points, created_at FROM explanations WHERE text_id = ?", (text_id,)
    ):
        version = EXPLAIN_VERSIONS.get(simple, str(simple))
        found.append((line, "explain", at, {"version": version, "points": json.loads(points)}))
    for line, answer, at in conn.execute(
        "SELECT line, answer, created_at FROM naturalness WHERE text_id = ?", (text_id,)
    ):
        found.append((line, "natural", at, {"answer": json.loads(answer)}))
    for line, phrase, simple, answer, at in conn.execute(
        "SELECT line, phrase, simple, answer, created_at FROM phrase_explanations"
        " WHERE text_id = ?",
        (text_id,),
    ):
        version = EXPLAIN_VERSIONS.get(simple, str(simple))
        body = {"phrase": phrase, "version": version, "answer": json.loads(answer)}
        found.append((line, "phrase", at, body))
    for line, phrase, turns, at in conn.execute(
        "SELECT line, phrase, turns, updated_at FROM phrase_chats WHERE text_id = ?", (text_id,)
    ):
        found.append((line, "phrase_chat", at, {"phrase": phrase, "turns": json.loads(turns)}))
    for line, word, answer, at in conn.execute(
        "SELECT line, word, answer, created_at FROM form_explanations WHERE text_id = ?",
        (text_id,),
    ):
        found.append((line, "form", at, {"word": word, "answer": json.loads(answer)}))
    found.sort(key=lambda f: (f[0], f[2]))
    return [
        {"line": line, "kind": kind, "at": _instant(at), **body} for line, kind, at, body in found
    ]


# ==== Audio lessons ====


def list_lessons(
    conn: sqlite3.Connection,
    now: datetime,
    *,
    language: str | None = None,
    days: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Audio lessons of every state, newest first. `marks` counts the phrases the owner marked
    while listening (Again, Slow), the nearest thing a lesson has to a rating."""
    where: list[str] = ["1 = 1"]
    args: list[Any] = []
    if language is not None:
        where.append("l.language = ?")
        args.append(language)
    if days is not None:
        where.append("l.created_at >= ?")
        args.append((now - timedelta(days=days)).isoformat())
    rows = conn.execute(
        f"""SELECT l.id, l.language, l.scene, l.title, l.state, l.error, l.duration_ms,
                   l.created_at, l.heard_at,
                   (SELECT COUNT(*) FROM lesson_marks m WHERE m.lesson_id = l.id)
            FROM lessons l WHERE {" AND ".join(where)} ORDER BY l.id DESC LIMIT ?""",
        (*args, limit),
    )
    return [
        {
            "id": i,
            "language": lang,
            "scene": scene,
            "title": title or scene,
            "state": state,
            "error": error,
            "duration_ms": duration,
            "created_at": _instant(created),
            "heard_at": _instant(heard),
            "marks": marks,
        }
        for i, lang, scene, title, state, error, duration, created, heard, marks in rows
    ]


def lesson(conn: sqlite3.Connection, lesson_id: int) -> dict[str, Any] | None:
    """One lesson as Claude wrote it (the phrases taught and the dialogue: lesson.describe) and as
    it's heard (`script`, each thing said and each of the learner's turns: lesson.script_of; null
    for a lesson made before it was kept), with the phrases the owner marked and why."""
    row = store.get_lesson(conn, lesson_id)
    if row is None:
        return None
    heard = conn.execute("SELECT heard_at FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
    marks = conn.execute(
        "SELECT text, english, reason, created_at, review_id FROM lesson_marks"
        " WHERE lesson_id = ? ORDER BY id",
        (lesson_id,),
    )
    return {
        "id": row.id,
        "language": row.language,
        "scene": row.scene,
        "title": row.title or row.scene,
        "state": row.state,
        "stage": row.stage,
        "error": row.error,
        "duration_ms": row.duration_ms,
        "created_at": _instant(row.created_at),
        "heard_at": _instant(heard[0] if heard else None),
        "phrases": row.plan.get("phrases", []),
        "dialogue": row.plan.get("dialogue", []),
        "script": None
        if row.script is None
        else [
            {k: v for k, v in entry.items() if k != "replay"}
            for entry in row.script.get("entries", [])
        ],
        "marks": [
            {
                "text": text,
                "english": english,
                "reason": reason,
                "at": _instant(at),
                "reviewed": review is not None,
            }
            for text, english, reason, at, review in marks
        ],
    }


# ==== Grammar pages ====


def _point_name(point_id: str) -> str:
    point = grammar.POINTS.get(point_id)
    return point.name if point else point_id


def list_grammar_pages(
    conn: sqlite3.Connection, *, language: str | None = None
) -> list[dict[str, Any]]:
    """Every grammar page Claude wrote, newest first: the owner's own topics (`kind` "topic", by
    the title they typed) and the built-in points' lessons (`kind` "point", by the point's id).
    `note` is what the app says about a write that failed, `examples` how many lines it has."""
    pages: list[dict[str, Any]] = []
    topic_rows = conn.execute(
        "SELECT id, language, title, status, note, examples, created_at FROM grammar_topics"
        + (" WHERE language = ?" if language else ""),
        (language,) if language else (),
    )
    for i, lang, title, status, note, examples, created in topic_rows:
        pages.append(
            {
                "kind": "topic",
                "id": str(i),
                "language": lang,
                "title": title,
                "status": status,
                "note": note or "",
                "examples": len(json.loads(examples)),
                "at": _instant(created),
            }
        )
    for point_id, status, note, examples, updated in conn.execute(
        "SELECT point_id, status, note, examples, updated_at FROM grammar_lessons"
    ):
        point = grammar.POINTS.get(point_id)
        lang = point.language if point else None
        if language is not None and lang != language:
            continue
        pages.append(
            {
                "kind": "point",
                "id": point_id,
                "language": lang,
                "title": _point_name(point_id),
                "status": status,
                "note": note,
                "examples": len(json.loads(examples)),
                "at": _instant(updated),
            }
        )
    pages.sort(key=lambda p: p["at"] or "", reverse=True)
    return pages


def grammar_page(conn: sqlite3.Connection, kind: str, page_id: str) -> dict[str, Any] | None:
    """One grammar page in full: a topic's lead, explanation and examples, or a point's lesson
    examples with the point's own note (the catalog's, not Claude's). Each example is
    {line, english, words} as kept."""
    if kind == "topic":
        if not page_id.isdigit():
            return None
        topic = store.get_grammar_topic(conn, int(page_id))
        if topic is None:
            return None
        return {
            "kind": "topic",
            "id": str(topic.id),
            "language": topic.language,
            "title": topic.title,
            "status": topic.status,
            "note": topic.note or "",
            "lead": topic.lead,
            "explanation": topic.explanation,
            "examples": topic.examples,
            "at": _instant(topic.created_at),
        }
    if kind == "point":
        kept = store.get_grammar_lesson(conn, page_id)
        if kept is None:
            return None
        point = grammar.POINTS.get(page_id)
        updated = conn.execute(
            "SELECT updated_at FROM grammar_lessons WHERE point_id = ?", (page_id,)
        ).fetchone()
        return {
            "kind": "point",
            "id": page_id,
            "language": point.language if point else None,
            "title": _point_name(page_id),
            "status": kept.status,
            "note": kept.note,
            "point_note": point.note if point else "",
            "point_example": point.example if point else "",
            "examples": kept.examples,
            "at": _instant(updated[0] if updated else None),
        }
    return None


# ==== Practice items ====

# The kinds `practice` lists, each a cache of what Claude wrote in batches.
PRACTICE_KINDS = ("drill", "sentence", "vocab", "meaning", "sentence_meaning")


def practice(
    conn: sqlite3.Connection,
    now: datetime,
    kind: str,
    *,
    language: str | None = None,
    point: str | None = None,
    word: str | None = None,
    days: int | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """A sample of one kind of practice item Claude wrote, newest first, and what its batches
    asked for against what passed the checks (`batches`; none for `sentence_meaning`, which isn't
    kept by batch or date):

    - `drill`: grammar drills' fill-the-gap questions (drills.py), by `point`.
    - `sentence`: sentences to say, one deck word each (sentences.py), by `word`.
    - `vocab`: the vocabulary check's words with the meaning and wrong answers (vocab_check.py).
    - `meaning`: glosses for words with none in the deck (meanings.py), by `word`.
    - `sentence_meaning`: each word's meaning in a card's example sentence (meanings.py), by `word`.

    `served_at` (drill, sentence) is when the owner was last shown it, null for never."""
    since = (now - timedelta(days=days)).isoformat() if days is not None else None
    where: list[str] = ["1 = 1"]
    args: list[Any] = []

    def match(column: str, value: str | None) -> None:
        if value is not None:
            where.append(f"{column} = ?")
            args.append(value)

    if kind == "drill":
        match("b.language", language)
        match("q.point_id", point)
        if since:
            where.append("b.created_at >= ?")
            args.append(since)
        rows = conn.execute(
            "SELECT q.id, b.language, q.point_id, q.before, q.answer, q.after, q.english, q.wrong,"
            " q.hint, q.served_at, b.created_at FROM drill_questions q"
            " JOIN drill_batches b ON b.id = q.batch_id"
            f" WHERE {' AND '.join(where)} ORDER BY q.id DESC LIMIT ?",
            (*args, limit),
        )
        items = [
            {
                "id": i,
                "language": lang,
                "point": pid,
                "point_name": _point_name(pid),
                "line": f"{before}___{after}",
                "answer": answer,
                "english": english,
                "wrong": json.loads(wrong),
                "hint": hint,
                "served_at": _instant(served),
                "written_at": _instant(written),
            }
            for i, lang, pid, before, answer, after, english, wrong, hint, served, written in rows
        ]
        return {"items": items, "batches": _batches(conn, "drill_batches", language, since, point)}
    if kind == "sentence":
        match("s.language", language)
        match("s.word", word)
        if since:
            where.append("b.created_at >= ?")
            args.append(since)
        rows = conn.execute(
            "SELECT s.id, s.language, s.word, s.note_id, s.sentence, s.english, s.served_at,"
            " b.created_at FROM sentences s JOIN sentence_batches b ON b.id = s.batch_id"
            f" WHERE {' AND '.join(where)} ORDER BY s.id DESC LIMIT ?",
            (*args, limit),
        )
        items = [
            {
                "id": i,
                "language": lang,
                "word": w,
                "note_id": note_id,
                "sentence": sentence,
                "english": english,
                "served_at": _instant(served),
                "written_at": _instant(written),
            }
            for i, lang, w, note_id, sentence, english, served, written in rows
        ]
        return {"items": items, "batches": _batches(conn, "sentence_batches", language, since)}
    if kind == "vocab":
        match("v.language", language)
        match("v.lemma", word)
        if since:
            where.append("b.created_at >= ?")
            args.append(since)
        rows = conn.execute(
            "SELECT v.language, v.lemma, v.rank, v.meaning, v.wrong, b.created_at"
            " FROM vocab_items v JOIN vocab_batches b ON b.id = v.batch_id"
            f" WHERE {' AND '.join(where)} ORDER BY b.id DESC, v.rank LIMIT ?",
            (*args, limit),
        )
        items = [
            {
                "language": lang,
                "word": lemma,
                "rank": rank,
                "meaning": meaning,
                "wrong": json.loads(wrong),
                "written_at": _instant(written),
            }
            for lang, lemma, rank, meaning, wrong, written in rows
        ]
        return {"items": items, "batches": _batches(conn, "vocab_batches", language, since)}
    if kind == "meaning":
        match("m.language", language)
        match("m.word", word.lower() if word is not None else None)
        if since:
            where.append("b.created_at >= ?")
            args.append(since)
        rows = conn.execute(
            "SELECT m.language, m.word, m.meaning, b.created_at"
            " FROM word_meanings m JOIN meaning_batches b ON b.id = m.batch_id"
            f" WHERE {' AND '.join(where)} ORDER BY b.id DESC, m.word LIMIT ?",
            (*args, limit),
        )
        items = [
            {"language": lang, "word": w, "meaning": meaning, "written_at": _instant(written)}
            for lang, w, meaning, written in rows
        ]
        return {"items": items, "batches": _batches(conn, "meaning_batches", language, since)}
    if kind == "sentence_meaning":
        match("language", language)
        match("word", word)
        rows = conn.execute(
            "SELECT language, sentence, word, meaning FROM sentence_meanings"
            f" WHERE {' AND '.join(where)} ORDER BY rowid DESC LIMIT ?",
            (*args, limit),
        )
        items = [
            {"language": lang, "sentence": sentence, "word": w, "meaning": meaning}
            for lang, sentence, w, meaning in rows
        ]
        return {"items": items, "batches": None}
    raise ValueError(f"No such kind: {kind}")


def _batches(
    conn: sqlite3.Connection,
    table: str,
    language: str | None,
    since: str | None,
    point: str | None = None,
) -> dict[str, Any]:
    """How a kind's batches went over the same window: calls made, items asked for, items that
    passed the checks (`kept`), and what they cost. A call that failed after Claude answered counts
    with nothing asked or kept."""
    where: list[str] = ["1 = 1"]
    args: list[Any] = []
    for column, value in (("language", language), ("created_at >=", since), ("point_id", point)):
        if value is not None:
            where.append(f"{column} ?" if column.endswith(">=") else f"{column} = ?")
            args.append(value)
    calls, asked_for, kept, cost = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(asked), 0), COALESCE(SUM(kept), 0),"
        f" COALESCE(SUM(cost_usd), 0) FROM {table} WHERE {' AND '.join(where)}",
        args,
    ).fetchone()
    return {"calls": calls, "asked": asked_for, "kept": kept, "cost_usd": round(cost, 4)}
