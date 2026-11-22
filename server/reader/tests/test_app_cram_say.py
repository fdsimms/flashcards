import random
from typing import Any

from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.cram_say import SayFailed, Turn, WriteSay
from franki_reader.cram_themes import Seeds
from franki_reader.engine import Engine
from franki_reader.generator import Usage

USED = Usage(input_tokens=400, output_tokens=200, model="claude-haiku-5-5")
LINES: dict[str, Any] = {
    "summary": "I had a coffee.",
    "lines": [
        {
            "english": "I had a coffee.",
            "text": "J'ai pris un café.",
            "new_words": [{"word": "croissant", "english": "croissant"}],
        }
    ],
}
LINES_BODY: dict[str, Any] = {
    "language": "fr",
    "said": "I had a coffee",
    "words": [{"id": "a1", "text": "un café", "english": "a coffee", "kind": "cram"}],
}


def client(
    answer: Any = None,
    asked: list[Any] | None = None,
    fail: bool = False,
    question: str = "How did it go?",
    claude: bool = True,
) -> tuple[TestClient, Any]:
    async def ask(language: str, topic: str, turns: tuple[Turn, ...]) -> tuple[str, Usage]:
        if asked is not None:
            asked.append((topic, turns))
        if fail:
            raise SayFailed("Claude didn't answer. Try again in a moment.", USED)
        return question, USED

    async def lines(language: str, seeds: Seeds) -> tuple[Any, Usage]:
        if asked is not None:
            asked.append(seeds)
        if fail:
            raise SayFailed("Claude didn't answer. Try again in a moment.", USED)
        return answer if answer is not None else LINES, USED

    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    writer = WriteSay(ask, lines) if claude else None
    c = TestClient(create_app(engine, "open sesame", write_cram_say=writer))
    c.__enter__()
    return c, conn


def test_asks_the_next_question_from_the_chat_so_far_and_keeps_the_cost() -> None:
    asked: list[Any] = []
    c, conn = client(asked=asked)
    with c:
        body = {
            "language": "th",
            "topic": "  The 5k   race ",
            "turns": [
                {"asker": "claude", "text": "How did the race go?"},
                {"asker": "you", "text": "  Pretty   good "},
            ],
        }
        r = c.post("/api/cram/say/ask", json=body, headers=AUTH)
        assert r.status_code == 200
        assert r.json() == {"question": "How did it go?"}
        rows = conn.execute("SELECT feature, language FROM call_costs").fetchall()
        assert [tuple(row) for row in rows] == [("cram_say", "th")]
    topic, turns = asked[0]
    assert topic == "The 5k race"
    assert turns == (Turn("claude", "How did the race go?"), Turn("you", "Pretty good"))


def test_lines_are_checked_and_the_words_lacking_come_back() -> None:
    c, conn = client()
    with c:
        r = c.post("/api/cram/say/lines", json=LINES_BODY, headers=AUTH)
        assert r.status_code == 200
        out = r.json()
        assert out["summary"] == "I had a coffee."
        line = out["lines"][0]
        assert line["text"] == "J'ai pris un café."
        assert {"word": "croissant", "english": "croissant"} in line["missing"]
        assert isinstance(line["known"], int)
        assert conn.execute("SELECT COUNT(*) FROM call_costs").fetchone()[0] == 1


def test_sends_what_was_said_the_words_and_the_register() -> None:
    asked: list[Any] = []
    c, _ = client(asked=asked)
    with c:
        body = {**LINES_BODY, "said": "  I had   a coffee ", "register": "casual"}
        assert c.post("/api/cram/say/lines", json=body, headers=AUTH).status_code == 200
        assert (
            c.post(
                "/api/cram/say/lines", json={**LINES_BODY, "said": "x" * 3001}, headers=AUTH
            ).status_code
            == 422
        )
    seeds = asked[0]
    assert seeds.facts == "I had a coffee"
    assert [(w.id, w.kind) for w in seeds.pool] == [("a1", "cram")]
    assert seeds.register == "casual"


def test_a_failed_call_still_counts_what_it_cost() -> None:
    c, conn = client(fail=True)
    with c:
        r = c.post("/api/cram/say/ask", json={"language": "fr"}, headers=AUTH)
        assert r.status_code == 503
        assert r.json()["detail"] == "Claude didn't answer. Try again in a moment."
        r = c.post("/api/cram/say/lines", json=LINES_BODY, headers=AUTH)
        assert r.status_code == 503
        assert conn.execute("SELECT COUNT(*) FROM call_costs").fetchone()[0] == 2


def test_nothing_usable_is_a_503_with_a_reason() -> None:
    c, _ = client(answer={"summary": "", "lines": []}, question="   ")
    with c:
        r = c.post("/api/cram/say/lines", json=LINES_BODY, headers=AUTH)
        assert r.status_code == 503
        assert r.json()["detail"] == "Claude had nothing to suggest from that. Try again."
        r = c.post("/api/cram/say/ask", json={"language": "fr"}, headers=AUTH)
        assert r.status_code == 503
        assert r.json()["detail"] == "Claude had no question. Try again."


def test_without_claude_or_in_english_it_says_so_and_it_needs_the_passphrase() -> None:
    c, _ = client(claude=False)
    with c:
        assert c.post("/api/cram/say/ask", json={"language": "fr"}, headers=AUTH).status_code == 503
    c, _ = client()
    with c:
        assert c.post("/api/cram/say/ask", json={"language": "en"}, headers=AUTH).status_code == 422
        assert c.post("/api/cram/say/ask", json={"language": "fr"}).status_code in (401, 403)
        assert (
            c.post("/api/cram/say/lines", json={**LINES_BODY, "said": ""}, headers=AUTH).status_code
            == 422
        )
