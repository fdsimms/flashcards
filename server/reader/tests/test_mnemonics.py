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
from franki_reader.mnemonics import (
    MnemonicRequest,
    MnemonicsFailed,
    claude_mnemonics,
    clean,
    request_message,
)

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2

BODY = {
    "language": "th",
    "entry": "ทุก",
    "meaning": "every; all",
    "transliteration": "thúk",
    "context": "ทุกคนชอบอาหารไทย",
}


def client(mnemonics: Any = None) -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 10, 19, 9),
        random.Random(1),
    )
    return started(create_app(engine, "open sesame", None, mnemonics))


def test_returns_the_hints_for_the_word() -> None:
    seen: list[MnemonicRequest] = []

    async def make(request: MnemonicRequest) -> tuple[list[str], Usage]:
        seen.append(request)
        return ["one", "two", "three"], COST

    response = client(make).post("/api/mnemonics", json=BODY, headers=AUTH)
    assert response.json() == {"hints": ["one", "two", "three"]}
    assert seen == [MnemonicRequest("th", "ทุก", "every; all", "thúk", "ทุกคนชอบอาหารไทย")]


def test_needs_the_passphrase() -> None:
    assert client().post("/api/mnemonics", json=BODY).status_code == 401


def test_says_so_when_claude_isnt_set_up() -> None:
    response = client(None).post("/api/mnemonics", json=BODY, headers=AUTH)
    assert response.status_code == 503
    assert "ANTHROPIC_API_KEY" in response.json()["detail"]


def test_passes_on_a_failure_in_words_to_show() -> None:
    async def make(request: MnemonicRequest) -> tuple[list[str], Usage]:
        raise MnemonicsFailed("Claude didn't answer (APIError). Try again in a moment.")

    c = client(make)
    answer = c.post("/api/mnemonics", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert answer.json()["detail"].startswith("Claude didn't answer")
    # Claude never answered, so it cost nothing.
    assert c.get("/api/costs", headers=AUTH).json()["mnemonics"]["asked"] == 0


def test_the_costs_count_each_call_failed_ones_included() -> None:
    results: list[Any] = [
        (["one"], COST),
        MnemonicsFailed("Claude didn't give any hints for this word. Write your own.", COST),
    ]

    async def make(request: MnemonicRequest) -> tuple[list[str], Usage]:
        result = results.pop()
        if isinstance(result, Exception):
            raise result
        return result  # type: ignore[no-any-return]

    c = client(make)
    assert c.post("/api/mnemonics", json=BODY, headers=AUTH).status_code == 503
    assert c.post("/api/mnemonics", json=BODY, headers=AUTH).json() == {"hints": ["one"]}
    spent = c.get("/api/costs", headers=AUTH).json()["mnemonics"]
    assert spent == {
        "asked": 2,
        "cost_usd": 4.0,
        "languages": [{"language": "th", "name": "Thai", "asked": 2, "cost_usd": 4.0}],
    }


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [
        ("refusal", None),
        ("max_tokens", '{"hints"'),
        ("end_turn", None),
        ("end_turn", "not json"),
        ("end_turn", '{"hints": []}'),
    ],
)
def test_claude_mnemonics_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    make = claude_mnemonics(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(MnemonicsFailed) as failed:
        finish(make(MnemonicRequest("th", "ทุก", "every")))
    assert failed.value.usage.output_tokens == 900  # the call is still paid for


def test_claude_mnemonics_returns_what_the_hints_cost() -> None:
    reply = response("end_turn", '{"hints": ["a", "b", "c"]}')
    make = claude_mnemonics(FakeClient(reply))  # type: ignore[arg-type]
    hints, used = finish(make(MnemonicRequest("th", "ทุก", "every")))
    assert hints == ["a", "b", "c"] and used.output_tokens == 900


def test_refuses_an_unknown_language() -> None:
    response = client().post("/api/mnemonics", json={**BODY, "language": "xx"}, headers=AUTH)
    assert response.status_code == 422


def test_clean_trims_drops_blanks_and_repeats_and_keeps_three() -> None:
    assert clean([" a ", "", "a", "b", "c", "d"]) == ["a", "b", "c"]
    assert clean("not a list") == []
    assert clean([1, None]) == []


def test_request_message_leaves_out_what_is_missing() -> None:
    text = request_message(MnemonicRequest("pl", "kot", "cat"))
    assert text == "Language: Polish\nWord: kot\nMeaning: cat"
    assert "Pronunciation: thúk" in request_message(MnemonicRequest("th", "ทุก", "all", "thúk"))
