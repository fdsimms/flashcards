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
from franki_reader.explain import (
    CheckRequest,
    ExplainFailed,
    ExplainRequest,
    PhraseRequest,
    check_message,
    clean,
    clean_check,
    clean_phrase,
    phrase_message,
    request_message,
)
from franki_reader.generator import TextRequest, Usage

POINTS = [{"phrase": "ฉัน", "note": "I, said by anyone."}]


def client(
    explain: Any = None,
    explain_phrase: Any = None,
    text: dict[str, Any] = GOOD,
    check_natural: Any = None,
) -> tuple[TestClient, int]:
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
    app = create_app(
        engine, "open sesame", None, None, explain, explain_phrase, check_natural=check_natural
    )
    return started(app), text_id


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
    c, text_id = client(explain, text=asks)
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


# ==== Phrases ====

ANSWER = {"meaning": "I want", "points": [{"phrase": "ต้องการ", "note": "A polite want."}]}


def phrase_url(text_id: int, line: int = 0) -> str:
    return f"/api/texts/{text_id}/lines/{line}/phrase"


def line_text(c: TestClient, text_id: int, line: int) -> str:
    """The line as the app shows it: its pieces joined."""
    shown = c.get(f"/api/texts/{text_id}", headers=AUTH).json()
    return "".join(w["text"] for w in shown["lines"][line]["words"])


def test_explains_a_phrase_from_the_line_with_its_neighbours() -> None:
    seen: list[PhraseRequest] = []

    async def explain(request: PhraseRequest) -> tuple[dict[str, Any], Usage]:
        seen.append(request)
        return ANSWER, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(None, explain)
    shown = line_text(c, text_id, 1)
    phrase = shown[: max(2, len(shown) // 2)]
    response = c.post(phrase_url(text_id, 1), json={"phrase": phrase}, headers=AUTH)
    assert response.status_code == 200 and response.json() == ANSWER
    assert len(seen) == 1 and seen[0].phrase == phrase.strip() and not seen[0].simple
    assert seen[0].line == shown and "|" not in seen[0].line
    assert seen[0].context and seen[0].line not in seen[0].context


def test_asks_once_per_phrase_and_per_version() -> None:
    calls: list[tuple[str, bool]] = []

    async def explain(request: PhraseRequest) -> tuple[dict[str, Any], Usage]:
        calls.append((request.phrase, request.simple))
        return ANSWER, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(None, explain)
    shown = line_text(c, text_id, 0)
    a, b = shown[:2], shown[:3]
    for body in (
        {"phrase": a},
        {"phrase": a},
        {"phrase": b},
        {"phrase": a, "simple": True},
        {"phrase": a, "simple": True},
    ):
        assert c.post(phrase_url(text_id), json=body, headers=AUTH).status_code == 200
    assert calls == [(a, False), (b, False), (a, True)]


def test_a_phrase_counts_with_the_explanations_in_costs() -> None:
    async def explain_line(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        return POINTS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    async def explain(request: PhraseRequest) -> tuple[dict[str, Any], Usage]:
        return ANSWER, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(explain_line, explain)
    c.post(url(text_id), json={}, headers=AUTH)
    c.post(phrase_url(text_id), json={"phrase": line_text(c, text_id, 0)[:2]}, headers=AUTH)
    spent = c.get("/api/costs", headers=AUTH).json()["explanations"]
    assert spent["asked"] == 2 and spent["cost_usd"] == 4.0


def test_refuses_a_phrase_that_isnt_in_the_line() -> None:
    async def explain(request: PhraseRequest) -> tuple[dict[str, Any], Usage]:
        raise AssertionError("not asked")

    c, text_id = client(None, explain)
    for phrase in ("nowhere", " "):
        response = c.post(phrase_url(text_id), json={"phrase": phrase}, headers=AUTH)
        assert response.status_code in (400, 422)
    assert c.post(phrase_url(text_id), json={"phrase": "x"}).status_code == 401
    assert c.post(phrase_url(text_id, 99), json={"phrase": "x"}, headers=AUTH).status_code == 404


def test_a_failed_phrase_is_not_kept_and_says_so_without_claude() -> None:
    results: list[Any] = [
        ExplainFailed("Claude didn't explain this phrase. Try again in a moment.")
    ]

    async def explain(request: PhraseRequest) -> tuple[dict[str, Any], Usage]:
        if results:
            raise results.pop()
        return ANSWER, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(None, explain)
    body = {"phrase": line_text(c, text_id, 0)[:2]}
    failed = c.post(phrase_url(text_id), json=body, headers=AUTH)
    assert failed.status_code == 503 and "this phrase" in failed.json()["detail"]
    assert c.post(phrase_url(text_id), json=body, headers=AUTH).json() == ANSWER
    unset, other = client(None, None)
    off = unset.post(
        phrase_url(other), json={"phrase": line_text(unset, other, 0)[:2]}, headers=AUTH
    )
    assert off.status_code == 503 and "ANTHROPIC_API_KEY" in off.json()["detail"]


def test_clean_phrase_needs_a_meaning() -> None:
    assert clean_phrase({"meaning": " I know ", "points": [{"phrase": "ya", "note": " n "}]}) == {
        "meaning": "I know",
        "points": [{"phrase": "ya", "note": "n"}],
    }
    assert clean_phrase({"meaning": " ", "points": []}) is None
    assert clean_phrase({"points": []}) is None


def test_the_phrase_request_names_the_phrase_and_its_line() -> None:
    message = phrase_message(
        PhraseRequest("es", "ya lo sé", "Sí, ya lo sé.", "Yes, I know.", ("¿Sabes?",))
    )
    assert "Selected phrase: ya lo sé" in message and "Line: Sí, ya lo sé." in message
    assert "Spanish" in message and "- ¿Sabes?" in message


# ==== Does this sound natural? ====

VERDICT = {"verdict": "stiff", "reason": "Too written for a market.", "alternative": "ฉัน|กิน"}
COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")


def natural_url(text_id: int, line: int = 0) -> str:
    return f"/api/texts/{text_id}/lines/{line}/natural"


def test_checks_the_line_with_who_says_it_and_its_neighbours() -> None:
    seen: list[CheckRequest] = []

    async def check(request: CheckRequest) -> tuple[dict[str, str], Usage]:
        seen.append(request)
        return VERDICT, COST

    c, text_id = client(check_natural=check)
    response = c.post(natural_url(text_id, 1), headers=AUTH)
    assert response.status_code == 200 and response.json() == VERDICT
    assert len(seen) == 1 and "|" not in seen[0].line and "*" not in seen[0].line
    assert seen[0].speaker == "B (Customer)"
    assert seen[0].context and seen[0].line not in seen[0].context


def test_checks_a_line_once_and_counts_it_with_the_explanations() -> None:
    calls: list[str] = []

    async def check(request: CheckRequest) -> tuple[dict[str, str], Usage]:
        calls.append(request.line)
        return VERDICT, COST

    c, text_id = client(check_natural=check)
    for _ in range(3):
        assert c.post(natural_url(text_id), headers=AUTH).json() == VERDICT
    assert len(calls) == 1
    spent = c.get("/api/costs", headers=AUTH).json()["explanations"]
    assert spent["asked"] == 1 and spent["cost_usd"] == 2.0


def test_a_failed_check_is_not_kept() -> None:
    results: list[Any] = [ExplainFailed("Claude didn't check this line. Try again in a moment.")]

    async def check(request: CheckRequest) -> tuple[dict[str, str], Usage]:
        if results:
            raise results.pop()
        return VERDICT, COST

    c, text_id = client(check_natural=check)
    failed = c.post(natural_url(text_id), headers=AUTH)
    assert failed.status_code == 503 and "didn't check" in failed.json()["detail"]
    assert c.post(natural_url(text_id), headers=AUTH).json() == VERDICT


def test_a_check_needs_the_passphrase_a_real_line_and_claude() -> None:
    async def check(request: CheckRequest) -> tuple[dict[str, str], Usage]:
        raise AssertionError("not asked")

    c, text_id = client(check_natural=check)
    assert c.post(natural_url(text_id)).status_code == 401
    assert c.post(natural_url(text_id, 99), headers=AUTH).status_code == 404
    assert c.post(natural_url(text_id + 1), headers=AUTH).status_code == 404
    unset, other = client()
    off = unset.post(natural_url(other), headers=AUTH)
    assert off.status_code == 503 and "ANTHROPIC_API_KEY" in off.json()["detail"]


def test_clean_check_needs_a_known_verdict_and_a_reason() -> None:
    assert clean_check(
        {"verdict": "stiff", "reason": " Too formal. ", "alternative": " Pourquoi tu "}
    ) == {
        "verdict": "stiff",
        "reason": "Too formal.",
        "alternative": "Pourquoi tu",
    }
    # A natural line has no alternative, whatever the model sent.
    natural = clean_check({"verdict": "natural", "reason": "Fine.", "alternative": "Same."})
    assert natural is not None and natural["alternative"] == ""
    assert clean_check({"verdict": "wrong", "reason": "x", "alternative": ""}) is None
    assert clean_check({"verdict": "stiff", "reason": " ", "alternative": ""}) is None
    assert clean_check({"verdict": "stiff", "alternative": ""}) is None


def test_the_check_request_names_the_language_speaker_and_register() -> None:
    message = check_message(
        CheckRequest(
            "fr",
            "Pourquoi regardes-tu cela ?",
            "Why are you looking at that?",
            "A (Friend)",
            "formal",
            ("Salut.",),
        )
    )
    assert "French" in message and "Line: Pourquoi regardes-tu cela ?" in message
    assert "Spoken by: A (Friend)" in message and "written as: formal" in message
    assert "- Salut." in message
    bare = check_message(CheckRequest("fr", "Salut.", "Hi."))
    assert "Spoken by" not in bare and "written as" not in bare
