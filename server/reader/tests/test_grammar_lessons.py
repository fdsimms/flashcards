import asyncio
import random
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from franki_reader import grammar, grammar_lessons, store
from franki_reader.app import create_app
from franki_reader.coverage import Lexicon
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.grammar_lessons import LessonFailed, check_examples, request_message
from franki_reader.lexicon import Entry
from franki_reader.tts import ClipCache, Spoken, azure_usd, billed_chars

NOW = datetime(2026, 11, 25, 9, 0)
AUTH = {"Authorization": "Bearer open sesame"}
WORDS = ["พรุ่งนี้", "ฉัน", "จะ", "ไป", "ตลาด", "ค่ะ", "เขา", "กิน", "ข้าว", "ครับ", "ผม", "บ้าน"]
ENTRIES = [Entry(i, w, w, "mature") for i, w in enumerate(WORDS, 1)]
FUTURE = grammar.POINTS["th.future"]


def ex(line: str, words: list[str]) -> dict[str, Any]:
    return {"line": line, "english": "An example.", "words": words}


GOOD = [
    ex("พรุ่งนี้ฉันจะไปตลาดค่ะ", ["จะ"]),
    ex("ฉันจะกินข้าว", ["จะ"]),
    ex("เขาจะไปตลาด", ["จะ"]),
    ex("เขาจะกลับบ้าน", ["จะ"]),
]


def test_the_request_carries_the_catalogs_explanation_and_the_voice_rule() -> None:
    sent = request_message(FUTURE)
    assert FUTURE.explanation and FUTURE.explanation in sent
    assert "จะ (will)" in sent and "never ครับ or ผม" in sent
    assert "never ครับ" not in request_message(grammar.POINTS["es.preterite"])


def test_an_example_is_kept_only_when_the_points_finder_finds_it_and_it_fits_the_voice() -> None:
    checker = Lexicon(WORDS)
    raw = [
        ex("ฉันไปตลาด", ["ไป"]),  # no จะ: the finder doesn't find the point
        ex("ผมจะกินข้าวครับ", ["จะ"]),  # a man's words, read in a woman's voice
        *GOOD,
    ]
    kept = check_examples(raw, checker, FUTURE)
    # เขาจะกลับบ้าน has one unknown word (กลับ), which is allowed; four are shown at most.
    assert [k["line"] for k in kept] == [g["line"] for g in GOOD]


def _engine() -> Engine:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    return Engine(conn, None, None, lambda: NOW, random.Random(1))


def _writer(answer: dict[str, Any] | Exception) -> grammar_lessons.WriteLesson:
    async def write(entries: list[Entry], point: grammar.Point) -> tuple[dict[str, Any], Usage]:
        if isinstance(answer, Exception):
            raise answer
        return answer, Usage()

    return write


def _write(e: Engine, answer: dict[str, Any] | Exception) -> store.GrammarLesson | None:
    store.start_grammar_lesson(e.conn, "th.future", NOW)
    asyncio.run(grammar_lessons.write_lesson(e.conn, e.snapshot, _writer(answer), "th.future", NOW))
    return store.get_grammar_lesson(e.conn, "th.future")


def test_a_lesson_is_kept_once_enough_examples_pass() -> None:
    lesson = _write(_engine(), {"examples": GOOD})
    assert lesson is not None and lesson.status == "ready" and len(lesson.examples) == 4


def test_too_few_examples_or_a_failed_call_fail_the_lesson_with_a_note() -> None:
    few = _write(_engine(), {"examples": GOOD[:2]})
    assert few is not None and (few.status, few.note) == ("failed", grammar_lessons.TOO_FEW)
    failed = _write(_engine(), LessonFailed("Claude didn't answer. Try again in a moment."))
    assert failed is not None and failed.status == "failed"
    assert failed.note == "Claude didn't answer. Try again in a moment."


def test_a_rewrite_that_fails_keeps_the_examples_already_there() -> None:
    e = _engine()
    _write(e, {"examples": GOOD})
    again = _write(e, {"examples": []})
    assert again is not None and again.status == "ready" and len(again.examples) == 4
    assert again.note == grammar_lessons.TOO_FEW


def test_one_write_runs_at_a_time() -> None:
    e = _engine()
    assert store.start_grammar_lesson(e.conn, "th.future", NOW)
    assert not store.start_grammar_lesson(e.conn, "th.future", NOW)


def test_asking_for_a_lesson_writes_it_then_serves_it() -> None:
    e = _engine()
    app = create_app(e, "open sesame", write_grammar_lesson=_writer({"examples": GOOD}))
    with TestClient(app) as c:
        first = c.get("/api/grammar/th.future/lesson", headers=AUTH).json()
        assert first == {"status": "writing", "note": "", "examples": []}
        ready = c.get("/api/grammar/th.future/lesson", headers=AUTH).json()
        assert ready["status"] == "ready" and len(ready["examples"]) == 4
        # No text to speech here, so no recording.
        assert ready["examples"][0] == {**GOOD[0], "audio": None}
        assert c.get("/api/grammar/xx.none/lesson", headers=AUTH).status_code == 404


def test_a_lessons_recorded_examples_are_its_audio_not_more_calls(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)

    async def synthesize(text: str, voice: str, locale: str, rate: float = 1.0) -> Spoken:
        return Spoken(b"mp3")

    async def write(entries: list[Entry], point: grammar.Point) -> tuple[dict[str, Any], Usage]:
        return {"examples": GOOD}, Usage(usd=0.5)

    e = Engine(conn, None, None, lambda: NOW, random.Random(1), synthesize=synthesize)
    app = create_app(e, "open sesame", write_grammar_lesson=write, clips=ClipCache(tmp_path))
    with TestClient(app) as c:
        c.get("/api/grammar/th.future/lesson", headers=AUTH)
        ready = c.get("/api/grammar/th.future/lesson", headers=AUTH).json()
        assert all(example["audio"] for example in ready["examples"])
        other = c.get("/api/costs", headers=AUTH).json()["other_calls"]
    chars = sum(billed_chars(g["line"]) for g in GOOD)
    assert other["features"] == [
        {
            "feature": "grammar_lessons",
            "asked": 1,  # the one call that wrote it, not one more for each of the four clips
            "cost_usd": 0.5,
            "audio_chars": chars,
            "azure_usd": round(azure_usd(chars), 4),
        }
    ]
    assert other["audio_chars"] == chars and other["azure_usd"] == round(azure_usd(chars), 4)


def test_without_claude_a_lesson_can_not_be_written() -> None:
    with TestClient(create_app(_engine(), "open sesame")) as c:
        assert c.get("/api/grammar/th.future/lesson", headers=AUTH).status_code == 503
        assert c.post("/api/grammar/th.future/lesson", headers=AUTH).status_code == 503


def test_a_write_cut_off_by_a_restart_can_be_started_again() -> None:
    conn = store.connect(":memory:")
    assert store.start_grammar_lesson(conn, "th.future", NOW)
    # The server restarted mid-write: nothing will ever finish it, and a new start was refused.
    assert not store.start_grammar_lesson(conn, "th.future", NOW)
    store.fail_interrupted_grammar_lessons(conn, grammar_lessons.FAILED)
    lesson = store.get_grammar_lesson(conn, "th.future")
    assert (
        lesson is not None and lesson.status == "failed" and lesson.note == grammar_lessons.FAILED
    )
    assert store.start_grammar_lesson(conn, "th.future", NOW)
