"""Meanings for the words nothing else glosses: which words are asked about, what is kept, and that a
tap then finds the meaning."""

import asyncio
import random
from datetime import datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from test_app import AUTH, started

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.coverage import check
from franki_reader.engine import FAILURE_COOLDOWN, Engine
from franki_reader.generator import Generated, Line, Usage
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.meanings import MeaningsFailed, fill, missing, request_message
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
