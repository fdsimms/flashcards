"""The check after reading's questions about a text: what Claude's answer must be to be kept, that
they're kept on the text and served with it, and that the check's score is logged and nudges
difficulty."""

import asyncio
import json
import random
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_app import AUTH, client, next_text, started
from test_generator import FakeClient, finish, response

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.comprehension import (
    QUESTIONS,
    Answer,
    Question,
    QuestionsFailed,
    check,
    claude_questions,
    keep,
    request_message,
)
from franki_reader.coverage import check as coverage_of
from franki_reader.engine import Engine
from franki_reader.generator import Generated, Line, Usage
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.reader import render

NOW = datetime(2026, 11, 13, 9, 0)
DECK = [Entry(1, "mat", "food", "mature")]
LINES = (
    Line("A", "Hei!|Vi|har|varm|mat|og|vann.", "Hi! We have warm food and water."),
    Line("B", "~Kari~|vil|ha|kaffe.", "Kari wants coffee."),
    Line("A", "Kaffe|er|godt.", "Coffee is good."),
)
LEXICON = lexicon_from(DECK, "nb", 1000)


def raw(**changes: Any) -> dict[str, Any]:
    """A question about line 2 (counted from 1, as Claude is asked to), right answer first."""
    question: dict[str, Any] = {
        "line": 2,
        "question": "Hva vil Kari ha?",
        "english": "What does Kari want?",
        "choices": [
            {"text": "Kaffe", "english": "Coffee"},
            {"text": "Vann", "english": "Water"},
            {"text": "Mat", "english": "Food"},
            {"text": "Te", "english": "Tea"},
        ],
        "answer": 0,
    }
    return {**question, **changes}


def test_a_question_the_code_agrees_with_is_kept_with_its_line_counted_from_0() -> None:
    q = check(raw(), LINES, LEXICON)
    assert q == Question(
        1,
        "Hva vil Kari ha?",
        "What does Kari want?",
        (
            Answer("Kaffe", "Coffee"),
            Answer("Vann", "Water"),
            Answer("Mat", "Food"),
            Answer("Te", "Tea"),
        ),
        0,
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"line": 0},  # Claude counts from 1
        {"line": 4},
        {"line": True},
        {"answer": 4},
        {"answer": -1},
        {"question": ""},
        {"question": "Hva|vil Kari ha?"},
        {"english": "What does Kari want — coffee?"},
        {"choices": raw()["choices"][:3]},
        # The same choice twice, in either language.
        {"choices": [*raw()["choices"][:3], {"text": "kaffe", "english": "Beer"}]},
        {"choices": [*raw()["choices"][:3], {"text": "Øl", "english": "coffee"}]},
        # Words neither known nor in the text.
        {"question": "Hva vil Kari ha i frokostblandingskålen hennes?"},
    ],
)
def test_a_question_the_code_disagrees_with_is_dropped(changes: dict[str, Any]) -> None:
    assert check(raw(**changes), LINES, LEXICON) is None


def test_a_name_and_a_word_from_the_text_count_as_known() -> None:
    # Kari is a name the text marks; neither is in the deck or the common words.
    lexicon = lexicon_from(DECK, "nb", 0)
    lines = (Line("A", "~Kari~|har|mat.", "Kari has food."),)
    choices = [{"text": w, "english": w} for w in ("Mat", "Har mat", "Kari", "Kari har")]
    assert check(raw(line=1, question="Kari har mat?", choices=choices), lines, lexicon) is not None
    # One word from outside is allowed, two aren't.
    assert check(raw(line=1, question="Kari har mat nå?", choices=choices), lines, lexicon)
    assert (
        check(raw(line=1, question="Kari har mat nå her?", choices=choices), lines, lexicon) is None
    )


def test_at_most_two_are_kept_each_on_its_own_line() -> None:
    about_line_1 = raw(line=1)
    kept = keep([raw(), raw(), {"junk": 1}, about_line_1, raw(line=3)], LINES, LEXICON)
    assert [q.line for q in kept] == [1, 0]
    assert len(kept) == QUESTIONS


def test_the_request_numbers_the_lines_from_1_in_plain_text() -> None:
    message = request_message("nb", LINES)
    assert "1 | Hei! Vi har varm mat og vann. | Hi! We have warm food and water." in message
    assert "2 | Kari vil ha kaffe." in message


# ==== Kept on the text ====


class Writer:
    def __init__(
        self, answer: list[Any] | None = None, fail: QuestionsFailed | None = None
    ) -> None:
        self.answer = answer if answer is not None else [raw(), raw(line=1)]
        self.fail = fail
        self.calls = 0

    async def __call__(self, language: str, lines: tuple[Line, ...]) -> Any:
        self.calls += 1
        if self.fail:
            raise self.fail
        return self.answer, Usage(1_000_000, 0, 0, 0)  # $2


def stored_text(conn: Any) -> store.StoredText:
    coverage = coverage_of([ln.text for ln in LINES], LEXICON)
    generated = Generated("t", LINES, {}, coverage, 1, True, ())
    topic = store.add_topic(conn, "Coffee", NOW)
    text_id = store.save_text(conn, topic.id, generated, [], 0.92, NOW, "ready", "dialogue", "nb")
    text = store.get_text(conn, text_id)
    assert text is not None
    return text


def engine_with(writer: Writer) -> Engine:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    return Engine(conn, None, None, lambda: NOW, random.Random(1), write_questions=writer)


def test_questions_are_kept_on_the_text_served_with_it_and_paid_for() -> None:
    writer = Writer()
    engine = engine_with(writer)
    text = stored_text(engine.conn)
    asyncio.run(engine.fill_questions(text))
    again = store.get_text(engine.conn, text.id)
    assert again is not None and [q.line for q in again.questions] == [1, 0]

    asyncio.run(engine.fill_questions(again))
    assert writer.calls == 1  # a text is asked about once

    served = render(again, LEXICON, {})
    assert served["questions"][0] == {
        "line": 1,
        "question": "Hva vil Kari ha?",
        "english": "What does Kari want?",
        "choices": raw()["choices"],
        "answer": 0,
    }
    c: TestClient = started(create_app(engine, "open sesame"))
    costs = c.get("/api/costs", headers=AUTH).json()["questions"]
    assert costs["asked"] == 1 and costs["cost_usd"] == 2.0
    assert costs["languages"][0]["language"] == "nb"


def test_a_failed_call_leaves_the_text_without_questions_and_keeps_its_cost() -> None:
    engine = engine_with(Writer(fail=QuestionsFailed("cut off", Usage(1_000_000, 0, 0, 0))))
    text = stored_text(engine.conn)
    asyncio.run(engine.fill_questions(text))
    again = store.get_text(engine.conn, text.id)
    assert again is not None and again.questions == ()
    assert store.question_spending(engine.conn, NOW - timedelta(days=1)) == {"nb": (1, 2.0)}


def test_a_text_written_before_questions_has_none() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    assert text.questions == () and render(text, LEXICON, {})["questions"] == []


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [("refusal", None), ("max_tokens", '{"questions"'), ("end_turn", "not json")],
)
def test_claude_questions_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    write = claude_questions(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(QuestionsFailed) as failed:
        finish(write("nb", LINES))
    assert failed.value.usage.output_tokens == 900


def test_claude_questions_returns_what_claude_wrote() -> None:
    fake = FakeClient(response("end_turn", json.dumps({"questions": [raw()]})))
    questions, used = finish(claude_questions(fake)(language="nb", lines=LINES))  # type: ignore[arg-type,call-arg]
    assert questions == [raw()] and used.output_tokens == 900


# ==== The check's score ====


def read(c: TestClient, rating: str | None, **check: int) -> int:
    topic = c.post("/api/topics", json={"name": "Taxi"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    body = {"rating": rating, "finished": True, **check}
    return c.post(f"/api/texts/{text['id']}/reading", json=body, headers=AUTH).status_code


def test_a_poor_check_makes_the_next_text_easier_and_shows_in_progress() -> None:
    c = client()
    assert read(c, "about_right", check_right=1, check_asked=5) == 204
    progress = c.get("/api/progress", headers=AUTH).json()
    assert progress["next"] == {"floor": 0.93, "stretch": 2}
    assert progress["check"] == {"texts": 1, "right": 1, "asked": 5}


def test_a_good_check_or_none_changes_nothing() -> None:
    c = client()
    assert read(c, "about_right", check_right=4, check_asked=5) == 204
    assert read(c, "about_right") == 204
    progress = c.get("/api/progress", headers=AUTH).json()
    assert progress["next"] == {"floor": 0.92, "stretch": 2}
    assert progress["check"] == {"texts": 1, "right": 4, "asked": 5}


def test_more_right_than_asked_is_refused() -> None:
    assert read(client(), None, check_right=3, check_asked=2) == 422
