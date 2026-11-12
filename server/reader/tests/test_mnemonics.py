import random
from datetime import datetime
from typing import Any

from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW, started

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.mnemonics import (
    MnemonicRequest,
    MnemonicsFailed,
    clean,
    request_message,
)

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

    async def make(request: MnemonicRequest) -> list[str]:
        seen.append(request)
        return ["one", "two", "three"]

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
    async def make(request: MnemonicRequest) -> list[str]:
        raise MnemonicsFailed("Claude didn't answer (APIError). Try again in a moment.")

    response = client(make).post("/api/mnemonics", json=BODY, headers=AUTH)
    assert response.status_code == 503
    assert response.json()["detail"].startswith("Claude didn't answer")


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
