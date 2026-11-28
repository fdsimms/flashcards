"""Your words (lesson.build_words): words the app picked from the deck, made into a lesson."""

import random
import sqlite3
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW
from test_app_lessons import needs_ffmpeg, tone, wait_for

from franki_reader import lesson, store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.tts import AudioCache, Spoken

KOT = lesson.Phrase("kot", "cat", ("kot",))
PIES = lesson.Phrase("pies", "dog", ("pies",))


def says(steps: list[lesson.Step]) -> list[tuple[str, str]]:
    return [(s.voice, s.text) for s in steps if isinstance(s, lesson.Say)]


def test_each_word_then_a_pause_then_its_meaning_and_its_example() -> None:
    plan = lesson.words_plan((KOT, PIES))
    steps = lesson.build_words(plan, (lesson.Example("Mam kota.", "I have a cat."), None))
    assert says(steps)[1:-1] == [
        ("male", "kot"), ("narrator", "cat"), ("male", "Mam kota."), ("narrator", "I have a cat."),
        ("male", "pies"), ("narrator", "dog"),
    ]  # fmt: skip
    turns = [s for s in steps if isinstance(s, lesson.Silence) and s.answer]
    # One turn a word, never shorter than the time to recall it.
    assert len(turns) == 2 and all(s.ms >= lesson.RECALL_MS for s in turns)
    assert plan.title == lesson.WORDS_TITLE and plan.scene == "2 words from your deck"


def test_meaning_first_asks_for_the_word() -> None:
    plan = lesson.words_plan((KOT,))
    steps = lesson.build_words(plan, (None,), meaning_first=True, learner="female")
    assert says(steps)[1:-1] == [("narrator", "cat"), ("female", "kot")]
    assert "say the word" in steps[0].text  # type: ignore[union-attr]


def client(tmp_path: Path, conn: sqlite3.Connection, mp3: bytes) -> TestClient:
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


def word(text: str, english: str, **more: Any) -> dict[str, Any]:
    return {"text": text, "english": english, **more}


WORDS = [
    word("kot", "cat", example="Mam kota.", example_english="I have a cat."),
    word("pies", "dog"),
    word("dom", "house", example="  ", example_english="ignored"),
]


@needs_ffmpeg
def test_makes_the_lesson_from_the_words_sent(tmp_path: Path) -> None:
    c = client(tmp_path, store.connect(":memory:"), tone())
    try:
        made = c.post(
            "/api/lessons/your-words", json={"language": "pl", "words": WORDS}, headers=AUTH
        )
        assert made.status_code == 202, made.json()
        row = wait_for(c, made.json()["id"])
        assert row["state"] == "ready", row
        assert row["title"] == lesson.WORDS_TITLE
        assert [p["text"] for p in row["phrases"]] == ["kot", "pies", "dom"]
        assert len(row["pauses"]) == 3  # a turn to recall each word
    finally:
        c.__exit__(None, None, None)


def test_too_few_or_too_many_words_or_no_passphrase_is_refused(tmp_path: Path) -> None:
    c = client(tmp_path, store.connect(":memory:"), b"")
    try:
        few = c.post(
            "/api/lessons/your-words", json={"language": "pl", "words": WORDS[:2]}, headers=AUTH
        )
        assert few.status_code == 422
        many = [word(f"w{i}", "x") for i in range(lesson.WORDS_MAX + 1)]
        assert (
            c.post(
                "/api/lessons/your-words", json={"language": "pl", "words": many}, headers=AUTH
            ).status_code
            == 422
        )
        assert (
            c.post("/api/lessons/your-words", json={"language": "pl", "words": WORDS}).status_code
            == 401
        )
        # Toki Pona has no voices to make a lesson in.
        tok = c.post(
            "/api/lessons/your-words", json={"language": "tok", "words": WORDS}, headers=AUTH
        )
        assert tok.status_code == 422
    finally:
        c.__exit__(None, None, None)
