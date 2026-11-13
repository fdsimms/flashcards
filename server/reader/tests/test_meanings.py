"""Meanings for the words nothing else glosses: which words are asked about, what is kept, and that a
tap then finds the meaning."""

import asyncio
import random
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_app import AUTH, started
from test_generator import FakeClient, finish, response

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.coverage import check
from franki_reader.engine import FAILURE_COOLDOWN, Engine
from franki_reader.generator import Generated, Line, Usage
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.meanings import (
    MeaningsFailed,
    claude_meanings,
    fill,
    missing,
    missing_in_sentences,
    request_message,
)
from franki_reader.reader import render

NOW = datetime(2026, 11, 13, 9, 0)
DECK = [Entry(1, "mat", "food", "mature")]
LINES = (
    Line("A", "Hei!|Vi|har|varm|mat|og|vann.", "Hi! We have warm food and water."),
    Line("B", "Varm|mat!", "Warm food!"),
)


class Writer:
    """Answers with a meaning for each word it is given, except those in `skip`."""

    def __init__(self, skip: tuple[str, ...] = (), fail: bool = False) -> None:
        self.skip = skip
        self.fail = fail
        self.asked: list[list[tuple[str, str]]] = []

    async def __call__(self, language: str, asked: list[tuple[str, str]]) -> Any:
        self.asked.append(list(asked))
        if self.fail:
            raise MeaningsFailed("down")
        words = [{"word": w, "meaning": f"meaning of {w}"} for w, _ in asked if w not in self.skip]
        return words, Usage(1_000_000, 0, 0, 0)  # $2


def stored_text(conn: Any, status: str = "ready") -> store.StoredText:
    lexicon = lexicon_from(DECK, "nb", 1000)
    coverage = check([ln.text for ln in LINES], lexicon)
    generated = Generated("t", LINES, {"vann": "water"}, coverage, 1, True, ())
    topic = store.add_topic(conn, "Food", True, NOW)
    text_id = store.save_text(conn, topic.id, generated, [], 0.95, NOW, status, "dialogue", "nb")
    text = store.get_text(conn, text_id)
    assert text is not None
    return text


def test_a_word_with_no_gloss_is_asked_about_once_with_a_line_it_is_in() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)
    asked = missing([text], lexicon, {"mat": "food"})
    # Not mat (the deck's) or vann (the text's), and varm once even though it's in two lines and
    # capitalized in one.
    assert [w for w, _ in asked if w in ("varm", "mat", "vann")] == ["varm"]
    assert dict(asked)["varm"] == "Hi! We have warm food and water."
    assert "hei" in dict(asked)


def test_the_request_gives_each_word_and_its_line() -> None:
    message = request_message("nb", [("varm", "Warm food!")])
    assert "varm | Warm food!" in message


def test_fill_keeps_the_meanings_and_the_cost_and_never_asks_again() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)
    writer = Writer(skip=("hei",))

    def run() -> int:
        return asyncio.run(
            fill(conn, writer, "nb", [text], lexicon, store.word_meanings(conn, "nb"), lambda: NOW)
        )

    assert run() > 0
    kept = store.word_meanings(conn, "nb")
    assert kept["varm"] == "meaning of varm"
    assert kept["hei"] == ""  # no answer: kept empty so it isn't asked for again
    assert store.meaning_spending(conn, NOW - timedelta(days=1)) == {"nb": (1, 2.0)}
    assert run() == 0
    assert len(writer.asked) == 1


def test_a_meaning_that_is_unusable_is_kept_empty_and_an_em_dash_is_replaced() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)

    async def write(language: str, asked: list[tuple[str, str]]) -> Any:
        return [
            {"word": "Varm", "meaning": "warm — hot"},
            {"word": "hei", "meaning": "x" * 80},
            {"word": "notasked", "meaning": "nope"},
            "garbage",
        ], Usage(0, 0, 0, 0)

    asyncio.run(fill(conn, write, "nb", [text], lexicon, {}, lambda: NOW))
    kept = store.word_meanings(conn, "nb")
    assert kept["varm"] == "warm, hot" and kept["hei"] == "" and "notasked" not in kept


def test_a_tap_finds_the_kept_meaning_but_the_decks_and_the_texts_win() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)
    words = render(text, lexicon, {"varm": "warm", "mat": "food", "vann": "kept"})
    glosses = {w["text"]: w["gloss"] for line in words["lines"] for w in line["words"]}
    assert glosses["varm"] == "warm" and glosses["Varm"] == "warm"  # also at a sentence start
    assert glosses["mat"] == "food"  # the deck
    assert glosses["vann"] == "water"  # the text's own


def test_the_engine_fills_texts_and_waits_after_a_failure() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    text = stored_text(conn)
    now = [NOW]
    writer = Writer(fail=True)
    engine = Engine(conn, None, None, lambda: now[0], random.Random(1), write_meanings=writer)

    asyncio.run(engine.fill_meanings([text], "nb"))
    assert len(writer.asked) == 1 and store.word_meanings(conn, "nb") == {}
    asyncio.run(engine.fill_meanings([text], "nb"))
    assert len(writer.asked) == 1  # cooling down

    now[0] += FAILURE_COOLDOWN
    writer.fail = False
    asyncio.run(engine.fill_meanings([text], "nb"))
    assert engine.meanings("nb")["varm"] == "meaning of varm"
    assert engine.meanings("nb")["mat"] == "food"  # the deck's meaning wins


def test_without_a_writer_nothing_is_asked() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1))
    asyncio.run(engine.fill_meanings([text], "nb"))
    assert store.word_meanings(conn, "nb") == {}


def test_a_pass_fills_texts_already_read_and_the_cost_is_reported() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    stored_text(conn, status="read")
    writer = Writer()
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_meanings=writer)
    c: TestClient = started(create_app(engine, "open sesame"))
    asyncio.run(engine.fill_meanings(store.recent_texts(conn, "nb", 30), "nb"))
    costs = c.get("/api/costs", headers=AUTH).json()["meanings"]
    assert costs["batches"] == 1 and costs["languages"][0]["language"] == "nb"


# ==== A failed call's cost ====

BILLED = Usage(1_000_000, 0, 0, 0)  # $2


def test_a_failed_call_keeps_its_cost_and_its_words_are_asked_again() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)

    async def refused(language: str, asked: list[tuple[str, str]]) -> Any:
        raise MeaningsFailed("No meanings (refusal)", BILLED)

    with pytest.raises(MeaningsFailed):
        asyncio.run(fill(conn, refused, "nb", [text], lexicon, {}, lambda: NOW))
    assert store.word_meanings(conn, "nb") == {}  # no word marked as asked
    assert store.meaning_spending(conn, NOW - timedelta(days=1)) == {"nb": (1, 2.0)}

    writer = Writer()
    asyncio.run(fill(conn, writer, "nb", [text], lexicon, {}, lambda: NOW))
    assert "varm" in dict(writer.asked[0])  # asked again
    assert store.word_meanings(conn, "nb")["varm"] == "meaning of varm"
    assert store.meaning_spending(conn, NOW - timedelta(days=1)) == {"nb": (2, 4.0)}


def test_a_call_claude_never_answered_costs_nothing() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)
    with pytest.raises(MeaningsFailed):
        asyncio.run(fill(conn, Writer(fail=True), "nb", [text], lexicon, {}, lambda: NOW))
    assert store.meaning_spending(conn, NOW - timedelta(days=1)) == {}


def test_a_failing_pass_shows_its_cost_in_the_costs() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    text = stored_text(conn)

    async def cut_off(language: str, asked: list[tuple[str, str]]) -> Any:
        raise MeaningsFailed("No meanings (max_tokens)", BILLED)

    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_meanings=cut_off)
    c: TestClient = started(create_app(engine, "open sesame"))
    asyncio.run(engine.fill_meanings([text], "nb"))
    costs = c.get("/api/costs", headers=AUTH).json()["meanings"]
    assert costs["batches"] == 1 and costs["cost_usd"] == 2.0


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [("refusal", None), ("max_tokens", '{"words"'), ("end_turn", None), ("end_turn", "not json")],
)
def test_claude_meanings_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    write = claude_meanings(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(MeaningsFailed) as failed:
        finish(write("nb", [("varm", "Warm food!")]))
    assert failed.value.usage.output_tokens == 900  # the call is still paid for


def test_a_cards_sentence_asks_about_the_words_nothing_glosses_with_its_english() -> None:
    lexicon = lexicon_from(DECK, "nb", 1000)
    asked = missing_in_sentences(
        [("Varm mat!", "Warm food!"), ("Mat og vann.", "Food and water.")],
        lexicon,
        {"mat": "food", "vann": "water"},
    )
    assert dict(asked) == {"varm": "Warm food!", "og": "Food and water."}


def test_the_engine_fills_card_sentences_and_shares_the_cooldown_with_texts() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    writer = Writer(fail=True)
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_meanings=writer)

    asyncio.run(engine.fill_meanings([stored_text(conn)], "nb"))
    asyncio.run(engine.fill_sentence_meanings([("Varm suppe.", "Warm soup.")], "nb"))
    assert len(writer.asked) == 1  # cooling down after the texts' pass failed

    writer.fail = False
    engine._meanings_failed.clear()
    asyncio.run(engine.fill_sentence_meanings([("Varm suppe.", "Warm soup.")], "nb"))
    assert engine.meanings("nb")["suppe"] == "meaning of suppe"
