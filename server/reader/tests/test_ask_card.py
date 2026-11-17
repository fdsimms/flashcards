import itertools
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
from franki_reader.ask_card import (
    MAX_TURNS,
    AskCardFailed,
    CardQuestion,
    Turn,
    claude_ask_card,
    messages_for,
)
from franki_reader.engine import Engine
from franki_reader.generator import Usage

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
BODY = {
    "language": "pl",
    "front": "wyjść",
    "back": "to go out, to leave",
    "details": "Muszę wyjść na chwilę.",
    "turns": [{"role": "user", "content": "Why wyjść and not wychodzić?"}],
}


def client(ask: Any = None) -> tuple[TestClient, Any]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 10, 19, 9),
        random.Random(1),
    )
    app = create_app(engine, "open sesame", None, ask_about_card=ask)
    return started(app), conn


def costs(conn: Any) -> list[tuple[str, str]]:
    return [tuple(r) for r in conn.execute("SELECT feature, language FROM call_costs")]


def question(turns: list[Turn], language: Any = "pl") -> CardQuestion:
    return CardQuestion(language, "wyjść", "to go out", "Muszę wyjść.", turns)


def test_the_card_goes_in_front_of_the_first_question_only() -> None:
    turns = [Turn("user", "q1"), Turn("assistant", "a1"), Turn("user", "q2")]
    messages = messages_for(question(turns))
    assert [m["role"] for m in messages] == ["user", "assistant", "user"]
    first = str(messages[0]["content"])
    assert "Front: wyjść" in first
    assert "Language: Polish" in first
    assert first.endswith("My question: q1")
    assert messages[2]["content"] == "q2"


def test_a_long_conversation_is_cut_to_start_on_a_question() -> None:
    turns = [Turn("user" if i % 2 == 0 else "assistant", f"t{i}") for i in range(MAX_TURNS + 2)]
    turns.append(Turn("user", "last"))
    messages = messages_for(question(turns))
    assert messages[0]["role"] == "user"
    assert messages[-1]["content"] == "last"
    assert len(messages) <= MAX_TURNS
    roles = [m["role"] for m in messages]
    assert all(a != b for a, b in itertools.pairwise(roles))


def test_a_card_with_no_language_leaves_the_line_out() -> None:
    messages = messages_for(question([Turn("user", "hi")], language=None))
    assert "Language:" not in str(messages[0]["content"])


def test_sends_the_conversation_and_returns_the_text() -> None:
    fake = FakeClient(response("end_turn", " It is perfective. "))
    ask = claude_ask_card(fake)  # type: ignore[arg-type]
    answer, used = finish(ask(question([Turn("user", "why?")])))
    assert answer == "It is perfective."
    assert used.cost_usd() > 0
    assert fake.calls[0]["model"] == "claude-haiku-5-5"
    assert fake.calls[0]["messages"][0]["role"] == "user"


@pytest.mark.parametrize("stop,text", [("refusal", "x"), ("end_turn", None), ("end_turn", "  ")])
def test_a_refusal_or_empty_answer_is_refused_with_what_it_cost(
    stop: str, text: str | None
) -> None:
    ask = claude_ask_card(FakeClient(response(stop, text)))  # type: ignore[arg-type]
    with pytest.raises(AskCardFailed) as e:
        finish(ask(question([Turn("user", "why?")])))
    assert "Try asking it another way" in str(e.value)


def test_a_conversation_that_does_not_end_on_a_question_is_refused() -> None:
    ask = claude_ask_card(FakeClient(response("end_turn", "x")))  # type: ignore[arg-type]
    with pytest.raises(AskCardFailed):
        finish(ask(question([Turn("user", "q"), Turn("assistant", "a")])))


def test_the_route_returns_the_answer_and_keeps_the_cost() -> None:
    seen: list[CardQuestion] = []

    async def ask(q: CardQuestion) -> tuple[str, Usage]:
        seen.append(q)
        return "Because it is perfective.", COST

    c, conn = client(ask)
    answer = c.post("/api/ask-card", json=BODY, headers=AUTH)
    assert answer.status_code == 200
    assert answer.json() == {"answer": "Because it is perfective."}
    assert seen[0].language == "pl" and seen[0].turns[0].content.startswith("Why wyjść")
    assert costs(conn) == [("ask_card", "pl")]


def test_a_card_with_no_language_is_costed_under_an_empty_one() -> None:
    async def ask(q: CardQuestion) -> tuple[str, Usage]:
        return "ok", COST

    c, conn = client(ask)
    body = {k: v for k, v in BODY.items() if k != "language"}
    assert c.post("/api/ask-card", json=body, headers=AUTH).status_code == 200
    assert costs(conn) == [("ask_card", "")]


def test_a_failed_call_that_was_billed_is_kept_and_503() -> None:
    async def ask(q: CardQuestion) -> tuple[str, Usage]:
        raise AskCardFailed("Claude didn't answer that.", COST)

    c, conn = client(ask)
    answer = c.post("/api/ask-card", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert answer.json()["detail"] == "Claude didn't answer that."
    assert costs(conn) == [("ask_card", "pl")]


def test_without_claude_it_says_how_to_turn_it_on() -> None:
    c, _ = client(None)
    answer = c.post("/api/ask-card", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert "ANTHROPIC_API_KEY" in answer.json()["detail"]


def test_the_last_turn_must_be_the_owners() -> None:
    c, _ = client(lambda q: None)
    body = {
        **BODY,
        "turns": [{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}],
    }
    assert c.post("/api/ask-card", json=body, headers=AUTH).status_code == 422


def test_needs_the_passphrase() -> None:
    c, _ = client(lambda q: None)
    assert c.post("/api/ask-card", json=BODY).status_code in (401, 403)
