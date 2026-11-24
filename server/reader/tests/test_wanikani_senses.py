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
from franki_reader.wanikani_senses import (
    Senses,
    SensesFailed,
    Sentence,
    Word,
    check,
    claude_senses,
    request_message,
)

COST = Usage(1_000_000, 0, 0, 0, "claude-haiku-5-5")
MOON = Word(
    2542,
    "月",
    ["moon", "month"],
    [
        Sentence("月がきれいだ。", "The moon is pretty."),
        Sentence("来月行きます。", "I'll go next month."),
    ],
)
RETURN = Word(9, "帰る", ["to return", "to go back"], [Sentence("家に帰る。", "I go home.")])
BODY = {
    "words": [
        {
            "id": 2542,
            "characters": "月",
            "glosses": ["moon", "month"],
            "sentences": [
                {"ja": "月がきれいだ。", "en": "The moon is pretty."},
                {"ja": "来月行きます。", "en": "I'll go next month."},
            ],
        }
    ]
}


def sense(glosses: list[int], sentence: int, label: str = "moon") -> dict[str, Any]:
    return {"glosses": glosses, "sentence": sentence, "label": label}


def client(sort: Any = None) -> tuple[TestClient, Any]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 11, 24, 9),
        random.Random(1),
    )
    return started(create_app(engine, "open sesame", None, sort_senses=sort)), conn


def costs(conn: Any) -> list[tuple[str, str]]:
    return [tuple(r) for r in conn.execute("SELECT feature, language FROM call_costs")]


def test_the_message_numbers_words_glosses_and_sentences_from_one() -> None:
    text = request_message([RETURN, MOON])
    assert "1. 帰る" in text and "2. 月" in text
    assert "gloss 2: month" in text
    assert "sentence 2: 来月行きます。 (I'll go next month.)" in text


def test_a_passing_answer_comes_back_with_indexes_from_zero() -> None:
    answer = {"words": [{"id": 1, "senses": [sense([1], 1, " Moon "), sense([2], 2, "month")]}]}
    assert check(answer, [MOON]) == [Senses(2542, [[0], [1]], [0, 1], ["moon", "month"])]


@pytest.mark.parametrize(
    "senses",
    [
        [sense([1, 2], 1)],  # one sense is no split
        [sense([1], 1), sense([1], 2)],  # gloss 2 left out, gloss 1 twice
        [sense([1], 1), sense([2], 1)],  # both senses on one sentence
        [sense([1], 1), sense([2], 3)],  # no sentence 3
        [sense([1], 1), sense([3], 2)],  # no gloss 3
        [sense([1], 1), sense([2], 2, "")],
        [sense([1], 1), sense([2], 2, "a label far too long to show on a card")],
        [sense([1], 1), sense([2], 2, "month|year")],
        [sense([1], 1), sense([], 2)],
        [sense([1], 1), "junk"],
    ],
)
def test_an_answer_that_does_not_fit_the_word_leaves_it_out(senses: list[Any]) -> None:
    assert check({"words": [{"id": 1, "senses": senses}]}, [MOON]) == []


def test_unknown_or_repeated_words_are_dropped_and_the_order_asked_is_kept() -> None:
    two = [sense([1], 1), sense([2], 2, "month")]
    answer = {
        "words": [
            {"id": 2, "senses": two},
            {"id": 2, "senses": [sense([2], 2), sense([1], 1)]},
            {"id": 7, "senses": two},
            "junk",
        ]
    }
    assert [s.id for s in check(answer, [RETURN, MOON])] == [2542]
    assert check(answer, [RETURN, MOON])[0].glosses == [[0], [1]]
    assert check({"words": "no"}, [MOON]) == []


def test_asks_haiku_with_the_schema() -> None:
    reply = {"words": [{"id": 1, "senses": [sense([1], 1), sense([2], 2, "month")]}]}
    fake = FakeClient(response("end_turn", json.dumps(reply)))
    senses, used = finish(claude_senses(fake)([MOON]))  # type: ignore[arg-type]
    assert [s.id for s in senses] == [2542]
    assert used.cost_usd() > 0
    assert fake.calls[0]["model"] == "claude-haiku-5-5"
    assert fake.calls[0]["output_config"]["format"]["type"] == "json_schema"


def test_no_words_makes_no_call() -> None:
    fake = FakeClient(response("end_turn", "{}"))
    assert finish(claude_senses(fake)([])) == ([], Usage())  # type: ignore[arg-type]
    assert fake.calls == []


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
    with pytest.raises(SensesFailed) as e:
        finish(claude_senses(FakeClient(response(stop, text)))([MOON]))  # type: ignore[arg-type]
    assert e.value.usage.cost_usd() > 0


def test_the_route_returns_the_senses_and_keeps_the_cost() -> None:
    seen: list[list[Word]] = []

    async def sort(words: list[Word]) -> tuple[list[Senses], Usage]:
        seen.append(words)
        return [Senses(2542, [[0], [1]], [0, 1], ["moon", "month"])], COST

    c, conn = client(sort)
    answer = c.post("/api/wanikani-senses", json=BODY, headers=AUTH)
    assert answer.status_code == 200
    assert answer.json() == {
        "words": [
            {"id": 2542, "glosses": [[0], [1]], "sentences": [0, 1], "labels": ["moon", "month"]}
        ]
    }
    assert seen[0] == [MOON]
    assert costs(conn) == [("wanikani_senses", "ja")]


def test_a_word_with_one_gloss_is_refused() -> None:
    c, _ = client(None)
    body = {"words": [{**BODY["words"][0], "glosses": ["moon"]}]}
    assert c.post("/api/wanikani-senses", json=body, headers=AUTH).status_code == 422


def test_a_failed_call_that_was_billed_is_kept_and_503() -> None:
    async def sort(words: list[Word]) -> tuple[list[Senses], Usage]:
        raise SensesFailed("Claude didn't sort the meanings.", COST)

    c, conn = client(sort)
    answer = c.post("/api/wanikani-senses", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert answer.json()["detail"] == "Claude didn't sort the meanings."
    assert costs(conn) == [("wanikani_senses", "ja")]


def test_without_claude_it_says_how_to_turn_it_on() -> None:
    c, _ = client(None)
    answer = c.post("/api/wanikani-senses", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert "ANTHROPIC_API_KEY" in answer.json()["detail"]
