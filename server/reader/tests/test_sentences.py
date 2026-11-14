import asyncio
import json
import random
from dataclasses import replace
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW, started
from test_generator import FakeClient, finish, response

from franki_reader import sentences, store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.sentences import (
    BATCHES_PER_DAY,
    STOCK,
    Sentence,
    SentencesFailed,
    candidates,
    check,
    claude_sentences,
    request_message,
    serve,
)

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
MANGO = ENTRIES[3]
EAT = ENTRIES[2]
FULL = lexicon_from(ENTRIES, "th")
WORDS = {MANGO.text: MANGO}


def raw(sentence: str, word: str = MANGO.text) -> dict[str, str]:
    return {"word": word, "sentence": sentence, "english": "I want mango sticky rice."}


# ==== Checking a sentence ====


def test_keeps_a_sentence_that_uses_its_word() -> None:
    kept = check(raw("ฉันอยากกินข้าวเหนียวมะม่วงครับ"), WORDS, FULL, FULL, frozenset())
    assert kept == Sentence(4, MANGO.text, "ฉันอยากกินข้าวเหนียวมะม่วงครับ", "I want mango sticky rice.")


def test_drops_a_sentence_without_its_word() -> None:
    assert check(raw("ฉันอยากกินครับ"), WORDS, FULL, FULL, frozenset()) is None


def test_drops_a_sentence_using_a_word_waiting_for_its_review() -> None:
    held = frozenset({EAT.text})
    writing = lexicon_from(ENTRIES, "th", withheld=held)
    assert check(raw("ฉันอยากกินข้าวเหนียวมะม่วงครับ"), WORDS, writing, FULL, held) is None


def test_drops_a_sentence_with_too_many_unknown_words() -> None:
    # ทอน is unreviewed (unknown); two unknown words is one too many.
    assert check(raw("ฉันอยากทอนทุเรียนข้าวเหนียวมะม่วงครับ"), WORDS, FULL, FULL, frozenset()) is None


def test_drops_a_word_not_asked_for_markup_or_a_short_sentence() -> None:
    assert check(raw("ฉันอยากกินข้าวเหนียวมะม่วงครับ", "ครับ"), WORDS, FULL, FULL, frozenset()) is None
    assert check(raw("ฉัน|อยาก|กินข้าวเหนียวมะม่วงครับ"), WORDS, FULL, FULL, frozenset()) is None
    assert check(raw("ข้าวเหนียวมะม่วงครับ"), WORDS, FULL, FULL, frozenset()) is None
    assert check({"word": MANGO.text}, WORDS, FULL, FULL, frozenset()) is None


def test_candidates_are_reviewed_today_or_young_never_waiting() -> None:
    entries = [*ENTRIES, Entry(8, "ไป", "go", "young", due=True)]
    assert [e.text for e in candidates(entries, 0, random.Random(1))] == [MANGO.text]


def test_the_request_names_each_word() -> None:
    assert f"- {MANGO.text} ({MANGO.meaning})" in request_message("th", [MANGO])
    assert "no spaces between words" in request_message("th", [MANGO])


# ==== Topping up and serving ====


def top_up(
    conn: Any, write: Any, words: list[Entry] | None = None, writing: set[Any] | None = None
) -> None:
    asyncio.run(
        sentences.top_up(
            conn,
            "th",
            words or [MANGO],
            lambda code, keep: (ENTRIES, FULL),
            FULL,
            frozenset(),
            write,
            lambda: NOW,
            writing if writing is not None else set(),
        )
    )


def test_writes_for_a_word_short_of_stock_then_serves_it_least_recently_served_first() -> None:
    conn = store.connect(":memory:")
    asked: list[list[str]] = []

    async def write(
        entries: list[Entry], language: str, words: list[Entry]
    ) -> tuple[list[Any], Usage]:
        asked.append([w.text for w in words])
        return [
            raw("ฉันอยากกินข้าวเหนียวมะม่วงครับ"),
            raw("ฉันกินข้าวเหนียวมะม่วงครับ"),
            raw("ฉันอยากกินครับ"),
        ], COST

    top_up(conn, write)
    assert asked == [[MANGO.text]]
    assert store.sentence_stock(conn, "th") == {MANGO.text: 2}
    # Full: nothing more is asked for.
    top_up(conn, write)
    assert len(asked) == 1
    first = serve(conn, "th", [MANGO], 5, NOW, frozenset({MANGO.text}))
    second = serve(conn, "th", [MANGO], 5, NOW + timedelta(minutes=1), frozenset())
    assert [s["sentence"] for s in first + second] == [
        "ฉันอยากกินข้าวเหนียวมะม่วงครับ",
        "ฉันกินข้าวเหนียวมะม่วงครับ",
    ]
    assert first[0]["reviewed_today"] is True and first[0]["meaning"] == MANGO.meaning
    assert STOCK == 2


def test_stops_at_the_days_calls_and_keeps_a_failed_calls_cost() -> None:
    conn = store.connect(":memory:")
    calls = 0

    async def write(
        entries: list[Entry], language: str, words: list[Entry]
    ) -> tuple[list[Any], Usage]:
        nonlocal calls
        calls += 1
        raise SentencesFailed("No sentences", COST)

    for _ in range(BATCHES_PER_DAY + 2):
        top_up(conn, write)
    assert calls == BATCHES_PER_DAY
    assert store.sentence_spending(conn, NOW - timedelta(days=1))["th"] == (BATCHES_PER_DAY, 6.0)


def test_skips_a_language_already_being_written() -> None:
    conn = store.connect(":memory:")

    async def write(
        entries: list[Entry], language: str, words: list[Entry]
    ) -> tuple[list[Any], Usage]:
        raise AssertionError("not asked")

    top_up(conn, write, writing={"th"})


def test_claude_writes_a_batch() -> None:
    fake = FakeClient(response("end_turn", json.dumps({"sentences": [raw("x")]})))
    got, used = finish(claude_sentences(fake)(ENTRIES, "th", [MANGO]))  # type: ignore[arg-type]
    assert got == [raw("x")] and used.cost_usd() > 0


# ==== The API ====


def client(write: Any = None) -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    return started(create_app(engine, "open sesame", write_sentences=write))


def test_serves_nothing_at_first_then_what_was_written() -> None:
    async def write(
        entries: list[Entry], language: str, words: list[Entry]
    ) -> tuple[list[Any], Usage]:
        return [raw("ฉันอยากกินข้าวเหนียวมะม่วงครับ")], COST

    app = client(write)
    first = app.post("/api/sentences", json={"language": "th"}, headers=AUTH).json()
    assert first == {"sentences": [], "writing": True}
    second = app.post("/api/sentences", json={"language": "th"}, headers=AUTH).json()
    assert [s["word"] for s in second["sentences"]] == [MANGO.text]
    assert second["sentences"][0]["reviewed_today"] is True
    # One sentence is short of STOCK, so the second round asked for more as well.
    assert app.get("/api/costs", headers=AUTH).json()["sentences"]["batches"] == 2


def test_a_word_due_and_not_reviewed_is_never_served() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, [replace(e, due=True) if e is MANGO else e for e in ENTRIES], NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    app = started(create_app(engine, "open sesame"))
    assert (
        app.post("/api/sentences", json={"language": "th"}, headers=AUTH).json()["sentences"] == []
    )


def test_needs_the_passphrase() -> None:
    assert client().post("/api/sentences", json={"language": "th"}).status_code == 401
