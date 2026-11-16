import random
import shutil
import sqlite3
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.lesson_writer import LessonFailed, WritePlan
from franki_reader.tts import Spoken

PLAN: dict[str, Any] = {
    "title": "At the café",
    "dialogue": [
        {
            "speaker": "A",
            "text": "Bonjour, vous désirez ?",
            "english": "Hello, what would you like?",
        },
        {"speaker": "B", "text": "Un café, s'il vous plaît.", "english": "A coffee, please."},
    ],
    "phrases": [
        {"text": "Un café.", "english": "A coffee.", "parts": ["Un café."]},
        {"text": "S'il vous plaît.", "english": "Please.", "parts": ["S'il vous plaît."]},
        {
            "text": "L'addition, s'il vous plaît.",
            "english": "The check, please.",
            "parts": ["L'addition", "s'il vous plaît"],
        },
    ],
}

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg isn't installed")


def tone() -> bytes:
    return subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3",
         "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", "-f", "mp3", "pipe:1"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip


async def write_plan(language: str, scene: str, feedback: str) -> tuple[Any, Usage]:
    return PLAN, Usage(input_tokens=1000, output_tokens=400, model="claude-sonnet-5-5")


_open: list[TestClient] = []


@pytest.fixture(autouse=True)
def _close() -> Iterator[None]:
    yield
    while _open:
        _open.pop().__exit__(None, None, None)


def lesson_client(
    tmp_path: Path,
    *,
    claude: bool = True,
    azure: bool = True,
    folder: bool = True,
    mp3: bytes = b"",
    writer: WritePlan = write_plan,
    conn: sqlite3.Connection | None = None,
) -> TestClient:
    async def voice(text: str, name: str, language: str) -> Spoken:
        return Spoken(mp3)

    conn = conn or store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: NOW,
        random.Random(1),
        synthesize=voice if azure else None,
    )
    app = create_app(
        engine,
        "open sesame",
        write_lesson=writer if claude else None,
        lessons_dir=tmp_path / "lessons" if folder else None,
    )
    c = TestClient(app)
    c.__enter__()
    _open.append(c)
    return c


def wait_for(c: TestClient, lesson_id: int) -> dict[str, Any]:
    deadline = time.time() + 20
    while True:
        rows = c.get("/api/lessons", headers=AUTH).json()["lessons"]
        row = next(r for r in rows if r["id"] == lesson_id)
        if row["state"] != "making" or time.time() > deadline:
            return row  # type: ignore[no-any-return]
        time.sleep(0.05)


def test_the_routes_need_the_passphrase(tmp_path: Path) -> None:
    c = lesson_client(tmp_path)
    assert c.get("/api/lessons").status_code == 401
    assert c.post("/api/lessons", json={"language": "fr", "scene": "x"}).status_code == 401
    assert c.get("/api/lessons/1/audio").status_code == 401
    assert c.delete("/api/lessons/1").status_code == 401


def test_lists_the_languages_a_lesson_can_be_made_in(tmp_path: Path) -> None:
    body = lesson_client(tmp_path).get("/api/lessons", headers=AUTH).json()
    assert body == {"languages": ["fr", "th", "es", "de", "ru", "el", "pl", "nb"], "lessons": []}


@pytest.mark.parametrize(
    ("kwargs", "words"),
    [
        ({"claude": False}, "Claude isn't set up"),
        ({"azure": False}, "Azure isn't set up"),
        ({"folder": False}, "no folder"),
    ],
)
def test_says_what_is_missing_on_the_server(tmp_path: Path, kwargs: Any, words: str) -> None:
    c = lesson_client(tmp_path, **kwargs)
    r = c.post("/api/lessons", json={"language": "fr", "scene": "a café"}, headers=AUTH)
    assert r.status_code == 503
    assert words in r.json()["detail"]
    assert c.get("/api/lessons", headers=AUTH).json()["lessons"] == []


@pytest.mark.parametrize("narrator", ["fr-FR-HenriNeural", "Guy", "en-US-Guy Neural"])
def test_refuses_a_narrator_that_is_not_an_english_voice(tmp_path: Path, narrator: str) -> None:
    c = lesson_client(tmp_path)
    r = c.post(
        "/api/lessons",
        json={"language": "fr", "scene": "a café", "narrator": narrator},
        headers=AUTH,
    )
    assert r.status_code == 422
    assert "English voice" in r.json()["detail"]
    assert c.get("/api/lessons", headers=AUTH).json()["lessons"] == []


def test_refuses_a_language_it_cannot_make_yet(tmp_path: Path) -> None:
    r = lesson_client(tmp_path).post(
        "/api/lessons", json={"language": "ja", "scene": "a café"}, headers=AUTH
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "Audio lessons aren't made in Japanese yet."


@pytest.mark.parametrize("scene", ["", "   ", "x" * 201])
def test_refuses_a_scene_that_is_empty_or_too_long(tmp_path: Path, scene: str) -> None:
    r = lesson_client(tmp_path).post(
        "/api/lessons", json={"language": "fr", "scene": scene}, headers=AUTH
    )
    assert r.status_code == 422


def test_refuses_a_third_lesson_while_two_are_being_made(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    store.add_lesson(conn, "fr", "one", NOW)
    store.add_lesson(conn, "fr", "two", NOW)
    c = lesson_client(tmp_path, conn=conn)
    r = c.post("/api/lessons", json={"language": "fr", "scene": "three"}, headers=AUTH)
    assert r.status_code == 409
    assert "Two lessons are already being made" in r.json()["detail"]
    assert len(store.lessons(conn)) == 2


def test_a_finished_lesson_does_not_count_against_the_limit(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    for scene in ("one", "two"):
        store.fail_lesson(conn, store.add_lesson(conn, "fr", scene, NOW), "x")
    c = lesson_client(tmp_path, conn=conn)
    r = c.post("/api/lessons", json={"language": "fr", "scene": "three"}, headers=AUTH)
    assert r.status_code == 202


@needs_ffmpeg
def test_makes_a_lesson_in_the_background_and_serves_its_audio(tmp_path: Path) -> None:
    c = lesson_client(tmp_path, mp3=tone())
    made = c.post(
        "/api/lessons", json={"language": "fr", "scene": " ordering  a coffee "}, headers=AUTH
    )
    assert made.status_code == 202
    row = wait_for(c, made.json()["id"])
    assert row["state"] == "ready", row
    assert row["title"] == "At the café"
    assert row["scene"] == "ordering a coffee"
    assert [p["english"] for p in row["phrases"]] == ["A coffee.", "Please.", "The check, please."]
    assert row["duration_ms"] > 60_000
    audio = c.get(f"/api/lessons/{row['id']}/audio", headers=AUTH)
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/mpeg"
    assert len(audio.content) > 10_000
    costs = c.get("/api/costs", headers=AUTH).json()["lessons"]
    assert costs["made"] == 1
    assert costs["audio_chars"] > 0


@needs_ffmpeg
def test_the_narrator_chosen_is_the_voice_azure_is_asked_for(tmp_path: Path) -> None:
    asked: list[str] = []
    clip = tone()

    async def voice(text: str, name: str, language: str) -> Spoken:
        asked.append(name)
        return Spoken(clip)

    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1), synthesize=voice
    )
    app = create_app(
        engine, "open sesame", write_lesson=write_plan, lessons_dir=tmp_path / "lessons"
    )
    c = TestClient(app)
    c.__enter__()
    _open.append(c)
    made = c.post(
        "/api/lessons",
        json={"language": "fr", "scene": "a café", "narrator": "en-GB-RyanNeural"},
        headers=AUTH,
    )
    assert made.status_code == 202
    assert wait_for(c, made.json()["id"])["state"] == "ready"
    assert "en-GB-RyanNeural" in asked
    assert "en-US-GuyNeural" not in asked


def test_a_lesson_that_cannot_be_spoken_is_failed_with_its_reason(tmp_path: Path) -> None:
    # Azure's clip isn't audio, so ffmpeg can't read it (or isn't there): either way the lesson fails.
    c = lesson_client(tmp_path, mp3=b"not audio")
    made = c.post("/api/lessons", json={"language": "fr", "scene": "a café"}, headers=AUTH)
    row = wait_for(c, made.json()["id"])
    assert row["state"] == "failed"
    assert "ffmpeg" in row["error"]
    assert c.get(f"/api/lessons/{row['id']}/audio", headers=AUTH).status_code == 404


def test_a_lesson_claude_cannot_write_is_failed_with_its_reason(tmp_path: Path) -> None:
    async def refuses(language: str, scene: str, feedback: str) -> tuple[Any, Usage]:
        raise LessonFailed("Claude didn't answer. Try again in a moment.")

    c = lesson_client(tmp_path, writer=refuses)
    made = c.post("/api/lessons", json={"language": "fr", "scene": "a café"}, headers=AUTH)
    row = wait_for(c, made.json()["id"])
    assert (row["state"], row["error"]) == (
        "failed",
        "Claude didn't answer. Try again in a moment.",
    )


def test_a_lesson_not_ready_has_no_audio_and_an_unknown_one_is_not_found(tmp_path: Path) -> None:
    c = lesson_client(tmp_path)
    assert c.get("/api/lessons/99/audio", headers=AUTH).status_code == 404
    assert c.delete("/api/lessons/99", headers=AUTH).status_code == 404


@needs_ffmpeg
def test_deleting_a_lesson_forgets_it_and_its_file(tmp_path: Path) -> None:
    c = lesson_client(tmp_path, mp3=tone())
    lesson_id = c.post(
        "/api/lessons", json={"language": "fr", "scene": "a café"}, headers=AUTH
    ).json()["id"]
    assert wait_for(c, lesson_id)["state"] == "ready"
    file = tmp_path / "lessons" / f"{lesson_id}.mp3"
    assert file.is_file()
    assert c.delete(f"/api/lessons/{lesson_id}", headers=AUTH).status_code == 204
    assert not file.exists()
    assert c.get("/api/lessons", headers=AUTH).json()["lessons"] == []
