import json
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
from franki_reader.engine import Engine
from franki_reader.generator import TextRequest, Usage
from franki_reader.production import (
    AttemptRequest,
    ProductionFailed,
    RetellRequest,
    attempt_message,
    claude_attempt,
    claude_retell,
    clean_attempt,
    clean_retell,
    retell_message,
)

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2

SENTENCE = AttemptRequest("pl", "sentence", "Potrzebuję narzędzie.", "narzędzie", "tool")
JUDGED = {
    "verdict": "almost",
    "corrected": "Potrzebuję narzędzia.",
    "english": "I need a tool.",
    "notes": ["Potrzebować takes the genitive: narzędzia."],
    "used_word": True,
}
LINES = (
    ("ฉันอยากกินข้าวเหนียวมะม่วงครับ", "I want mango sticky rice."),
    ("ข้าวเหนียวมะม่วงครับ", "Mango sticky rice!"),
)


def client(check_attempt: Any = None, check_retell: Any = None) -> tuple[TestClient, int]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    generated = run(ScriptedModel(GOOD, GOOD, GOOD), TextRequest("food", (MANGO,)))
    text_id = store.save_text(conn, store.add_topic(conn, "food", NOW).id, generated, [], 0.95, NOW)
    engine = Engine(
        conn, AppModel(IN_RANGE).ask_for, None, lambda: datetime(2026, 10, 19, 9), random.Random(1)
    )
    app = create_app(engine, "open sesame", check_attempt=check_attempt, check_retell=check_retell)
    return started(app), text_id


# ==== Cleaning what Claude sent ====


def test_a_slip_is_corrected_with_its_notes() -> None:
    assert clean_attempt(JUDGED, SENTENCE) == JUDGED


def test_a_right_answer_keeps_the_learners_own_words() -> None:
    answer = {**JUDGED, "verdict": "right", "corrected": "Potrzebuję narzędzia!"}
    cleaned = clean_attempt(answer, SENTENCE)
    assert cleaned is not None and cleaned["corrected"] == "Potrzebuję narzędzie."


def test_a_sentence_without_the_word_isnt_right() -> None:
    answer = {**JUDGED, "verdict": "right", "used_word": False}
    cleaned = clean_attempt(answer, SENTENCE)
    assert cleaned is not None and cleaned["verdict"] == "almost" and cleaned["used_word"] is False


def test_a_translation_always_used_its_word() -> None:
    request = AttemptRequest(
        "de", "translate", "Wir warten.", english="We wait.", reference="Wir warten."
    )
    cleaned = clean_attempt({**JUDGED, "used_word": False}, request)
    assert cleaned is not None and cleaned["used_word"] is True


@pytest.mark.parametrize(
    "answer",
    [
        {**JUDGED, "verdict": "great"},
        {**JUDGED, "corrected": ""},
        {**JUDGED, "corrected": "Potrzebuję — narzędzia."},
        {**JUDGED, "english": None},
    ],
)
def test_an_answer_that_cant_be_used_is_none(answer: dict[str, Any]) -> None:
    assert clean_attempt(answer, SENTENCE) is None


def test_notes_are_trimmed_to_three() -> None:
    answer = {**JUDGED, "notes": ["a", " ", "b", "c", "d", 5]}
    cleaned = clean_attempt(answer, SENTENCE)
    assert cleaned is not None and cleaned["notes"] == ["a", "b", "c"]


def test_a_retellings_words_must_be_in_the_text_and_not_already_used() -> None:
    request = RetellRequest("th", "ฉันอยากกิน", LINES)
    answer = {
        **JUDGED,
        "words": [
            {"word": "ข้าวเหนียวมะม่วง", "english": "mango sticky rice"},
            {"word": "ข้าวเหนียวมะม่วง", "english": "again"},
            {"word": "อยาก", "english": "want"},  # already in the retelling
            {"word": "ทุเรียน", "english": "durian"},  # not in the text
        ],
        "left_out": " That it was for lunch. ",
    }
    cleaned = clean_retell(answer, request)
    assert cleaned is not None
    assert cleaned["words"] == [
        {"word": "ข้าวเหนียวมะม่วง", "english": "mango sticky rice", "line": 0}
    ]
    assert cleaned["left_out"] == "That it was for lunch."


def test_messages_carry_what_was_asked() -> None:
    assert "The word: narzędzie (tool)" in attempt_message(SENTENCE)
    translate = AttemptRequest(
        "de", "translate", "Wir warten.", english="We wait.", reference="Wir warten."
    )
    assert "Asked to say: We wait." in attempt_message(translate)
    assert "- ข้าวเหนียวมะม่วงครับ (Mango sticky rice!)" in retell_message(
        RetellRequest("th", "x", LINES)
    )


# ==== Claude's calls ====


def test_claude_checks_a_sentence() -> None:
    fake = FakeClient(response("end_turn", json.dumps(JUDGED)))
    answer, used = finish(claude_attempt(fake)(SENTENCE))  # type: ignore[arg-type]
    assert answer == JUDGED
    assert used.cost_usd() > 0
    assert "used_word" in fake.calls[0]["system"]


def test_an_answer_cut_off_fails_with_its_cost() -> None:
    fake = FakeClient(response("max_tokens", "{"))
    with pytest.raises(ProductionFailed) as e:
        finish(claude_attempt(fake)(SENTENCE))  # type: ignore[arg-type]
    assert e.value.usage.cost_usd() > 0


def test_claude_checks_a_retelling() -> None:
    answer = {**JUDGED, "words": [], "left_out": ""}
    fake = FakeClient(response("end_turn", json.dumps(answer)))
    checked, _ = finish(claude_retell(fake)(RetellRequest("th", "ฉันอยากกิน", LINES)))  # type: ignore[arg-type]
    assert checked["verdict"] == "almost" and checked["words"] == []


# ==== The API ====


def test_checks_a_sentence_and_keeps_its_cost() -> None:
    seen: list[AttemptRequest] = []

    async def check(request: AttemptRequest) -> tuple[dict[str, Any], Usage]:
        seen.append(request)
        return JUDGED, COST

    app, _ = client(check)
    body = {
        "kind": "sentence",
        "language": "pl",
        "attempt": " Potrzebuję narzędzie. ",
        "word": "narzędzie",
        "meaning": "tool",
    }
    got = app.post("/api/production/check", json=body, headers=AUTH)
    assert got.json() == JUDGED
    assert seen == [SENTENCE]
    costs = app.get("/api/costs", headers=AUTH).json()["production"]
    assert costs["asked"] == 1 and costs["cost_usd"] == 2.0


def test_a_sentence_needs_its_word() -> None:
    async def check(request: AttemptRequest) -> tuple[dict[str, Any], Usage]:
        return JUDGED, COST

    app, _ = client(check)
    body = {"kind": "sentence", "language": "pl", "attempt": "Tak."}
    assert app.post("/api/production/check", json=body, headers=AUTH).status_code == 422


def test_without_claude_it_says_so() -> None:
    app, _ = client()
    body = {"kind": "translate", "language": "de", "attempt": "Wir warten.", "english": "We wait."}
    got = app.post("/api/production/check", json=body, headers=AUTH)
    assert got.status_code == 503 and "ANTHROPIC_API_KEY" in got.json()["detail"]


def test_a_failed_check_keeps_what_it_cost() -> None:
    async def check(request: AttemptRequest) -> tuple[dict[str, Any], Usage]:
        raise ProductionFailed("Claude didn't check this. Try again in a moment.", COST)

    app, _ = client(check)
    body = {"kind": "translate", "language": "de", "attempt": "Wir warten.", "english": "We wait."}
    got = app.post("/api/production/check", json=body, headers=AUTH)
    assert got.status_code == 503 and got.json()["detail"].startswith("Claude didn't check")
    assert app.get("/api/costs", headers=AUTH).json()["production"]["asked"] == 1


def test_retells_a_text_with_its_lines() -> None:
    seen: list[RetellRequest] = []

    async def check(request: RetellRequest) -> tuple[dict[str, Any], Usage]:
        seen.append(request)
        return {**JUDGED, "words": [], "left_out": ""}, COST

    app, text_id = client(check_retell=check)
    got = app.post(f"/api/texts/{text_id}/retell", json={"attempt": "ฉันอยากกิน"}, headers=AUTH)
    assert got.status_code == 200
    assert seen[0].lines[0] == ("ฉันอยากกินข้าวเหนียวมะม่วงครับ", "line 0")
    assert app.post("/api/texts/999/retell", json={"attempt": "x"}, headers=AUTH).status_code == 404


def test_needs_the_passphrase() -> None:
    app, text_id = client()
    assert app.post("/api/production/check", json={}).status_code == 401
    assert app.post(f"/api/texts/{text_id}/retell", json={"attempt": "x"}).status_code == 401
