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
from franki_reader.fix_card import (
    MAX_FIELD,
    Fix,
    FixCardFailed,
    FlaggedCard,
    claude_fix_card,
    clean,
    request_message,
)
from franki_reader.generator import Usage

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
FIELDS = {
    "Entry": "เสีย",
    "Meaning": "to break down; to be sorry (เสียใจ)",
    "Context": "แอร์<b>เสีย</b>ครับ[sound:a.mp3]",
}
BODY = {
    "language": "th",
    "fields": FIELDS,
    "reason": "Typo or wrong text",
    "note": "The word shouldn't be in its own definition.",
}


def client(fix: Any = None) -> tuple[TestClient, Any]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 10, 19, 9),
        random.Random(1),
    )
    app = create_app(engine, "open sesame", None, fix_flagged_card=fix)
    return started(app), conn


def costs(conn: Any) -> list[tuple[str, str]]:
    return [tuple(r) for r in conn.execute("SELECT feature, language FROM call_costs")]


def card(note: str = "remove it") -> FlaggedCard:
    return FlaggedCard("th", FIELDS, "Typo or wrong text", note)


def test_the_message_names_the_reason_the_owners_words_and_every_field() -> None:
    text = request_message(card())
    assert "Language: Thai" in text
    assert "Flagged because: Typo or wrong text" in text
    assert "What the learner wrote: remove it" in text
    assert "Context: แอร์<b>เสีย</b>ครับ[sound:a.mp3]" in text
    assert "What the learner wrote" not in request_message(card(""))


def test_only_fields_that_exist_and_change_are_kept() -> None:
    answer = {
        "changes": [
            {"field": "Meaning", "value": "to break down; to be sorry"},
            {"field": "Meaning", "value": "second answer for the same field"},
            {"field": "Entry", "value": "เสีย"},  # unchanged
            {"field": "Nope", "value": "x"},  # not a field of this note
            {"field": "Context", "value": "y" * (MAX_FIELD + 1)},  # too long
            {"field": 3, "value": "x"},
            "junk",
        ],
        "explanation": "  The definition\nrepeated the word.  ",
    }
    assert clean(answer, FIELDS) == Fix(
        {"Meaning": "to break down; to be sorry"}, "The definition repeated the word."
    )
    assert clean({"changes": "no"}, FIELDS) == Fix({}, "")


def test_asks_haiku_with_the_schema_and_returns_the_cleaned_fix() -> None:
    reply = {"changes": [{"field": "Meaning", "value": "to break down"}], "explanation": "ok"}
    fake = FakeClient(response("end_turn", json.dumps(reply)))
    fix, used = finish(claude_fix_card(fake)(card()))  # type: ignore[arg-type]
    assert fix.changes == {"Meaning": "to break down"}
    assert used.cost_usd() > 0
    assert fake.calls[0]["model"] == "claude-haiku-5-5"
    assert fake.calls[0]["output_config"]["format"]["type"] == "json_schema"


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
    fake = FakeClient(response(stop, text))
    with pytest.raises(FixCardFailed) as e:
        finish(claude_fix_card(fake)(card()))  # type: ignore[arg-type]
    assert e.value.usage.cost_usd() > 0


def test_the_route_returns_the_fix_and_keeps_the_cost() -> None:
    seen: list[FlaggedCard] = []

    async def fix(c: FlaggedCard) -> tuple[Fix, Usage]:
        seen.append(c)
        return Fix({"Meaning": "to break down"}, "Removed the Thai word."), COST

    c, conn = client(fix)
    answer = c.post("/api/fix-card", json=BODY, headers=AUTH)
    assert answer.status_code == 200
    assert answer.json() == {
        "changes": {"Meaning": "to break down"},
        "explanation": "Removed the Thai word.",
    }
    assert seen[0].language == "th" and seen[0].note.startswith("The word")
    assert costs(conn) == [("fix_card", "th")]


def test_a_failed_call_that_was_billed_is_kept_and_503() -> None:
    async def fix(c: FlaggedCard) -> tuple[Fix, Usage]:
        raise FixCardFailed("Claude didn't suggest a fix.", COST)

    c, conn = client(fix)
    answer = c.post("/api/fix-card", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert answer.json()["detail"] == "Claude didn't suggest a fix."
    assert costs(conn) == [("fix_card", "th")]


def test_without_claude_it_says_how_to_turn_it_on() -> None:
    c, _ = client(None)
    answer = c.post("/api/fix-card", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert "ANTHROPIC_API_KEY" in answer.json()["detail"]


def test_a_note_with_no_fields_or_a_huge_one_is_refused() -> None:
    c, _ = client(lambda c: None)
    assert c.post("/api/fix-card", json={**BODY, "fields": {}}, headers=AUTH).status_code == 422
    big = {**BODY, "fields": {"Entry": "x" * 8001}}
    assert c.post("/api/fix-card", json=big, headers=AUTH).status_code == 422


def test_needs_the_passphrase() -> None:
    c, _ = client(lambda c: None)
    assert c.post("/api/fix-card", json=BODY).status_code in (401, 403)
