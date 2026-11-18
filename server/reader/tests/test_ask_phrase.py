import itertools
import random
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE
from scripted import ScriptedModel as AppModel
from test_app import AUTH, NOW, started
from test_generator import GOOD, MANGO, FakeClient, ScriptedModel, finish, response, run

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.ask_card import MAX_TURNS, Turn
from franki_reader.ask_phrase import (
    AskPhraseFailed,
    PhraseQuestion,
    claude_ask_phrase,
    messages_for,
    system_for,
)
from franki_reader.engine import Engine
from franki_reader.explain import ENGLISH, IN_LANGUAGE
from franki_reader.generator import TextRequest, Usage

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2


def client(ask: Any = None) -> tuple[TestClient, int, Any]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    generated = run(ScriptedModel(GOOD, GOOD, GOOD), TextRequest("food", (MANGO,)))
    text_id = store.save_text(conn, store.add_topic(conn, "food", NOW).id, generated, [], 0.95, NOW)
    engine = Engine(
        conn,
        AppModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 10, 19, 9),
        random.Random(1),
    )
    app = create_app(engine, "open sesame", None, ask_about_phrase=ask)
    return started(app), text_id, conn


def url(text_id: int, line: int = 0) -> str:
    return f"/api/texts/{text_id}/lines/{line}/ask"


def body(c: TestClient, text_id: int, turns: list[dict[str, str]] | None = None) -> dict[str, Any]:
    shown = c.get(f"/api/texts/{text_id}", headers=AUTH).json()["lines"][0]["words"]
    phrase = "".join(w["text"] for w in shown)[:3]
    return {"phrase": phrase, "turns": turns or [{"role": "user", "content": "Why this order?"}]}


def costs(conn: Any) -> list[tuple[str, str]]:
    return [tuple(r) for r in conn.execute("SELECT feature, language FROM call_costs")]


def question(turns: list[Turn], in_language: bool = False) -> PhraseQuestion:
    return PhraseQuestion(
        "th",
        "ฉัน",
        "ฉันหิว",
        "I'm hungry.",
        ("A: ฉันหิว (I'm hungry.)", "B: กินไหม (Eat?)"),
        "Lunch",
        0,
        turns,
        in_language,
    )


def test_the_phrase_and_the_whole_text_go_in_front_of_the_first_question_only() -> None:
    turns = [Turn("user", "q1"), Turn("assistant", "a1"), Turn("user", "q2")]
    messages = messages_for(question(turns))
    assert [m["role"] for m in messages] == ["user", "assistant", "user"]
    first = str(messages[0]["content"])
    assert "Language: Thai" in first
    assert "1. A: ฉันหิว (I'm hungry.)   <- the selected line" in first
    assert "2. B: กินไหม (Eat?)" in first
    assert "Selected phrase: ฉัน" in first
    assert first.endswith("My question: q1")
    assert messages[2]["content"] == "q2"


def test_a_long_conversation_is_cut_to_start_on_a_question() -> None:
    turns = [Turn("user" if i % 2 == 0 else "assistant", f"t{i}") for i in range(MAX_TURNS + 2)]
    turns.append(Turn("user", "last"))
    messages = messages_for(question(turns))
    assert messages[0]["role"] == "user" and messages[-1]["content"] == "last"
    assert len(messages) <= MAX_TURNS
    assert all(a["role"] != b["role"] for a, b in itertools.pairwise(messages))


def test_the_answer_is_english_unless_asked_for_in_the_language() -> None:
    assert ENGLISH in system_for(question([Turn("user", "q")]))
    swapped = system_for(question([Turn("user", "q")], in_language=True))
    assert ENGLISH not in swapped and "Write the answer in the language of the line" in swapped
    assert IN_LANGUAGE.split(" `note`")[0] not in swapped


def test_sends_the_conversation_and_returns_the_text() -> None:
    fake = FakeClient(response("end_turn", " It means I. "))
    ask = claude_ask_phrase(fake)  # type: ignore[arg-type]
    answer, used = finish(ask(question([Turn("user", "why?")])))
    assert answer == "It means I." and used.cost_usd() > 0
    assert fake.calls[0]["model"] == "claude-haiku-5-5"


@pytest.mark.parametrize("stop,text", [("refusal", "x"), ("end_turn", None), ("end_turn", "  ")])
def test_a_refusal_or_empty_answer_is_refused_with_what_it_cost(
    stop: str, text: str | None
) -> None:
    ask = claude_ask_phrase(FakeClient(response(stop, text)))  # type: ignore[arg-type]
    with pytest.raises(AskPhraseFailed) as e:
        finish(ask(question([Turn("user", "why?")])))
    assert "Try asking it another way" in str(e.value) and e.value.usage.output_tokens == 900


def test_a_conversation_that_does_not_end_on_a_question_is_refused() -> None:
    ask = claude_ask_phrase(FakeClient(response("end_turn", "x")))  # type: ignore[arg-type]
    with pytest.raises(AskPhraseFailed):
        finish(ask(question([Turn("user", "q"), Turn("assistant", "a")])))


def test_the_route_returns_the_answer_and_keeps_the_cost_with_the_explanations() -> None:
    seen: list[PhraseQuestion] = []

    async def ask(q: PhraseQuestion) -> tuple[str, Usage]:
        seen.append(q)
        return "Because of the classifier.", COST

    c, text_id, conn = client(ask)
    sent = {**body(c, text_id), "in_language": True}
    answer = c.post(url(text_id), json=sent, headers=AUTH)
    assert answer.status_code == 200 and answer.json() == {"answer": "Because of the classifier."}
    assert seen[0].phrase == sent["phrase"] and seen[0].in_language and seen[0].title
    assert seen[0].turns[0].content == "Why this order?" and seen[0].index == 0
    assert len(seen[0].context) == len(c.get(f"/api/texts/{text_id}", headers=AUTH).json()["lines"])
    assert costs(conn) == [("ask_phrase", "th")]
    spent = c.get("/api/costs", headers=AUTH).json()["explanations"]
    assert spent["asked"] == 1 and spent["cost_usd"] == 2.0


def test_every_question_is_asked_again() -> None:
    calls: list[int] = []

    async def ask(q: PhraseQuestion) -> tuple[str, Usage]:
        calls.append(len(q.turns))
        return "ok", COST

    c, text_id, _ = client(ask)
    for _ in range(2):
        assert c.post(url(text_id), json=body(c, text_id), headers=AUTH).status_code == 200
    assert calls == [1, 1]


def test_a_failed_call_that_was_billed_is_kept_and_503() -> None:
    async def ask(q: PhraseQuestion) -> tuple[str, Usage]:
        raise AskPhraseFailed("Claude didn't answer that.", COST)

    c, text_id, conn = client(ask)
    answer = c.post(url(text_id), json=body(c, text_id), headers=AUTH)
    assert answer.status_code == 503 and answer.json()["detail"] == "Claude didn't answer that."
    assert costs(conn) == [("ask_phrase", "th")]


def test_without_claude_it_says_how_to_turn_it_on() -> None:
    c, text_id, _ = client(None)
    answer = c.post(url(text_id), json=body(c, text_id), headers=AUTH)
    assert answer.status_code == 503 and "ANTHROPIC_API_KEY" in answer.json()["detail"]


async def _never(q: PhraseQuestion) -> tuple[str, Usage]:
    raise AssertionError("not asked")


def test_refuses_a_phrase_that_isnt_in_the_line_and_a_last_turn_that_isnt_a_question() -> None:
    c, text_id, _ = client(_never)
    good = body(c, text_id)
    assert c.post(url(text_id), json={**good, "phrase": "nowhere"}, headers=AUTH).status_code == 400
    ends_on_answer = [{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}]
    assert (
        c.post(url(text_id), json={**good, "turns": ends_on_answer}, headers=AUTH).status_code
        == 422
    )
    assert c.post(url(text_id, 99), json=good, headers=AUTH).status_code == 404


def test_needs_the_passphrase() -> None:
    c, text_id, _ = client(_never)
    assert c.post(url(text_id), json=body(c, text_id)).status_code in (401, 403)
