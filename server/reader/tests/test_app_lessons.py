import asyncio
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

from franki_reader import lesson_audio, store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.lesson import Phrase, Say, Silence, Step
from franki_reader.lesson_topics import TopicsFailed, WriteTopics
from franki_reader.lesson_writer import LessonFailed, WriteGiven, WritePlan
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


async def write_plan(
    language: str, scene: str, feedback: str, learner: str = "male", register: str = "everyday"
) -> tuple[Any, Usage]:
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
    given_writer: WriteGiven | None = None,
    topics_writer: WriteTopics | None = None,
    conn: sqlite3.Connection | None = None,
) -> TestClient:
    async def voice(text: str, name: str, language: str, rate: float = 1.0) -> Spoken:
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
        write_given_lesson=given_writer if claude else None,
        write_lesson_topics=topics_writer if claude else None,
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
    assert c.post("/api/lessons/review", json={"language": "fr"}).status_code == 401
    assert c.get("/api/lessons/1/phrases/0/audio").status_code == 401
    mark = {"text": "x", "english": "x", "reason": "again"}
    assert c.post("/api/lessons/1/marks", json=mark).status_code == 401


def test_lists_the_languages_a_lesson_can_be_made_in(tmp_path: Path) -> None:
    body = lesson_client(tmp_path).get("/api/lessons", headers=AUTH).json()
    assert body == {
        "languages": ["fr", "th", "es", "de", "ru", "el", "pl", "nb", "ja"],
        "lessons": [],
        "review": None,
    }


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
        "/api/lessons", json={"language": "en", "scene": "a café"}, headers=AUTH
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "Audio lessons aren't made in English yet."


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
    # Every place the learner speaks: each phrase built up and asked, the recalls, the role-play.
    assert len(row["pauses"]) >= 8
    assert all(0 < start < end <= row["duration_ms"] for start, end in row["pauses"])
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

    async def voice(text: str, name: str, language: str, rate: float = 1.0) -> Spoken:
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
    async def refuses(
        language: str, scene: str, feedback: str, learner: str = "male", register: str = "everyday"
    ) -> tuple[Any, Usage]:
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


async def write_given(
    language: str,
    scene: str,
    given: tuple[Phrase, ...],
    feedback: str,
    learner: str = "male",
    register: str = "everyday",
) -> tuple[Any, Usage]:
    return PLAN, Usage(input_tokens=1000, output_tokens=400, model="claude-sonnet-5-5")


def test_refuses_given_phrases_that_are_empty_or_too_many(tmp_path: Path) -> None:
    c = lesson_client(tmp_path, given_writer=write_given)
    body = {"language": "fr", "scene": "a lesson"}
    assert c.post("/api/lessons", json={**body, "phrases": []}, headers=AUTH).status_code == 422
    blank = [{"text": " ", "english": " "}]
    assert c.post("/api/lessons", json={**body, "phrases": blank}, headers=AUTH).status_code == 422
    many = [{"text": f"mot {i}", "english": f"word {i}"} for i in range(16)]
    assert c.post("/api/lessons", json={**body, "phrases": many}, headers=AUTH).status_code == 422


def test_given_phrases_need_claude(tmp_path: Path) -> None:
    c = lesson_client(tmp_path)
    phrases = [{"text": "presque", "english": "almost"}]
    made = c.post(
        "/api/lessons", json={"language": "fr", "scene": "x", "phrases": phrases}, headers=AUTH
    )
    assert made.status_code == 503


@needs_ffmpeg
def test_makes_a_lesson_from_given_phrases(tmp_path: Path) -> None:
    c = lesson_client(tmp_path, mp3=tone(), given_writer=write_given)
    phrases = [
        {"text": "Un café.", "english": "a coffee"},
        {"text": "presque", "english": "almost"},
    ]
    made = c.post(
        "/api/lessons",
        json={"language": "fr", "scene": "Thai lesson", "phrases": phrases},
        headers=AUTH,
    )
    assert made.status_code == 202
    row = wait_for(c, made.json()["id"])
    assert row["state"] == "ready", row
    assert [p["text"] for p in row["phrases"]] == ["Un café.", "presque"]


@needs_ffmpeg
def test_finds_the_pauses_of_a_lesson_made_before_they_were_kept(tmp_path: Path) -> None:
    async def speak(clip: Say) -> bytes:
        return tone()

    async def keep(clip: bytes) -> bytes:
        return clip

    steps: list[Step] = [Say("narrator", "Go."), Silence(3500, answer=True), Say("male", "Oui.")]
    rendered = asyncio.run(lesson_audio.render(steps, speak, level_clip=keep))
    conn = store.connect(":memory:")
    lesson_id = store.add_lesson(conn, "fr", "an old one", NOW)
    with conn:
        conn.execute(
            "UPDATE lessons SET state = 'ready', duration_ms = ? WHERE id = ?",
            (rendered.duration_ms, lesson_id),
        )
    (tmp_path / "lessons").mkdir()
    (tmp_path / "lessons" / f"{lesson_id}.mp3").write_bytes(rendered.audio)
    c = lesson_client(tmp_path, conn=conn)
    first = c.get("/api/lessons", headers=AUTH).json()["lessons"][0]
    # Not known yet: listened for once the list has been sent.
    assert first["pauses"] is None
    [(start, end)] = c.get("/api/lessons", headers=AUTH).json()["lessons"][0]["pauses"]
    [(kept_start, kept_end)] = rendered.pauses
    assert abs(start - kept_start) <= 120
    assert abs(end - kept_end) <= 120


def test_an_old_lesson_whose_audio_is_gone_keeps_playing_straight_through(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    lesson_id = store.add_lesson(conn, "fr", "an old one", NOW)
    with conn:
        conn.execute("UPDATE lessons SET state = 'ready' WHERE id = ?", (lesson_id,))
    c = lesson_client(tmp_path, conn=conn)
    assert c.get("/api/lessons", headers=AUTH).json()["lessons"][0]["pauses"] is None
    assert c.get("/api/lessons", headers=AUTH).json()["lessons"][0]["pauses"] is None


def made(c: TestClient) -> dict[str, Any]:
    lesson_id = c.post(
        "/api/lessons", json={"language": "fr", "scene": "a coffee"}, headers=AUTH
    ).json()["id"]
    row = wait_for(c, lesson_id)
    assert row["state"] == "ready", row
    return row


@needs_ffmpeg
def test_a_lesson_comes_with_its_transcript_and_each_phrase_can_be_cut_out(
    tmp_path: Path,
) -> None:
    c = lesson_client(tmp_path, mp3=tone())
    row = made(c)
    turns = [e for e in row["script"] if e["kind"] == "turn"]
    assert [[t["start"], t["end"]] for t in turns] == row["pauses"]
    assert any(t["english"] == "The check, please." for t in turns)
    clip = c.get(f"/api/lessons/{row['id']}/phrases/0/audio", headers=AUTH)
    assert clip.status_code == 200
    assert clip.headers["content-type"] == "audio/mpeg"
    assert 0 < len(clip.content) < 20_000
    assert c.get(f"/api/lessons/{row['id']}/phrases/9/audio", headers=AUTH).status_code == 404


def test_an_older_lesson_has_no_transcript_and_no_phrase_audio(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    lesson_id = store.add_lesson(conn, "fr", "an old one", NOW)
    with conn:
        conn.execute("UPDATE lessons SET state = 'ready' WHERE id = ?", (lesson_id,))
    c = lesson_client(tmp_path, conn=conn)
    assert c.get("/api/lessons", headers=AUTH).json()["lessons"][0]["script"] is None
    audio = c.get(f"/api/lessons/{lesson_id}/phrases/0/audio", headers=AUTH)
    assert audio.status_code == 404


def mark(c: TestClient, lesson_id: int, text: str, reason: str = "again") -> int:
    return c.post(
        f"/api/lessons/{lesson_id}/marks",
        json={"text": text, "english": f"{text} in English", "reason": reason},
        headers=AUTH,
    ).status_code


def review_on_offer(c: TestClient) -> Any:
    return c.get("/api/lessons?language=fr", headers=AUTH).json()["review"]


@needs_ffmpeg
def test_marked_phrases_are_offered_as_a_review_once_there_are_enough(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    c = lesson_client(tmp_path, mp3=tone(), conn=conn)
    row = made(c)
    assert mark(c, row["id"], "Un café.") == 204
    assert mark(c, row["id"], "Un café.", "slow") == 204
    assert mark(c, row["id"], "S'il vous plaît.") == 204
    # Two phrases (one marked twice) aren't a review yet.
    assert review_on_offer(c) is None
    refused = c.post("/api/lessons/review", json={"language": "fr"}, headers=AUTH)
    assert refused.status_code == 409
    assert mark(c, row["id"], "L'addition, s'il vous plaît.", "slow") == 204
    assert review_on_offer(c) == {
        "phrases": 3,
        "lessons": [{"title": "At the café", "count": 3}],
    }
    review_id = c.post("/api/lessons/review", json={"language": "fr"}, headers=AUTH).json()["id"]
    review = wait_for(c, review_id)
    assert review["state"] == "ready", review
    assert review["title"] == "Review"
    assert [p["text"] for p in review["phrases"]] == [
        "Un café.",
        "S'il vous plaît.",
        "L'addition, s'il vous plaît.",
    ]
    # Each phrase asked twice, every answer a turn.
    assert len(review["pauses"]) == 6
    # The phrases went into the review, so none are waiting now.
    assert review_on_offer(c) is None
    # Asked to hear again after its review, a phrase waits for the next one.
    assert mark(c, row["id"], "Un café.") == 204
    assert [m.text for m in store.open_lesson_marks(conn, "fr")] == ["Un café."]


def test_marks_a_phrase_only_in_a_lesson_that_is_there(tmp_path: Path) -> None:
    c = lesson_client(tmp_path)
    assert mark(c, 99, "Un café.") == 404


def test_notes_a_lesson_played_to_the_end(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    lesson_id = store.add_lesson(conn, "fr", "a café", NOW)
    c = lesson_client(tmp_path, conn=conn)
    assert c.post(f"/api/lessons/{lesson_id}/heard").status_code == 401
    assert c.post(f"/api/lessons/{lesson_id}/heard", headers=AUTH).status_code == 204
    assert c.post("/api/lessons/99/heard", headers=AUTH).status_code == 404
    assert conn.execute("SELECT heard_at FROM lessons WHERE id = ?", (lesson_id,)).fetchone()[0]


TOPICS_USED = Usage(input_tokens=200, output_tokens=60, model="claude-sonnet-5-5")


def topics_client(tmp_path: Path, asked: list[Any], answer: Any, **kwargs: Any) -> TestClient:
    async def write(
        language: str, words: tuple[str, ...], avoid: tuple[str, ...]
    ) -> tuple[Any, Usage]:
        asked.append((language, words, avoid))
        return answer, TOPICS_USED

    return lesson_client(tmp_path, topics_writer=write, **kwargs)


def test_suggests_scenes_and_keeps_what_it_cost(tmp_path: Path) -> None:
    asked: list[Any] = []
    conn = store.connect(":memory:")
    answer = {"topics": ["Ordering a coffee.", " At the market ", "ordering A coffee"]}
    c = topics_client(tmp_path, asked, answer, conn=conn)
    r = c.post("/api/lessons/topics", json={"language": "fr"}, headers=AUTH)
    assert r.status_code == 200
    assert r.json() == {"topics": ["Ordering a coffee", "At the market"]}
    assert asked == [("fr", (), ())]
    rows = conn.execute("SELECT feature, language FROM call_costs").fetchall()
    assert [tuple(row) for row in rows] == [("lesson_topics", "fr")]
    costs = c.get("/api/costs", headers=AUTH).json()
    assert costs["lesson_topics"]["asked"] == 1
    assert costs["lesson_topics"]["cost_usd"] > 0
    assert costs["lessons"]["made"] == 0


def test_sends_the_learners_words_and_what_is_already_taken(tmp_path: Path) -> None:
    asked: list[Any] = []
    conn = store.connect(":memory:")
    store.add_lesson(conn, "fr", "Ordering a coffee", NOW)
    store.add_lesson(conn, "th", "Taking a taxi", NOW)
    c = topics_client(tmp_path, asked, {"topics": ["Ordering a coffee", "At the bank"]}, conn=conn)
    body = {
        "language": "fr",
        "phrases": [{"text": "Un café.", "english": "A coffee."}],
        "shown": ["At the park"],
    }
    r = c.post("/api/lessons/topics", json=body, headers=AUTH)
    assert r.json() == {"topics": ["At the bank"]}
    assert asked == [("fr", ("Un café. (A coffee.)",), ("At the park", "Ordering a coffee"))]


def test_says_when_claude_has_nothing_new(tmp_path: Path) -> None:
    c = topics_client(tmp_path, [], {"topics": ["", 3]})
    r = c.post("/api/lessons/topics", json={"language": "fr"}, headers=AUTH)
    assert r.status_code == 503
    assert r.json()["detail"] == "Claude had no new ideas. Try again."


def test_a_failed_ask_is_shown_and_its_cost_kept(tmp_path: Path) -> None:
    async def write(
        language: str, words: tuple[str, ...], avoid: tuple[str, ...]
    ) -> tuple[Any, Usage]:
        raise TopicsFailed("Claude's answer couldn't be read. Try again.", TOPICS_USED)

    conn = store.connect(":memory:")
    c = lesson_client(tmp_path, topics_writer=write, conn=conn)
    r = c.post("/api/lessons/topics", json={"language": "fr"}, headers=AUTH)
    assert r.status_code == 503
    assert r.json()["detail"] == "Claude's answer couldn't be read. Try again."
    assert conn.execute("SELECT COUNT(*) FROM call_costs").fetchone()[0] == 1


def test_topics_need_claude_the_passphrase_and_a_language_with_lessons(tmp_path: Path) -> None:
    c = topics_client(tmp_path, [], {"topics": ["x"]})
    assert c.post("/api/lessons/topics", json={"language": "fr"}).status_code == 401
    assert c.post("/api/lessons/topics", json={"language": "en"}, headers=AUTH).status_code == 422
    off = lesson_client(tmp_path, claude=False)
    r = off.post("/api/lessons/topics", json={"language": "fr"}, headers=AUTH)
    assert r.status_code == 503
    assert "Claude isn't set up" in r.json()["detail"]
