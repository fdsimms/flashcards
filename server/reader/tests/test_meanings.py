"""Meanings for the words nothing else glosses: which words are asked about, what is kept with each
text and for the language, and that a tap then finds the meaning the word has in its own text."""

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
from franki_reader.languages import Code
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.meanings import (
    MeaningsFailed,
    Wanted,
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
SPANISH = [Entry(1, "el pan", "bread", "mature")]
CAME = (Line("A", "Él|vino|tarde.", "He came late."),)
WINE = (Line("A", "Un|vino|tinto.", "A red wine."),)
SENSES = {("vino", "He came late."): "came", ("vino", "A red wine."): "wine"}


class Writer:
    """Answers with a meaning for each word it is given, numbered as asked, except those in `skip`.
    `senses` gives a word its meaning by the English of its line."""

    def __init__(
        self,
        skip: tuple[str, ...] = (),
        fail: bool = False,
        senses: dict[tuple[str, str], str] | None = None,
    ) -> None:
        self.skip = skip
        self.fail = fail
        self.senses = senses or {}
        self.asked: list[list[tuple[str, str]]] = []

    async def __call__(self, language: str, asked: list[tuple[str, str]]) -> Any:
        self.asked.append(list(asked))
        if self.fail:
            raise MeaningsFailed("down")
        words = [
            {"n": n, "word": w, "meaning": self.senses.get((w, english), f"meaning of {w}")}
            for n, (w, english) in enumerate(asked, 1)
            if w not in self.skip
        ]
        return words, Usage(1_000_000, 0, 0, 0)  # $2


def stored_text(
    conn: Any,
    status: str = "ready",
    lines: tuple[Line, ...] = LINES,
    language: Code = "nb",
    deck: list[Entry] = DECK,
) -> store.StoredText:
    lexicon = lexicon_from(deck, language, 1000)
    coverage = check([ln.text for ln in lines], lexicon)
    generated = Generated("t", lines, {"vann": "water"}, coverage, 1, True, ())
    topic = store.add_topic(conn, f"Food {len(store.topic_names(conn))}", True, NOW)
    text_id = store.save_text(
        conn, topic.id, generated, [], 0.95, NOW, status, "dialogue", language
    )
    return now_stored(conn, text_id)


def now_stored(conn: Any, text_id: int) -> store.StoredText:
    text = store.get_text(conn, text_id)
    assert text is not None
    return text


def words_of(asked: list[Wanted]) -> dict[str, str]:
    return {w.word: w.english for w in asked}


def test_a_word_with_no_gloss_is_asked_about_once_with_a_line_it_is_in() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)
    asked = missing([text], lexicon, {"mat": "food"})
    # Not mat (the deck's) or vann (the text's), and varm once even though it's in two lines and
    # capitalized in one.
    assert [w.word for w in asked if w.word in ("varm", "mat", "vann")] == ["varm"]
    assert words_of(asked)["varm"] == "Hi! We have warm food and water."
    assert "hei" in words_of(asked)
    assert {w.text_id for w in asked} == {text.id}


def test_the_request_numbers_each_word_with_its_line() -> None:
    message = request_message("nb", [("varm", "Warm food!"), ("varm", "A warm day.")])
    assert "1. varm | Warm food!" in message and "2. varm | A warm day." in message


def test_fill_keeps_the_meanings_with_the_text_and_that_text_never_asks_again() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)
    writer = Writer(skip=("hei",))

    def run() -> int:
        fresh = now_stored(conn, text.id)
        return asyncio.run(fill(conn, writer, "nb", [fresh], lexicon, {"mat": "food"}, lambda: NOW))

    assert run() > 0
    own = now_stored(conn, text.id).meanings
    assert own["varm"] == "meaning of varm"
    assert own["hei"] == ""  # no answer: kept empty so this text doesn't ask for it again
    # The language keeps them too, as the fallback for a text with none of its own.
    assert store.word_meanings(conn, "nb")["varm"] == "meaning of varm"
    assert store.meaning_spending(conn, NOW - timedelta(days=1)) == {"nb": (1, 2.0)}
    assert run() == 0
    assert len(writer.asked) == 1


def test_a_word_glossed_for_one_text_is_asked_again_for_the_next_in_its_own_sense() -> None:
    conn = store.connect(":memory:")
    lexicon = lexicon_from(SPANISH, "es", 1000)
    came = stored_text(conn, lines=CAME, language="es", deck=SPANISH)
    wine = stored_text(conn, lines=WINE, language="es", deck=SPANISH)
    writer = Writer(senses=SENSES)

    asyncio.run(fill(conn, writer, "es", [came], lexicon, {}, lambda: NOW))
    asyncio.run(fill(conn, writer, "es", [wine], lexicon, {}, lambda: NOW))

    assert ("vino", "A red wine.") in writer.asked[1]  # asked again, though the language has one
    kept = store.word_meanings(conn, "es")
    assert kept["vino"] == "came"  # the language keeps the first, only as a fallback
    for text_id, sense in ((came.id, "came"), (wine.id, "wine")):
        text = now_stored(conn, text_id)
        assert text.meanings["vino"] == sense
        words = [w for ln in render(text, lexicon, kept)["lines"] for w in ln["words"]]
        assert next(w["gloss"] for w in words if w["text"] == "vino") == sense


def test_one_call_asks_about_a_word_in_two_texts_and_keeps_each_ones_sense() -> None:
    conn = store.connect(":memory:")
    lexicon = lexicon_from(SPANISH, "es", 1000)
    came = stored_text(conn, lines=CAME, language="es", deck=SPANISH)
    wine = stored_text(conn, lines=WINE, language="es", deck=SPANISH)
    writer = Writer(senses=SENSES)

    asyncio.run(fill(conn, writer, "es", [came, wine], lexicon, {}, lambda: NOW))

    assert len(writer.asked) == 1
    assert [w for w, _ in writer.asked[0]].count("vino") == 2
    assert now_stored(conn, came.id).meanings["vino"] == "came"
    assert now_stored(conn, wine.id).meanings["vino"] == "wine"


def test_an_answer_is_placed_by_its_number_and_must_match_its_word() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)
    n = {w.word: i for i, w in enumerate(missing([text], lexicon, {"mat": "food"}), 1)}

    async def write(language: str, words: list[tuple[str, str]]) -> Any:
        return [
            {"n": n["varm"], "word": "Varm", "meaning": "warm — hot"},
            {"n": n["hei"], "word": "og", "meaning": "and"},  # the wrong word for its number
            {"n": 99, "word": "og", "meaning": "and"},  # no such number
            {"word": "vi", "meaning": "we"},  # no number
            "garbage",
        ], Usage(0, 0, 0, 0)

    asyncio.run(fill(conn, write, "nb", [text], lexicon, {"mat": "food"}, lambda: NOW))
    own = now_stored(conn, text.id).meanings
    assert own["varm"] == "warm, hot"  # and an em dash is replaced
    assert own["hei"] == own["og"] == own["vi"] == ""


def test_a_meaning_that_is_unusable_is_kept_empty() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)
    writer = Writer(senses={("hei", "Hi! We have warm food and water."): "x" * 80})
    asyncio.run(fill(conn, writer, "nb", [text], lexicon, {}, lambda: NOW))
    assert now_stored(conn, text.id).meanings["hei"] == ""
    assert store.word_meanings(conn, "nb")["hei"] == ""


def test_a_tap_finds_the_texts_own_meaning_then_the_decks_then_the_languages() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "nb", 1000)
    kept = {"varm": "warm", "mat": "food", "vann": "kept", "og": "and (kept)", "hei": "hello"}
    store.save_meaning_batch(conn, "nb", {}, NOW, 0, {text.id: {"og": "and", "hei": ""}})
    words = render(now_stored(conn, text.id), lexicon, kept)
    glosses = {w["text"]: w["gloss"] for line in words["lines"] for w in line["words"]}
    assert glosses["varm"] == "warm" and glosses["Varm"] == "warm"  # also at a sentence start
    assert glosses["mat"] == "food"  # the deck
    assert glosses["vann"] == "water"  # the text's own, from the model
    assert glosses["og"] == "and"  # the text's own, asked for it
    assert glosses["Hei"] == "hello"  # asked, with no answer: the language's fallback


def test_a_thai_compound_known_by_its_parts_is_asked_for_its_own_meaning() -> None:
    conn = store.connect(":memory:")
    deck = [Entry(1, "ฉัน", "I", "mature"), Entry(2, "เข้า", "to enter", "mature")]
    deck.append(Entry(3, "ใจ", "heart", "mature"))
    lexicon = lexicon_from(deck, "th")
    lines = (Line("A", "ฉัน|เข้าใจ", "I understand."),)
    text = stored_text(conn, lines=lines, language="th", deck=deck)
    meanings = {e.text: e.meaning for e in deck}
    writer = Writer(senses={("เข้าใจ", "I understand."): "to understand"})

    asyncio.run(fill(conn, writer, "th", [text], lexicon, meanings, lambda: NOW))

    assert writer.asked == [[("เข้าใจ", "I understand.")]]
    word = render(now_stored(conn, text.id), lexicon, meanings)["lines"][0]["words"][1]
    assert (word["gloss"], word["parts"]) == ("to understand", None)


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
    assert now_stored(conn, text.id).meanings["varm"] == "meaning of varm"
    assert engine.meanings("nb")["varm"] == "meaning of varm"
    assert engine.meanings("nb")["mat"] == "food"  # the deck's meaning wins
    asked = [w for w, _ in writer.asked[-1]]
    assert "mat" not in asked and "vann" not in asked  # the deck's, and the text's own

    # A pass handed the text as it was before the last one filled it still finds it filled.
    asyncio.run(engine.fill_meanings([text], "nb"))
    assert len(writer.asked) == 2


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
    assert now_stored(conn, text.id).meanings == {}
    assert store.meaning_spending(conn, NOW - timedelta(days=1)) == {"nb": (1, 2.0)}

    writer = Writer()
    asyncio.run(fill(conn, writer, "nb", [now_stored(conn, text.id)], lexicon, {}, lambda: NOW))
    assert "varm" in dict(writer.asked[0])  # asked again
    assert now_stored(conn, text.id).meanings["varm"] == "meaning of varm"
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
    assert asked == [Wanted("varm", "Warm food!"), Wanted("og", "Food and water.")]


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
