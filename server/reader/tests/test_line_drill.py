import asyncio
import random
import sqlite3
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW
from test_app_lessons import needs_ffmpeg, tone, wait_for

from franki_reader import lesson, lesson_service, line_drill, store
from franki_reader.app import create_app
from franki_reader.coverage import Coverage
from franki_reader.engine import Engine
from franki_reader.generator import Generated, Line
from franki_reader.line_drill import DrillLine, ReadText, minutes, offer, pick_lines
from franki_reader.store import Reading
from franki_reader.tts import AudioCache, Spoken


def words(text: str) -> int:
    return len(text.split())


def read(id_: int, *lines: tuple[str, str]) -> ReadText:
    return ReadText(id_, f"Text {id_}", tuple(lines))


LONG = "one two three four five six seven eight nine ten eleven twelve thirteen"


def test_picks_sayable_lines_with_a_translation() -> None:
    text = read(
        1,
        ("Tak.", "Yes."),
        ("Ala ma kota dzisiaj.", "Ala has a cat today."),
        (LONG, "Long."),
        ("Nie ma go tu.", ""),
    )
    assert [d.text for d in pick_lines([text], set(), words)] == ["Ala ma kota dzisiaj."]


def test_takes_a_few_lines_spread_through_each_text_most_recent_first() -> None:
    first = read(1, *((f"line {i} of first", f"English {i}") for i in range(12)))
    second = read(2, *((f"line {i} of second", f"English {i}") for i in range(3)))
    picked = pick_lines([first, second], set(), words)
    one = [d.line for d in picked if d.text_id == 1]
    assert len(one) == line_drill.PER_TEXT
    assert one == sorted(one) and one[0] == 0 and one[-1] > 6
    assert [d.text_id for d in picked].index(2) == line_drill.PER_TEXT


def test_leaves_out_lines_drilled_lately_and_any_line_twice() -> None:
    a = read(1, ("Ala ma kota.", "Ala has a cat."), ("Kot ma Alę.", "The cat has Ala."))
    b = read(2, ("Ala ma kota.", "Ala has a cat."), ("Pies je kość.", "The dog eats a bone."))
    assert [d.text for d in pick_lines([a, b], {"Kot ma Alę."}, words)] == [
        "Ala ma kota.",
        "Pies je kość.",
    ]


def test_stops_at_the_most_a_drill_holds() -> None:
    texts = [read(i, *((f"line {j} of {i}", "x") for j in range(5))) for i in range(10)]
    assert len(pick_lines(texts, set(), words)) == line_drill.MAX_LINES


def test_offers_a_drill_only_with_enough_lines_and_says_from_where() -> None:
    lines = [DrillLine(1, i, "At the market", f"line {i} here", "x") for i in range(3)]
    assert offer(lines) is None
    lines.append(DrillLine(2, 0, "The flat", "another line here", "x"))
    found = offer(lines)
    assert found is not None
    assert found["lines"] == 4
    assert found["texts"] == [
        {"title": "At the market", "count": 3},
        {"title": "The flat", "count": 1},
    ]
    assert found["minutes"] >= 1
    assert minutes(lines * 5, words) > minutes(lines, words)


def test_each_line_is_answered_by_its_own_recording_twice_and_costs_nothing() -> None:
    plan = lesson.lines_plan(
        (
            lesson.Phrase("Ala ma kota.", "Ala has a cat.", ()),
            lesson.Phrase("Pies je kość.", "The dog eats a bone.", ()),
        )
    )
    steps = lesson.build_lines(plan, ("/a/1.mp3", "/a/2.mp3"))
    answers = [s for s in steps if isinstance(s, lesson.Say) and s.recording]
    assert [s.recording for s in answers] == ["/a/1.mp3", "/a/2.mp3", "/a/2.mp3", "/a/1.mp3"]
    assert sum(1 for s in steps if isinstance(s, lesson.Silence) and s.answer) == 4
    # Only the narrator's English is recorded new.
    narrated = {s.text for s in lesson.clips(steps) if not s.recording}
    assert lesson.characters(steps) == sum(len(t) for t in narrated)
    with pytest.raises(ValueError):
        lesson.build_lines(plan, ("/a/1.mp3",))


def test_a_recording_is_played_as_it_is(tmp_path: Path) -> None:
    clip = tmp_path / "3.mp3"
    clip.write_bytes(b"ID3line")

    async def never(text: str, voice: str, locale: str, rate: float) -> bytes:
        raise AssertionError("asked Azure for a recording that exists")

    speak = lesson_service.speaker(
        "pl", lambda _: {"male": "pl-PL-MarekNeural", "female": "pl-PL-ZofiaNeural"}, never
    )

    async def spoken() -> bytes:
        return await speak(lesson.Say("male", "Ala ma kota.", recording=str(clip)))

    assert asyncio.run(spoken()) == b"ID3line"


def save_read_text(
    conn: sqlite3.Connection, lines: list[tuple[str, str]], days_ago: int = 1
) -> int:
    generated = Generated(
        "Na targu", tuple(Line("A", t, e) for t, e in lines), {}, Coverage((), ()), 1, True, ()
    )
    text_id = store.save_text(
        conn,
        store.add_topic(conn, "market", NOW).id,
        generated,
        [],
        0.9,
        NOW,
        "ready",
        "dialogue",
        "fr",
    )
    store.log_reading(
        conn, text_id, Reading(None, True, (), (), 1.0, False, 60), NOW - timedelta(days=days_ago)
    )
    return text_id


def drill_client(tmp_path: Path, conn: sqlite3.Connection, mp3: bytes) -> TestClient:
    async def voice(text: str, name: str, language: str, rate: float = 1.0) -> Spoken:
        return Spoken(mp3)

    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1),
        synthesize=voice, audio=AudioCache(tmp_path / "audio"),
    )  # fmt: skip
    c = TestClient(create_app(engine, "open sesame", lessons_dir=tmp_path / "lessons"))
    c.__enter__()
    return c


LINES = [
    ("Je|voudrais|un|café.", "I'd like a coffee."),
    ("C'est|combien|ce|fromage ?", "How much is this cheese?"),
    ("Vous|avez|des|pommes ?", "Do you have apples?"),
    ("Je|prends|deux|baguettes.", "I'll take two baguettes."),
    ("Merci,|bonne|journée !", "Thanks, have a good day!"),
]


def test_a_drill_needs_enough_lines_read_lately(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    save_read_text(conn, LINES[:3])
    save_read_text(conn, LINES[3:], days_ago=line_drill.MAX_AGE_DAYS + 1)
    c = drill_client(tmp_path, conn, b"")
    try:
        assert c.get("/api/lessons?language=fr", headers=AUTH).json()["lines"] is None
        refused = c.post("/api/lessons/lines", json={"language": "fr"}, headers=AUTH)
        assert refused.status_code == 409 and "at least 4 lines" in refused.json()["detail"]
        assert c.post("/api/lessons/lines", json={"language": "fr"}).status_code == 401
    finally:
        c.__exit__(None, None, None)


@needs_ffmpeg
def test_makes_a_drill_from_lines_read_and_then_offers_others(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    save_read_text(conn, LINES)
    c = drill_client(tmp_path, conn, tone())
    try:
        on_offer = c.get("/api/lessons?language=fr", headers=AUTH).json()["lines"]
        assert on_offer["lines"] == 5 and on_offer["texts"] == [{"title": "Na targu", "count": 5}]
        made = c.post("/api/lessons/lines", json={"language": "fr"}, headers=AUTH)
        assert made.status_code == 202
        row = wait_for(c, made.json()["id"])
        assert row["state"] == "ready", row
        assert row["title"] == lesson.LINES_TITLE
        assert [p["text"] for p in row["phrases"]] == [
            "Je voudrais un café.", "C'est combien ce fromage?", "Vous avez des pommes?",
            "Je prends deux baguettes.", "Merci, bonne journée!",
        ]  # fmt: skip
        # Each line asked twice, every answer a turn.
        assert len(row["pauses"]) == 10
        # The lines were just drilled, so they rest for a week.
        assert c.get("/api/lessons?language=fr", headers=AUTH).json()["lines"] is None
    finally:
        c.__exit__(None, None, None)


@needs_ffmpeg
def test_a_slow_drill_answers_with_each_lines_slow_recording(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    text_id = save_read_text(conn, LINES)
    c = drill_client(tmp_path, conn, tone())
    try:
        made = c.post("/api/lessons/lines", json={"language": "fr", "slow": True}, headers=AUTH)
        row = wait_for(c, made.json()["id"])
        assert row["state"] == "ready", row
        assert row["phrases"] and "slowly" in lesson.lines_plan((), slow=True).scene
        audio = AudioCache(tmp_path / "audio")
        assert all(audio.has(text_id, i, True) for i in range(len(LINES)))
    finally:
        c.__exit__(None, None, None)
