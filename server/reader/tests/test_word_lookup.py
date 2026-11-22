"""Quick add's "Don't know the word?": words for a meaning, and the endpoint that asks for them."""

import json
import random
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_app import AUTH, NOW, started
from test_generator import FakeClient, finish, response

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.word_lookup import (
    COUNT,
    FoundWord,
    LookupFailed,
    claude_word_lookup,
    clean,
)

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
BODY = {"language": "ru", "meaning": "to bargain"}


def client(look_up: Any = None) -> TestClient:
    conn = store.connect(":memory:")
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame", look_up_words=look_up))
    c.conn = conn  # type: ignore[attr-defined]
    return c


def costs(c: TestClient) -> list[tuple[str, str]]:
    return list(c.conn.execute("SELECT feature, language FROM call_costs"))  # type: ignore[attr-defined]


def test_clean_keeps_words_with_a_meaning_without_repeats_or_markup() -> None:
    got = clean(
        [
            {"entry": "торговаться", "meaning": "to bargain", "note": "imperfective"},
            {"entry": "торговаться", "meaning": "to haggle", "note": ""},  # a repeat
            {"entry": "сторговаться", "meaning": "", "note": ""},  # nothing to say what it is
            {"entry": "<b>x</b>", "meaning": "markup", "note": ""},
            {"entry": "выторговать", "meaning": "to get by bargaining", "note": "a | b"},
            "not an object",
        ]
    )
    assert got == [
        FoundWord("торговаться", "to bargain", "imperfective"),
        FoundWord("выторговать", "to get by bargaining", ""),
    ]
    assert clean("words") == []
    many = [{"entry": f"w{i}", "meaning": "m", "note": ""} for i in range(COUNT + 2)]
    assert len(clean(many)) == COUNT


def test_the_lookup_asks_sonnet_and_reads_the_words() -> None:
    text = json.dumps({"words": [{"entry": "торговаться", "meaning": "to bargain", "note": ""}]})
    fake = FakeClient(response("end_turn", text))
    words, used = finish(claude_word_lookup(fake)("ru", "to bargain"))  # type: ignore[arg-type]
    assert words == [FoundWord("торговаться", "to bargain", "")]
    assert used.output_tokens == 900
    assert fake.calls[0]["model"] == "claude-sonnet-5-5"
    assert "Russian" in fake.calls[0]["system"]


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [
        ("refusal", None),
        ("max_tokens", '{"words"'),
        ("end_turn", "not json"),
        ("end_turn", '{"words": []}'),
    ],
)
def test_an_answer_that_cant_be_used_fails_with_its_cost(
    stop_reason: str, text: str | None
) -> None:
    look_up = claude_word_lookup(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(LookupFailed) as failed:
        finish(look_up("ru", "to bargain"))
    assert failed.value.usage.output_tokens == 900


def test_the_endpoint_returns_the_words_and_keeps_the_cost() -> None:
    asked: list[tuple[str, str]] = []

    async def look_up(language: Any, meaning: str) -> tuple[list[FoundWord], Usage]:
        asked.append((language, meaning))
        return [FoundWord("торговаться", "to bargain", "imperfective")], COST

    c = client(look_up)
    r = c.post(
        "/api/word-lookup", headers=AUTH, json={"language": "ru", "meaning": "  to   bargain "}
    )
    assert r.status_code == 200
    assert r.json() == {
        "words": [{"entry": "торговаться", "meaning": "to bargain", "note": "imperfective"}]
    }
    assert asked == [("ru", "to bargain")]
    assert costs(c) == [("word_lookup", "ru")]


def test_a_failed_lookup_says_why_and_keeps_what_it_cost() -> None:
    async def look_up(language: Any, meaning: str) -> tuple[list[FoundWord], Usage]:
        raise LookupFailed("Claude didn't find a Russian word for that.", COST)

    c = client(look_up)
    r = c.post("/api/word-lookup", headers=AUTH, json=BODY)
    assert (r.status_code, r.json()["detail"]) == (
        503,
        "Claude didn't find a Russian word for that.",
    )
    assert costs(c) == [("word_lookup", "ru")]


def test_without_claude_the_endpoint_says_so_and_a_blank_meaning_is_refused() -> None:
    c = client()
    r = c.post("/api/word-lookup", headers=AUTH, json=BODY)
    assert r.status_code == 503
    assert "isn't set up" in r.json()["detail"]

    async def look_up(language: Any, meaning: str) -> tuple[list[FoundWord], Usage]:
        raise AssertionError("not asked")

    r = client(look_up).post(
        "/api/word-lookup", headers=AUTH, json={"language": "ru", "meaning": "   "}
    )
    assert r.status_code == 422


def test_the_endpoint_needs_the_passphrase() -> None:
    assert client().post("/api/word-lookup", json=BODY).status_code == 401
