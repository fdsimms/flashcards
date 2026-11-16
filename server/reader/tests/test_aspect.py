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
from franki_reader.aspect import (
    NONE,
    AspectFailed,
    AspectPair,
    AspectRequest,
    claude_aspect,
    clean,
    request_message,
)
from franki_reader.engine import Engine
from franki_reader.generator import Usage

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
PAIR = AspectPair("perfective", "wychodzić", "to go out, to leave")
BODY = {"language": "pl", "word": "wyjść", "line": "Mysz nie wie, jak wyjść."}


def client(write: Any = None) -> tuple[TestClient, Any]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 10, 19, 9),
        random.Random(1),
    )
    app = create_app(engine, "open sesame", None, write_aspect=write)
    return started(app), conn


def test_uses_the_words_language_not_the_reading_language() -> None:
    seen: list[AspectRequest] = []

    async def write(request: AspectRequest) -> tuple[AspectPair, Usage]:
        seen.append(request)
        return NONE, COST

    c, _ = client(write)  # the reading language is Thai
    c.post("/api/aspect-pair", json={**BODY, "language": "ru", "word": "выйти"}, headers=AUTH)
    assert [r.language for r in seen] == ["ru"]


def test_returns_the_pair_marked_as_written_by_ai() -> None:
    seen: list[AspectRequest] = []

    async def write(request: AspectRequest) -> tuple[AspectPair, Usage]:
        seen.append(request)
        return PAIR, COST

    c, _ = client(write)
    answer = c.post("/api/aspect-pair", json=BODY, headers=AUTH)
    assert answer.json() == {
        "aspect": "perfective",
        "partner": "wychodzić",
        "partner_meaning": "to go out, to leave",
        "aspect_source": "ai",
    }
    assert seen == [AspectRequest("pl", "wyjść", "Mysz nie wie, jak wyjść.")]


def test_has_nothing_to_suggest_for_a_verb_with_no_partner() -> None:
    async def write(request: AspectRequest) -> tuple[AspectPair, Usage]:
        return NONE, COST

    c, _ = client(write)
    assert c.post("/api/aspect-pair", json=BODY, headers=AUTH).json() == {
        "aspect": None,
        "partner": None,
        "partner_meaning": None,
        "aspect_source": None,
    }


def test_needs_the_passphrase() -> None:
    c, _ = client()
    assert c.post("/api/aspect-pair", json=BODY).status_code == 401


def test_says_so_when_claude_isnt_set_up() -> None:
    c, _ = client(None)
    answer = c.post("/api/aspect-pair", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert "ANTHROPIC_API_KEY" in answer.json()["detail"]


def test_refuses_a_language_without_aspect_pairs() -> None:
    async def write(request: AspectRequest) -> tuple[AspectPair, Usage]:
        raise AssertionError("no call for a language with no aspect pairs")

    c, _ = client(write)
    assert (
        c.post("/api/aspect-pair", json={**BODY, "language": "de"}, headers=AUTH).status_code == 422
    )


def test_each_call_is_kept_as_a_cost_failed_ones_included() -> None:
    results: list[Any] = [PAIR, AspectFailed("Claude's answer couldn't be read. Try again.", COST)]

    async def write(request: AspectRequest) -> tuple[AspectPair, Usage]:
        result = results.pop()
        if isinstance(result, Exception):
            raise result
        return result, COST

    c, conn = client(write)
    failed = c.post("/api/aspect-pair", json=BODY, headers=AUTH)
    assert failed.status_code == 503
    assert c.post("/api/aspect-pair", json=BODY, headers=AUTH).status_code == 200
    rows = conn.execute("SELECT feature, language, cost_usd FROM call_costs").fetchall()
    assert [tuple(r) for r in rows] == [("aspect", "pl", 2.0), ("aspect", "pl", 2.0)]


def test_a_failure_before_claude_answered_costs_nothing() -> None:
    async def write(request: AspectRequest) -> tuple[AspectPair, Usage]:
        raise AspectFailed("Claude didn't answer (APIError). Try again in a moment.")

    c, conn = client(write)
    assert c.post("/api/aspect-pair", json=BODY, headers=AUTH).status_code == 503
    assert conn.execute("SELECT COUNT(*) FROM call_costs").fetchone()[0] == 0


@pytest.mark.parametrize(
    "answer",
    [
        {"aspect": "", "partner": "x", "partner_meaning": "to x"},  # not a verb, or one aspect
        {"aspect": "perfective", "partner": "", "partner_meaning": ""},
        {"aspect": "perfective", "partner": "wyjść", "partner_meaning": "to go out"},  # itself
        {"aspect": "perfective", "partner": "Wyjść", "partner_meaning": "to go out"},
        {"aspect": "future", "partner": "wychodzić", "partner_meaning": "to go out"},
        {"aspect": "perfective", "partner": "wy*chodzić", "partner_meaning": "to go out"},
        {"aspect": "perfective", "partner": "x" * 41, "partner_meaning": "to go out"},
        {"aspect": "perfective", "partner": 7, "partner_meaning": "to go out"},
    ],
)
def test_clean_gives_nothing_rather_than_a_wrong_link(answer: dict[str, Any]) -> None:
    assert clean(answer, "wyjść") == NONE


def test_clean_keeps_a_good_pair_and_drops_an_unusable_meaning() -> None:
    answer = {"aspect": "perfective", "partner": " wychodzić ", "partner_meaning": "to go|out"}
    assert clean(answer, "wyjść") == AspectPair("perfective", "wychodzić", None)
    assert clean({**answer, "partner_meaning": "to go out, to leave"}, "wyjść") == PAIR


def test_request_message_gives_the_verb_and_its_sentence() -> None:
    text = request_message(AspectRequest("pl", "wyjść", "Mysz nie wie, jak wyjść."))
    assert text == "Verb: wyjść\nSentence it was read in: Mysz nie wie, jak wyjść."
    assert request_message(AspectRequest("pl", "wyjść", "")).endswith("(none)")


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [("refusal", None), ("max_tokens", '{"aspect"'), ("end_turn", None), ("end_turn", "[1]")],
)
def test_claude_aspect_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    write = claude_aspect(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(AspectFailed) as failed:
        finish(write(AspectRequest("pl", "wyjść", "")))
    assert failed.value.usage.output_tokens == 900  # the call is still paid for


def test_claude_aspect_returns_the_pair_and_what_it_cost() -> None:
    reply = response(
        "end_turn",
        '{"aspect": "perfective", "partner": "wychodzić", "partner_meaning": "to go out, to leave"}',
    )
    write = claude_aspect(FakeClient(reply))  # type: ignore[arg-type]
    pair, used = finish(write(AspectRequest("pl", "wyjść", "")))
    assert pair == PAIR and used.output_tokens == 900
