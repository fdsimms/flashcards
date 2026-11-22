import asyncio
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
from franki_reader.cram_phrases import (
    MAX_PHRASES_ASKED,
    PhraseSeeds,
    claude_phrases,
    request_message,
    suggest_phrases,
    unknown_words,
)
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.lesson_words import Candidate, LessonWordsFailed

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
BODY = {"language": "th", "topic": "the 5k race", "words": [{"text": "วิ่ง", "english": "to run"}]}


class Spaced:
    """A checker for Latin text cut at spaces: the words in `known` are known."""

    known: frozenset[str] = frozenset()
    spaced = True

    def __init__(self, known: set[str]) -> None:
        self._known = known

    def segment(self, text: str) -> list[str]:
        return text.split()

    def status(self, token: str) -> str:
        return "known" if token in self._known else "unknown"

    def known_pieces(self, token: str) -> list[str] | None:
        return None

    def entry_of(self, token: str) -> str | None:
        return None


def written(*texts: str) -> Any:
    async def write(language: str, seeds: PhraseSeeds) -> tuple[list[Candidate], Usage]:
        return [Candidate(t, "", "x") for t in texts], COST

    return write


def client(write: Any = None) -> tuple[TestClient, Any]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: datetime(2026, 10, 19, 9),
        random.Random(1),
    )
    app = create_app(engine, "open sesame", None, write_cram_phrases=write)
    return started(app), conn


def costs(conn: Any) -> list[tuple[str, str]]:
    return [tuple(r) for r in conn.execute("SELECT feature, language FROM call_costs")]


def test_the_message_names_the_topic_the_words_and_what_is_taken() -> None:
    message = request_message(
        PhraseSeeds("the 5k race", "I ran 5 km", "how it felt", (("วิ่ง", "to run"),), ("ซ้อม",))
    )
    for part in ("the 5k race", "I ran 5 km", "how it felt", "วิ่ง (to run)", "- ซ้อม"):
        assert part in message


def test_asks_haiku_in_the_learners_gender_and_register() -> None:
    reply = {"candidates": [{"text": "ผมวิ่งแข่ง", "reading": "x", "english": "I ran a race"}]}
    fake = FakeClient(response("end_turn", json.dumps(reply)))
    found, used = finish(
        claude_phrases(fake)("th", PhraseSeeds(topic="the race"))  # type: ignore[arg-type]
    )
    assert [c.text for c in found] == ["ผมวิ่งแข่ง"]
    assert used.cost_usd() > 0
    call = fake.calls[0]
    assert call["model"] == "claude-haiku-5-5"
    assert f"{MAX_PHRASES_ASKED} short phrases" in call["system"]
    assert "ผม" in call["system"]


@pytest.mark.parametrize("stop,text", [("refusal", "{}"), ("max_tokens", "{}"), ("end_turn", "no")])
def test_an_answer_that_cannot_be_used_fails_with_what_it_cost(stop: str, text: str) -> None:
    fake = FakeClient(response(stop, text))
    with pytest.raises(LessonWordsFailed) as e:
        finish(claude_phrases(fake)("th", PhraseSeeds()))  # type: ignore[arg-type]
    assert e.value.usage.cost_usd() > 0


def test_unknown_words_leave_out_the_crams_own_words() -> None:
    checker = Spaced({"je", "vais"})
    assert unknown_words("je vais courir vite", checker, {"courir"}) == ["vite"]  # type: ignore[arg-type]


def test_phrases_with_too_many_unknown_words_and_taken_ones_are_dropped_fewest_first() -> None:
    checker = Spaced({"je", "vais", "au"})
    seeds = PhraseSeeds(words=(("marché", "market"),), exclude=("je vais au marché",))
    write = written(
        "je vais au marché", "je vais au parc", "je vais courir vite loin", "je vais au marché"
    )
    found, _ = asyncio.run(suggest_phrases(write, "fr", seeds, checker))  # type: ignore[arg-type]
    assert [c.text for c in found] == ["je vais au parc"]


def test_thai_in_the_other_gender_is_dropped() -> None:
    seeds = PhraseSeeds(learner="male")
    found, _ = asyncio.run(suggest_phrases(written("ผมวิ่งครับ", "ดิฉันวิ่งค่ะ"), "th", seeds))
    assert [c.text for c in found] == ["ผมวิ่งครับ"]


def test_the_route_returns_the_phrases_and_keeps_the_cost() -> None:
    seen: list[Any] = []

    async def write(language: str, seeds: PhraseSeeds) -> tuple[list[Candidate], Usage]:
        seen.append((language, seeds))
        return [Candidate("ผมวิ่ง", "pǒm wîng", "I run")], COST

    c, conn = client(write)
    answer = c.post(
        "/api/cram/phrases",
        json={**BODY, "exclude": [" ซ้อม ", "ซ้อม"], "particle": "khrap"},
        headers=AUTH,
    )
    assert answer.status_code == 200
    assert answer.json() == {
        "phrases": [{"text": "ผมวิ่ง", "reading": "pǒm wîng", "english": "I run"}]
    }
    language, sent = seen[0]
    assert language == "th"
    assert sent.topic == "the 5k race"
    assert sent.words == (("วิ่ง", "to run"),)
    assert sent.exclude == ("ซ้อม",)
    assert sent.learner == "male"
    assert costs(conn) == [("cram_phrases", "th")]


def test_english_is_refused_without_asking_claude() -> None:
    async def write(*args: Any) -> tuple[list[Candidate], Usage]:
        raise AssertionError("asked")

    c, conn = client(write)
    answer = c.post("/api/cram/phrases", json={**BODY, "language": "en"}, headers=AUTH)
    assert answer.status_code == 422
    assert costs(conn) == []


def test_a_failed_call_that_was_billed_is_kept_and_503() -> None:
    async def write(*args: Any) -> tuple[list[Candidate], Usage]:
        raise LessonWordsFailed("Claude didn't suggest any phrases. Try again.", COST)

    c, conn = client(write)
    answer = c.post("/api/cram/phrases", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert costs(conn) == [("cram_phrases", "th")]


def test_without_claude_it_says_how_to_turn_it_on() -> None:
    c, _ = client(None)
    answer = c.post("/api/cram/phrases", json=BODY, headers=AUTH)
    assert answer.status_code == 503
    assert "ANTHROPIC_API_KEY" in answer.json()["detail"]
