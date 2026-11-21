import json
import random
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW, started
from test_generator import FakeClient, finish, response

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.lesson import MAX_CHARS
from franki_reader.lesson_words import (
    MAX_CANDIDATES,
    Candidate,
    LessonWordsFailed,
    claude_find_words,
    clean,
)

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
NEW = Candidate("ใหม่", "mài", "new")


def client(find: Any = None) -> tuple[TestClient, Any]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 10, 19, 9),
        random.Random(1),
    )
    app = create_app(engine, "open sesame", None, find_lesson_words=find)
    return started(app), conn


def costs(conn: Any) -> list[tuple[str, str]]:
    return [tuple(r) for r in conn.execute("SELECT feature, language FROM call_costs")]


def test_only_thai_script_words_with_a_meaning_are_kept_once_each() -> None:
    answer = {
        "candidates": [
            {"text": "ใหม่", "reading": "mài", "english": " new "},
            {"text": "ใหม่", "reading": "mài", "english": "again"},  # the same word twice
            {"text": "mai", "reading": "mai", "english": "romanization handed back"},
            {"text": "ไม่ mai", "reading": "mâi", "english": "mixed"},
            {"text": "ไม้", "reading": "máai", "english": ""},  # no meaning
            {"text": "ไหม", "reading": "mǎi", "english": "x" * (MAX_CHARS + 1)},  # too long to send
            {"text": 3, "reading": "", "english": "junk"},
            "junk",
            {"text": "ไม่", "reading": "mâi", "english": "not"},
        ]
    }
    assert clean(answer, "th") == [NEW, Candidate("ไม่", "mâi", "not")]
    assert clean({"candidates": "no"}, "th") == []


def test_commonness_and_register_are_kept_only_when_they_are_on_the_lists() -> None:
    answer = {
        "candidates": [
            {
                "text": "ใหม่",
                "reading": "mài",
                "english": "new",
                "commonness": "very_common",
                "register": "neutral",
            },
            {
                "text": "ไม่",
                "reading": "mâi",
                "english": "not",
                "commonness": "popular",
                "register": 3,
            },
            {"text": "ไม้", "reading": "máai", "english": "wood"},  # an older answer with neither
        ]
    }
    assert clean(answer, "th") == [
        Candidate("ใหม่", "mài", "new", "very_common", "neutral"),
        Candidate("ไม่", "mâi", "not"),
        Candidate("ไม้", "máai", "wood"),
    ]


@pytest.mark.parametrize(
    "language,good,romanized",
    [
        ("ru", "спасибо", "spasibo"),
        ("el", "ευχαριστώ", "efcharisto"),
        ("ja", "ありがとう", "arigatou"),
        ("ja", "約束", "yakusoku"),
    ],
)
def test_each_language_keeps_its_own_script_and_drops_the_romanization(
    language: str, good: str, romanized: str
) -> None:
    answer = {
        "candidates": [
            {"text": romanized, "reading": "x", "english": "handed back"},
            {"text": good, "reading": "x", "english": "thanks"},
            {"text": "ไม่", "reading": "x", "english": "another language's script"},
        ]
    }
    assert clean(answer, language) == [Candidate(good, "x", "thanks")]  # type: ignore[arg-type]


@pytest.mark.parametrize("language", ["fr", "es", "de", "pl", "nb"])
def test_a_latin_script_language_keeps_words_with_letters_and_no_reading(language: str) -> None:
    answer = {
        "candidates": [
            {"text": "où", "reading": "", "english": "where"},
            {"text": "123", "reading": "", "english": "no letters"},
            {"text": "где", "reading": "", "english": "Cyrillic"},
        ]
    }
    kept = clean(answer, language)  # type: ignore[arg-type]
    assert [c.text for c in kept] == ["où"]


def test_no_more_than_the_limit_are_offered() -> None:
    words = "กขคงจฉชซ"
    answer = {"candidates": [{"text": w, "reading": "x", "english": "y"} for w in words]}
    assert len(clean(answer, "th")) == MAX_CANDIDATES


def test_asks_haiku_with_the_schema_and_what_was_typed() -> None:
    reply = {"candidates": [{"text": "ใหม่", "reading": "mài", "english": "new"}]}
    fake = FakeClient(response("end_turn", json.dumps(reply)))
    found, used = finish(claude_find_words(fake)("th", "mai"))  # type: ignore[arg-type]
    assert found == [NEW]
    assert used.cost_usd() > 0
    assert fake.calls[0]["model"] == "claude-haiku-5-5"
    assert fake.calls[0]["output_config"]["format"]["type"] == "json_schema"
    assert "mai" in fake.calls[0]["messages"][0]["content"]
    assert "learner of Thai" in fake.calls[0]["system"]


@pytest.mark.parametrize(
    "stop,text",
    [
        ("refusal", "{}"),
        ("max_tokens", "{}"),
        ("end_turn", None),
        ("end_turn", "no"),
        ("end_turn", "[]"),
    ],
)
def test_an_answer_that_cannot_be_used_fails_with_what_it_cost(stop: str, text: str | None) -> None:
    fake = FakeClient(response(stop, text))
    with pytest.raises(LessonWordsFailed) as e:
        finish(claude_find_words(fake)("th", "mai"))  # type: ignore[arg-type]
    assert e.value.usage.cost_usd() > 0


def test_the_route_returns_the_candidates_and_keeps_the_cost() -> None:
    seen: list[tuple[str, str]] = []

    async def find(language: str, typed: str) -> tuple[list[Candidate], Usage]:
        seen.append((language, typed))
        return [NEW], COST

    c, conn = client(find)
    answer = c.post("/api/lessons/words", json={"language": "th", "text": "  mai "}, headers=AUTH)
    assert answer.status_code == 200
    assert answer.json() == {
        "candidates": [
            {"text": "ใหม่", "reading": "mài", "english": "new", "commonness": "", "register": ""}
        ]
    }
    assert seen == [("th", "mai")]
    assert costs(conn) == [("lesson_words", "th")]


def test_a_language_lessons_are_not_made_in_is_refused_without_asking_claude() -> None:
    async def find(language: str, typed: str) -> tuple[list[Candidate], Usage]:
        raise AssertionError("asked")

    c, conn = client(find)
    answer = c.post("/api/lessons/words", json={"language": "en", "text": "hello"}, headers=AUTH)
    assert answer.status_code == 422
    assert costs(conn) == []


def test_a_blank_word_is_refused() -> None:
    c, _ = client(None)
    answer = c.post("/api/lessons/words", json={"language": "th", "text": "   "}, headers=AUTH)
    assert answer.status_code == 422


def test_a_failed_call_that_was_billed_is_kept_and_503() -> None:
    async def find(language: str, typed: str) -> tuple[list[Candidate], Usage]:
        raise LessonWordsFailed("Claude didn't find a word.", COST)

    c, conn = client(find)
    answer = c.post("/api/lessons/words", json={"language": "th", "text": "mai"}, headers=AUTH)
    assert answer.status_code == 503
    assert answer.json()["detail"] == "Claude didn't find a word."
    assert costs(conn) == [("lesson_words", "th")]


def test_without_claude_it_says_how_to_turn_it_on() -> None:
    c, _ = client(None)
    answer = c.post("/api/lessons/words", json={"language": "th", "text": "mai"}, headers=AUTH)
    assert answer.status_code == 503
    assert "ANTHROPIC_API_KEY" in answer.json()["detail"]
