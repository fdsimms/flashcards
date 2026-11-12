import random
from datetime import datetime
from typing import Any

from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE
from scripted import ScriptedModel as AppModel
from test_app import AUTH, NOW, started
from test_generator import GOOD, MANGO, ScriptedModel, draft, run

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.explain import ExplainFailed, ExplainRequest, clean, request_message
from franki_reader.generator import TextRequest, Usage

POINTS = [{"phrase": "ฉัน", "note": "I, said by anyone."}]


def client(explain: Any = None, text: dict[str, Any] = GOOD) -> tuple[TestClient, int]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    # The same draft for each attempt, so one under the floor is kept as the closest.
    generated = run(ScriptedModel(text, text, text), TextRequest("food", (MANGO,)))
    text_id = store.save_text(
        conn, store.add_topic(conn, "food", True, NOW).id, generated, [], 0.95, NOW
    )
    engine = Engine(
        conn,
        AppModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 10, 19, 9),
        random.Random(1),
    )
    return started(create_app(engine, "open sesame", None, None, explain)), text_id


def url(text_id: int, line: int = 0) -> str:
    return f"/api/texts/{text_id}/lines/{line}/explain"


def test_explains_the_line_with_its_neighbours_as_context() -> None:
    seen: list[ExplainRequest] = []

    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        seen.append(request)
        return POINTS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(explain)
    response = c.post(url(text_id, 1), json={}, headers=AUTH)
    assert response.json() == {"points": POINTS, "grammar": []}
    assert len(seen) == 1 and not seen[0].simple
    assert "|" not in seen[0].line and "*" not in seen[0].line
    assert seen[0].context and seen[0].line not in seen[0].context


def test_asks_once_per_line_and_per_version() -> None:
    calls: list[bool] = []

    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        calls.append(request.simple)
        return POINTS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(explain)
    for body in ({}, {}, {"simple": True}, {"simple": True}):
        assert c.post(url(text_id), json=body, headers=AUTH).status_code == 200
    assert calls == [False, True]


def test_costs_count_each_explanation_asked_for() -> None:
    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        return POINTS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(explain)
    assert c.get("/api/costs", headers=AUTH).json()["explanations"]["asked"] == 0
    for body in ({}, {}, {"simple": True}):
        c.post(url(text_id), json=body, headers=AUTH)
    spent = c.get("/api/costs", headers=AUTH).json()["explanations"]
    assert spent["asked"] == 2 and spent["cost_usd"] == 4.0
    assert [r["language"] for r in spent["languages"]] == ["th"]


def test_a_failure_is_not_kept() -> None:
    results: list[Any] = [ExplainFailed("Claude didn't answer (APIError). Try again in a moment.")]

    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        if results:
            raise results.pop()
        return POINTS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(explain)
    failed = c.post(url(text_id), json={}, headers=AUTH)
    assert failed.status_code == 503 and failed.json()["detail"].startswith("Claude didn't answer")
    assert c.post(url(text_id), json={}, headers=AUTH).json()["points"] == POINTS


def test_needs_the_passphrase_and_a_real_line() -> None:
    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        return POINTS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(explain)
    assert c.post(url(text_id), json={}).status_code == 401
    assert c.post(url(text_id, 99), json={}, headers=AUTH).status_code == 404
    assert c.post(url(text_id + 1), json={}, headers=AUTH).status_code == 404


def test_says_so_when_claude_isnt_set_up() -> None:
    c, text_id = client(None)
    response = c.post(url(text_id), json={}, headers=AUTH)
    assert response.status_code == 503 and "ANTHROPIC_API_KEY" in response.json()["detail"]


def test_clean_drops_blank_and_malformed_points() -> None:
    raw = [{"phrase": " a ", "note": " b "}, {"phrase": "", "note": "x"}, "no", {"phrase": "c"}]
    assert clean(raw) == [{"phrase": "a", "note": "b"}]
    assert clean("nope") == []
    assert len(clean([{"phrase": str(i), "note": "n"} for i in range(20)])) == 6


def test_the_request_names_the_language_and_context() -> None:
    message = request_message(ExplainRequest("es", "Ya vengo.", "I'll be right back.", ("Claro.",)))
    assert "Spanish" in message and "Ya vengo." in message and "- Claro." in message


def test_lists_the_grammar_found_in_the_line_with_the_choices_as_they_stand() -> None:
    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        return POINTS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    asks = draft(
        "ฉัน|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ไหม",
        "*ข้าวเหนียวมะม่วง*|ครับ",
        *["ฉัน|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ"] * 4,
        glosses={"ไหม": "yes or no question"},
    )
    c, text_id = client(explain, asks)
    first = c.post(url(text_id), json={}, headers=AUTH).json()["grammar"]
    assert [(g["id"], g["name"], g["state"]) for g in first] == [
        ("th.yes_no", "ไหม, หรือเปล่า (yes or no questions)", "unset")
    ]
    assert first[0]["note"]
    # A choice made since shows on the explanation kept from before.
    c.put("/api/grammar/th.yes_no", json={"state": "practice"}, headers=AUTH)
    kept = c.post(url(text_id), json={}, headers=AUTH).json()["grammar"]
    assert kept[0]["state"] == "practice"
    assert c.post(url(text_id, 1), json={}, headers=AUTH).json()["grammar"] == []
