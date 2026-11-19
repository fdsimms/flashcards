import random
from typing import Any

from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.cram_themes import Seeds, ThemesFailed, WriteThemes
from franki_reader.engine import Engine
from franki_reader.generator import Usage

USED = Usage(input_tokens=900, output_tokens=700, model="claude-haiku-5-5")
BODY: dict[str, Any] = {
    "language": "fr",
    "words": [
        {"id": "a1", "text": "un café", "english": "a coffee", "kind": "carried"},
        {"id": "a2", "text": "la carte", "english": "the menu", "kind": "deck"},
    ],
}


def theme(title: str = "Ordering at a café") -> dict[str, Any]:
    return {
        "title": title,
        "why": "Uses words you haven't used yet.",
        "words": [0, 1],
        "new_words": [],
        "questions": [
            {"text": "Vous aimez le café ?", "english": "Do you like coffee?"},
            {"text": "Où allez-vous souvent ?", "english": "Where do you often go?"},
        ],
        "story": {"text": "Hier, j'ai pris un café.", "english": "Yesterday I had a coffee."},
    }


def client(
    answer: Any = None, asked: list[Seeds] | None = None, fail: bool = False, claude: bool = True
) -> tuple[TestClient, Any]:
    async def write(language: str, seeds: Seeds) -> tuple[Any, Usage]:
        if asked is not None:
            asked.append(seeds)
        if fail:
            raise ThemesFailed("Claude didn't answer. Try again in a moment.", USED)
        return answer if answer is not None else {"themes": [theme()]}, USED

    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    writer: WriteThemes | None = write if claude else None
    c = TestClient(create_app(engine, "open sesame", write_cram_themes=writer))
    c.__enter__()
    return c, conn


def test_suggests_themes_and_keeps_what_it_cost() -> None:
    c, conn = client()
    with c:
        r = c.post("/api/cram/themes", json=BODY, headers=AUTH)
        assert r.status_code == 200
        t = r.json()["themes"][0]
        assert t["title"] == "Ordering at a café"
        assert t["word_ids"] == ["a1", "a2"]
        assert t["story"]["english"] == "Yesterday I had a coffee."
        rows = conn.execute("SELECT feature, language FROM call_costs").fetchall()
        assert [tuple(row) for row in rows] == [("cram_themes", "fr")]
        costs = c.get("/api/costs", headers=AUTH).json()
        assert costs["cram_themes"]["asked"] == 1
        assert costs["cram_themes"]["cost_usd"] > 0


def test_sends_the_words_what_was_missed_and_what_is_taken() -> None:
    asked: list[Seeds] = []
    c, _ = client(asked=asked)
    with c:
        body = {
            **BODY,
            "weak_spots": ["Telling time: minutes:to"],
            "avoid": ["At the bank", "  At   the   park "],
            "stretch": True,
        }
        assert c.post("/api/cram/themes", json=body, headers=AUTH).status_code == 200
    seeds = asked[0]
    assert [(w.id, w.kind) for w in seeds.pool] == [("a1", "carried"), ("a2", "deck")]
    assert seeds.weak_spots == ("Telling time: minutes:to",)
    assert seeds.avoid == ("At the bank", "At the park")
    assert seeds.stretch is True


def test_a_failed_call_still_counts_what_it_cost() -> None:
    c, conn = client(fail=True)
    with c:
        r = c.post("/api/cram/themes", json=BODY, headers=AUTH)
        assert r.status_code == 503
        assert r.json()["detail"] == "Claude didn't answer. Try again in a moment."
        assert conn.execute("SELECT COUNT(*) FROM call_costs").fetchone()[0] == 1


def test_nothing_usable_is_a_503_with_a_reason() -> None:
    c, _ = client(answer={"themes": [{"title": "Empty"}]})
    with c:
        r = c.post("/api/cram/themes", json=BODY, headers=AUTH)
        assert r.status_code == 503
        assert r.json()["detail"] == "Claude had no new themes. Try again."


def test_without_claude_or_a_language_it_can_write_in_it_says_so() -> None:
    c, _ = client(claude=False)
    with c:
        assert c.post("/api/cram/themes", json=BODY, headers=AUTH).status_code == 503
    c, _ = client()
    with c:
        r = c.post("/api/cram/themes", json={**BODY, "language": "en"}, headers=AUTH)
        assert r.status_code == 422


def test_needs_the_passphrase_and_at_least_one_word() -> None:
    c, _ = client()
    with c:
        assert c.post("/api/cram/themes", json=BODY).status_code in (401, 403)
        assert (
            c.post("/api/cram/themes", json={**BODY, "words": []}, headers=AUTH).status_code == 422
        )
