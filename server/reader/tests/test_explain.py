import random
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE
from scripted import ScriptedModel as AppModel
from test_app import AUTH, NOW, started
from test_generator import GOOD, MANGO, FakeClient, ScriptedModel, draft, finish, response, run

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.explain import (
    CALIBRATION,
    ENGLISH,
    IN_LANGUAGE,
    PHRASE_SYSTEM,
    SYSTEM,
    CheckRequest,
    ExplainFailed,
    ExplainRequest,
    FormRequest,
    PhraseRequest,
    check_message,
    claude_check,
    claude_explain,
    claude_explain_phrase,
    clean,
    clean_check,
    clean_form,
    clean_phrase,
    form_message,
    in_language,
    phrase_message,
    request_message,
)
from franki_reader.generator import TextRequest, Usage
from franki_reader.routes.explain import MAX_PHRASE_LINES

POINTS = [{"phrase": "ฉัน", "note": "I, said by anyone."}]


def client(
    explain: Any = None,
    explain_phrase: Any = None,
    explain_form: Any = None,
    text: dict[str, Any] = GOOD,
    check_natural: Any = None,
) -> tuple[TestClient, int]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    # The same draft for each attempt, so one under the floor is kept as the closest.
    generated = run(ScriptedModel(text, text, text), TextRequest("food", (MANGO,)))
    text_id = store.save_text(conn, store.add_topic(conn, "food", NOW).id, generated, [], 0.95, NOW)
    engine = Engine(
        conn,
        AppModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 10, 19, 9),
        random.Random(1),
    )
    app = create_app(
        engine,
        "open sesame",
        None,
        None,
        explain,
        explain_phrase,
        explain_form,
        check_natural=check_natural,
    )
    return started(app), text_id


def url(text_id: int, line: int = 0) -> str:
    return f"/api/texts/{text_id}/lines/{line}/explain"


def test_explains_the_line_with_the_whole_text_as_context() -> None:
    seen: list[ExplainRequest] = []

    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        seen.append(request)
        return POINTS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(explain)
    response = c.post(url(text_id, 1), json={}, headers=AUTH)
    assert response.json() == {"points": POINTS, "grammar": []}
    assert len(seen) == 1 and not seen[0].simple
    assert "|" not in seen[0].line and "*" not in seen[0].line
    shown_lines = c.get(f"/api/texts/{text_id}", headers=AUTH).json()["lines"]
    assert len(seen[0].context) == len(shown_lines) and seen[0].index == 1
    assert seen[0].line in seen[0].context[1] and seen[0].title


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
    message = request_message(
        ExplainRequest(
            "es",
            "Ya vengo.",
            "I'll be right back.",
            ("A: Claro. (Sure.)", "B: Ya vengo. (I'll be right back.)"),
            title="Un café",
            index=1,
        )
    )
    assert "Spanish" in message and "Line 2: Ya vengo." in message and "(Un café)" in message
    assert "1. A: Claro. (Sure.)\n" in message
    assert "2. B: Ya vengo. (I'll be right back.)   <- the selected line" in message


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


def test_explains_a_phrase_from_the_line_with_the_whole_text() -> None:
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
    # Every line of the text, the selected one included, each with its English.
    shown_lines = c.get(f"/api/texts/{text_id}", headers=AUTH).json()["lines"]
    assert len(seen[0].context) == len(shown_lines) and seen[0].index == 1
    assert seen[0].line in seen[0].context[1] and seen[0].title


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


def test_explains_a_phrase_that_runs_on_into_the_next_line() -> None:
    seen: list[PhraseRequest] = []

    async def explain(request: PhraseRequest) -> tuple[dict[str, Any], Usage]:
        seen.append(request)
        return ANSWER, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(None, explain)
    first, second = line_text(c, text_id, 0), line_text(c, text_id, 1)
    # The end of one line and the start of the next, joined with a space as the app joins them.
    phrase = f"{first[-3:].strip()} {second[:3].strip()}"
    response = c.post(phrase_url(text_id), json={"phrase": phrase, "to_line": 1}, headers=AUTH)
    assert response.status_code == 200 and response.json() == ANSWER
    assert seen[0].index == 0 and seen[0].through == 1
    assert seen[0].line.startswith(first.strip()) and seen[0].line.endswith(second.strip())
    lines = c.get(f"/api/texts/{text_id}", headers=AUTH).json()["lines"]
    assert seen[0].english == f"{lines[0]['english']} {lines[1]['english']}"
    # Without its last line it isn't in the one line, so it's refused rather than explained wrong.
    alone = c.post(phrase_url(text_id), json={"phrase": phrase}, headers=AUTH)
    assert alone.status_code == 400 and len(seen) == 1


def test_refuses_a_phrase_over_lines_out_of_order_missing_or_too_many() -> None:
    async def explain(request: PhraseRequest) -> tuple[dict[str, Any], Usage]:
        raise AssertionError("not asked")

    c, text_id = client(None, explain)
    phrase = line_text(c, text_id, 1)[:2]
    for to_line in (0, 99):
        response = c.post(
            phrase_url(text_id, 1), json={"phrase": phrase, "to_line": to_line}, headers=AUTH
        )
        assert response.status_code == 404
    count = len(c.get(f"/api/texts/{text_id}", headers=AUTH).json()["lines"])
    if count > MAX_PHRASE_LINES:
        too_many = c.post(
            phrase_url(text_id, 0),
            json={"phrase": line_text(c, text_id, 0)[:2], "to_line": MAX_PHRASE_LINES},
            headers=AUTH,
        )
        assert too_many.status_code == 400 and "at most" in too_many.json()["detail"]


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
        "literal": "",
        "register": "",
        "register_note": "",
        "points": [{"phrase": "ya", "note": "n"}],
    }
    assert clean_phrase({"meaning": " ", "points": []}) is None
    assert clean_phrase({"points": []}) is None


def test_clean_phrase_keeps_a_literal_only_when_it_differs() -> None:
    differs = clean_phrase({"meaning": "I am cold", "literal": " To me is cold ", "points": []})
    assert differs is not None and differs["literal"] == "To me is cold"
    same = clean_phrase({"meaning": "I am cold.", "literal": "i am cold", "points": []})
    assert same is not None and same["literal"] == ""
    assert clean_phrase({"meaning": "Hi", "literal": 3, "points": []}) == {
        "meaning": "Hi",
        "literal": "",
        "register": "",
        "register_note": "",
        "points": [],
    }


def test_clean_phrase_keeps_a_register_only_from_the_list() -> None:
    got = clean_phrase(
        {"meaning": "Hi", "register": "casual", "register_note": " With friends. ", "points": []}
    )
    assert got is not None and got["register"] == "casual"
    assert got["register_note"] == "With friends."
    # An answer outside the list, or a reason with no register, is dropped rather than shown.
    odd = clean_phrase(
        {"meaning": "Hi", "register": "rude", "register_note": "Blunt.", "points": []}
    )
    assert odd is not None and odd["register"] == "" and odd["register_note"] == ""


def test_the_phrase_request_names_the_phrase_and_its_line() -> None:
    message = phrase_message(
        PhraseRequest(
            "es",
            "ya lo sé",
            "Sí, ya lo sé.",
            "Yes, I know.",
            ("A: ¿Sabes? (Do you know?)", "B: Sí, ya lo sé. (Yes, I know.)"),
            title="En la calle",
            index=1,
        )
    )
    assert "Selected phrase: ya lo sé" in message and "Line 2: Sí, ya lo sé." in message
    assert "Spanish" in message and "(En la calle)" in message
    # The whole text is numbered, with the selected line marked.
    assert "1. A: ¿Sabes? (Do you know?)\n" in message
    assert "2. B: Sí, ya lo sé. (Yes, I know.)   <- the selected line" in message


def test_a_phrase_over_lines_names_and_marks_each_of_them() -> None:
    message = phrase_message(
        PhraseRequest(
            "es",
            "lo sé. ¿Y tú",
            "Sí, ya lo sé. ¿Y tú?",
            "Yes, I know. And you?",
            ("A: Sí, ya lo sé. (Yes, I know.)", "A: ¿Y tú? (And you?)", "B: No. (No.)"),
            title="En la calle",
            index=0,
            through=1,
        )
    )
    assert "Lines 1-2: Sí, ya lo sé. ¿Y tú?" in message
    assert "1. A: Sí, ya lo sé. (Yes, I know.)   <- the selected line" in message
    assert "2. A: ¿Y tú? (And you?)   <- the selected line" in message
    assert "3. B: No. (No.)\n" in message and message.count("<- the selected line") == 2


# ==== Does this sound natural? ====

VERDICT = {"verdict": "stiff", "reason": "Too written for a market.", "alternative": "ฉัน|กิน"}
COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")


def natural_url(text_id: int, line: int = 0) -> str:
    return f"/api/texts/{text_id}/lines/{line}/natural"


def test_checks_the_line_with_who_says_it_and_the_whole_text() -> None:
    seen: list[CheckRequest] = []

    async def check(request: CheckRequest) -> tuple[dict[str, str], Usage]:
        seen.append(request)
        return VERDICT, COST

    c, text_id = client(check_natural=check)
    response = c.post(natural_url(text_id, 1), headers=AUTH)
    assert response.status_code == 200 and response.json() == VERDICT
    assert len(seen) == 1 and "|" not in seen[0].line and "*" not in seen[0].line
    assert seen[0].speaker == "B (Customer)"
    shown_lines = c.get(f"/api/texts/{text_id}", headers=AUTH).json()["lines"]
    assert len(seen[0].context) == len(shown_lines) and seen[0].index == 1
    assert seen[0].line in seen[0].context[1]


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
            ("A: Salut. (Hi.)", "B: Pourquoi regardes-tu cela ? (Why are you looking at that?)"),
            index=1,
        )
    )
    assert "French" in message and "Line 2: Pourquoi regardes-tu cela ?" in message
    assert "Spoken by: A (Friend)" in message and "written as: formal" in message
    assert "1. A: Salut. (Hi.)\n" in message and "   <- the selected line" in message
    bare = check_message(CheckRequest("fr", "Salut.", "Hi."))
    assert "Spoken by" not in bare and "written as" not in bare


# ==== A failed call's cost ====


def test_a_failed_call_claude_answered_counts_with_the_explanations_but_isnt_kept() -> None:
    failures = {"explain": 1, "phrase": 1, "natural": 1}

    def failing_once(kind: str, answer: Any) -> Any:
        async def ask(request: Any) -> Any:
            if failures[kind]:
                failures[kind] -= 1
                raise ExplainFailed("Claude didn't explain this line. Try again.", COST)
            return answer, COST

        return ask

    c, text_id = client(
        failing_once("explain", POINTS),
        failing_once("phrase", ANSWER),
        check_natural=failing_once("natural", VERDICT),
    )
    phrase = {"phrase": line_text(c, text_id, 0)[:2]}
    assert c.post(url(text_id), json={}, headers=AUTH).status_code == 503
    assert c.post(phrase_url(text_id), json=phrase, headers=AUTH).status_code == 503
    assert c.post(natural_url(text_id), headers=AUTH).status_code == 503
    spent = c.get("/api/costs", headers=AUTH).json()["explanations"]
    assert spent["asked"] == 3 and spent["cost_usd"] == 6.0
    assert spent["languages"] == [{"language": "th", "name": "Thai", "asked": 3, "cost_usd": 6.0}]
    # Nothing was kept, so each is asked again, and those answers count too.
    assert c.post(url(text_id), json={}, headers=AUTH).json()["points"] == POINTS
    assert c.post(phrase_url(text_id), json=phrase, headers=AUTH).json() == ANSWER
    assert c.post(natural_url(text_id), headers=AUTH).json() == VERDICT
    spent = c.get("/api/costs", headers=AUTH).json()["explanations"]
    assert spent["asked"] == 6 and spent["cost_usd"] == 12.0


def test_a_call_claude_never_answered_costs_nothing() -> None:
    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        raise ExplainFailed("Claude didn't answer (APIError). Try again in a moment.")

    c, text_id = client(explain)
    assert c.post(url(text_id), json={}, headers=AUTH).status_code == 503
    assert c.get("/api/costs", headers=AUTH).json()["explanations"]["asked"] == 0


BAD_ANSWERS = [("refusal", None), ("max_tokens", '{"points"'), ("end_turn", None)]


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [*BAD_ANSWERS, ("end_turn", "not json"), ("end_turn", "[]"), ("end_turn", '{"points": []}')],
)
def test_claude_explain_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    explain = claude_explain(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(ExplainFailed) as failed:
        finish(explain(ExplainRequest("th", "ฉัน", "I")))
    assert failed.value.usage.output_tokens == 900  # the call is still paid for


@pytest.mark.parametrize(
    ("stop_reason", "text"), [*BAD_ANSWERS, ("end_turn", '{"meaning": "", "points": []}')]
)
def test_claude_explain_phrase_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    explain = claude_explain_phrase(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(ExplainFailed) as failed:
        finish(explain(PhraseRequest("th", "ฉัน", "ฉัน", "I")))
    assert failed.value.usage.output_tokens == 900


@pytest.mark.parametrize(
    ("stop_reason", "text"), [*BAD_ANSWERS, ("end_turn", '{"verdict": "fine", "reason": "x"}')]
)
def test_claude_check_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    check = claude_check(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(ExplainFailed) as failed:
        finish(check(CheckRequest("th", "ฉัน", "I")))
    assert failed.value.usage.output_tokens == 900


def test_both_prompts_keep_frequency_and_register_to_what_is_certain() -> None:
    assert CALIBRATION in SYSTEM
    assert CALIBRATION in PHRASE_SYSTEM
    # The notes are in English whatever the line's language (the model drifted into Russian).
    assert ENGLISH in SYSTEM
    assert ENGLISH in PHRASE_SYSTEM


def test_a_phrase_meaning_translates_only_the_selection() -> None:
    # The whole text is in the prompt, and the model once tacked the story onto a meaning.
    assert "add no clause, detail or explanation that the phrase doesn't say" in PHRASE_SYSTEM
    # What the text adds is welcome, in a note under the meaning.
    assert "never in `meaning`" in PHRASE_SYSTEM


def test_points_come_back_in_the_order_of_the_sentence() -> None:
    from franki_reader.explain import clean, clean_phrase

    phrase = "เธอยิ้มให้เขา"
    given = [
        {"phrase": "ยิ้มให้", "note": "b"},
        {"phrase": "เขา", "note": "c"},
        {"phrase": phrase, "note": "story"},
        {"phrase": "เธอ", "note": "a"},
        {"phrase": "not in it", "note": "x"},
    ]
    want = ["เธอ", "ยิ้มให้", "เขา", phrase, "not in it"]
    assert [p["phrase"] for p in clean(given, phrase)] == want
    answer = {"meaning": "She smiled at him", "points": given}
    cleaned = clean_phrase(answer, phrase)
    assert cleaned is not None and [p["phrase"] for p in cleaned["points"]] == want
    # Without a line to place them in, the model's order stands.
    assert clean(given)[0]["phrase"] == "ยิ้มให้"


def test_both_prompts_ask_for_reading_order() -> None:
    for system in (SYSTEM, PHRASE_SYSTEM):
        assert "in the order their parts appear" in system
        assert "most useful first" not in system


def test_the_notes_in_the_language_are_asked_and_kept_apart() -> None:
    calls: list[bool] = []

    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        calls.append(request.in_language)
        return POINTS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(explain)
    bodies: tuple[dict[str, bool], ...] = (
        {},
        {"in_language": True},
        {"in_language": True},
        {"in_language": True, "simple": True},
    )
    for body in bodies:
        assert c.post(url(text_id), json=body, headers=AUTH).status_code == 200
    assert calls == [False, True, True]


def test_in_language_prompts_drop_the_english_only_instructions() -> None:
    for system in (SYSTEM, PHRASE_SYSTEM):
        swapped = in_language(system)
        assert IN_LANGUAGE in swapped and ENGLISH not in swapped
        assert "in plain English" not in swapped and ", ." not in swapped


# ==== Forms ====

PARAGRAPHS = ["Видеть takes the accusative.", "Глаз has an irregular plural."]


def form_url(text_id: int, line: int = 0) -> str:
    return f"/api/texts/{text_id}/lines/{line}/form"


def form_body(c: TestClient, text_id: int, line: int = 0) -> dict[str, str]:
    word = line_text(c, text_id, line)[:2]
    return {"word": word, "lemma": word, "form": "accusative plural", "helper": ""}


def test_explains_a_form_once_per_word_and_keeps_it() -> None:
    seen: list[FormRequest] = []

    async def explain(request: FormRequest) -> tuple[list[str], Usage]:
        seen.append(request)
        return PARAGRAPHS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(None, None, explain)
    body = form_body(c, text_id, 1)
    for _ in range(2):
        response = c.post(form_url(text_id, 1), json=body, headers=AUTH)
        assert response.status_code == 200 and response.json() == {"explanation": PARAGRAPHS}
    assert len(seen) == 1 and seen[0].word == body["word"] and seen[0].form == body["form"]
    shown_lines = c.get(f"/api/texts/{text_id}", headers=AUTH).json()["lines"]
    assert len(seen[0].context) == len(shown_lines) and seen[0].index == 1
    spent = c.get("/api/costs", headers=AUTH).json()["explanations"]
    assert spent["asked"] == 1 and spent["cost_usd"] == 2.0


def test_refuses_a_form_for_a_word_not_in_the_line() -> None:
    async def explain(request: FormRequest) -> tuple[list[str], Usage]:
        raise AssertionError("not asked")

    c, text_id = client(None, None, explain)
    body = form_body(c, text_id) | {"word": "nowhere"}
    assert c.post(form_url(text_id), json=body, headers=AUTH).status_code == 400
    assert c.post(form_url(text_id), json=body).status_code == 401
    assert c.post(form_url(text_id, 99), json=body, headers=AUTH).status_code == 404


def test_a_failed_form_is_not_kept_and_says_so_without_claude() -> None:
    results: list[Any] = [ExplainFailed("Claude didn't explain this form. Try again in a moment.")]

    async def explain(request: FormRequest) -> tuple[list[str], Usage]:
        if results:
            raise results.pop()
        return PARAGRAPHS, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")

    c, text_id = client(None, None, explain)
    body = form_body(c, text_id)
    failed = c.post(form_url(text_id), json=body, headers=AUTH)
    assert failed.status_code == 503 and "Try again" in failed.json()["detail"]
    assert c.post(form_url(text_id), json=body, headers=AUTH).json() == {"explanation": PARAGRAPHS}
    none, other = client()
    assert none.post(form_url(other), json=form_body(none, other), headers=AUTH).status_code == 503


def test_form_message_names_the_form_and_its_helper() -> None:
    request = FormRequest("ru", "глаза", "глаз", "accusative plural", "видит", "line", "en")
    message = form_message(request)
    assert "Word: глаза" in message and "Dictionary form: глаз" in message
    assert "accusative plural" in message and "The word that goes with it: видит" in message
    assert "goes with it" not in form_message(
        FormRequest("ru", "глаза", "глаз", "accusative plural", "", "line", "en")
    )


def test_clean_form_trims_and_limits_the_paragraphs() -> None:
    assert clean_form({"explanation": [" a ", "", 3, "b"]}) == ["a", "b"]
    assert clean_form({"explanation": "no"}) == []
    assert len(clean_form({"explanation": ["x"] * 9})) == 3
