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
from franki_reader.cram_words import MAX_SUGGESTED, claude_suggest_words
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.lesson_words import Candidate, LessonWordsFailed

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
RUN = Candidate("วิ่ง", "wîng", "to run")
BODY = {"language": "th", "topic": "the 5k race I ran today"}


def client(suggest: Any = None) -> tuple[TestClient, Any]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 10, 19, 9),
        random.Random(1),
    )
    app = create_app(engine, "open sesame", None, suggest_cram_words=suggest)
    return started(app), conn


def costs(conn: Any) -> list[tuple[str, str]]:
    return [tuple(r) for r in conn.execute("SELECT feature, language FROM call_costs")]


def test_asks_haiku_for_the_topic_and_what_to_leave_out() -> None:
    reply = {"candidates": [{"text": "วิ่ง", "reading": "wîng", "english": "to run"}]}
    fake = FakeClient(response("end_turn", json.dumps(reply)))
    found, used = finish(
        claude_suggest_words(fake)(  # type: ignore[arg-type]
            "th", "the 5k race", "I ran 5 km", "how it felt", ("เหนื่อย",)
        )
    )
    assert found == [RUN]
    assert used.cost_usd() > 0
    call = fake.calls[0]
    assert call["model"] == "claude-haiku-5-5"
    assert call["output_config"]["format"]["type"] == "json_schema"
    assert f"exactly {MAX_SUGGESTED} words" in call["system"]
    assert "a word in its dictionary form" in call["system"]
    content = call["messages"][0]["content"]
    for part in ("the 5k race", "I ran 5 km", "how it felt", "เหนื่อย"):
        assert part in content


def test_a_word_the_learner_already_has_is_dropped_even_if_claude_returns_it() -> None:
    reply = {
        "candidates": [
            {"text": "วิ่ง", "reading": "wîng", "english": "to run"},
            {"text": "เหนื่อย", "reading": "nèuai", "english": "tired"},
            {"text": "mai", "reading": "mai", "english": "romanization handed back"},
        ]
    }
    fake = FakeClient(response("end_turn", json.dumps(reply)))
    found, _ = finish(claude_suggest_words(fake)("th", "", "", "", ("เหนื่อย",)))  # type: ignore[arg-type]
    assert found == [RUN]


def test_no_more_than_the_limit_come_back() -> None:
    reply = {"candidates": [{"text": w, "reading": "x", "english": "y"} for w in "กขคงจฉชซฌญ"]}
    fake = FakeClient(response("end_turn", json.dumps(reply)))
    found, _ = finish(claude_suggest_words(fake)("th", "", "", "", ()))  # type: ignore[arg-type]
    assert len(found) == MAX_SUGGESTED


@pytest.mark.parametrize("stop,text", [("refusal", "{}"), ("max_tokens", "{}"), ("end_turn", "no")])
def test_an_answer_that_cannot_be_used_fails_with_what_it_cost(stop: str, text: str) -> None:
    fake = FakeClient(response(stop, text))
    with pytest.raises(LessonWordsFailed) as e:
        finish(claude_suggest_words(fake)("th", "", "", "", ()))  # type: ignore[arg-type]
    assert e.value.usage.cost_usd() > 0


def test_the_route_returns_the_words_and_keeps_the_cost() -> None:
    seen: list[tuple[Any, ...]] = []

    async def suggest(*args: Any) -> tuple[list[Candidate], Usage]:
        seen.append(args)
        return [RUN], COST

    c, conn = client(suggest)
    body = {**BODY, "topic": "  the 5k   race ", "exclude": ["เหนื่อย", " เหนื่อย", " "]}
    answer = c.post("/api/cram/words", json=body, headers=AUTH)
    assert answer.status_code == 200
    assert answer.json() == {
        "words": [
            {"text": "วิ่ง", "reading": "wîng", "english": "to run", "commonness": "", "register": ""}
        ]
    }
    assert seen == [("th", "the 5k race", "", "", ("เหนื่อย",))]
    assert costs(conn) == [("cram_words", "th")]


def test_english_is_refused_without_asking_claude() -> None:
    async def suggest(*args: Any) -> tuple[list[Candidate], Usage]:
        raise AssertionError("asked")

    c, conn = client(suggest)
    answer = c.post("/api/cram/words", json={**BODY, "language": "en"}, headers=AUTH)
    assert answer.status_code == 422
    assert costs(conn) == []


def test_a_failed_call_that_was_billed_is_kept_and_503() -> None:
    async def suggest(*args: Any) -> tuple[list[Candidate], Usage]:
        raise LessonWordsFailed("Claude didn't suggest any words. Try again.", COST)

    c, conn = client(suggest)
    answer = c.post("/api/cram/words", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert answer.json()["detail"] == "Claude didn't suggest any words. Try again."
    assert costs(conn) == [("cram_words", "th")]


def test_without_claude_it_says_how_to_turn_it_on() -> None:
    c, _ = client(None)
    answer = c.post("/api/cram/words", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert "ANTHROPIC_API_KEY" in answer.json()["detail"]
