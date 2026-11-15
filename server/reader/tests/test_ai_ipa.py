"""IPA Claude writes for the words Wiktionary's tables have none for (ai_ipa.py): which words are
asked about, how an answer is checked and kept, what a failed call costs, and that the reader shows
what was written labeled as AI's."""

import asyncio
import random
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_app import AUTH, started
from test_generator import FakeClient, finish, response

from franki_reader import ai_ipa, store
from franki_reader.ai_ipa import IpaFailed, claude_ipa, fill, missing, request_message
from franki_reader.app import create_app
from franki_reader.coverage import check
from franki_reader.engine import FAILURE_COOLDOWN, Engine
from franki_reader.generator import Generated, Line, Usage
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.reader import render

NOW = datetime(2026, 11, 15, 9, 0)
DECK = [Entry(1, "el pan", "bread", "mature")]
# carenaje has no entry in the Spanish table; every other word here has.
LINES = (
    Line("A", "El|carenaje|está|roto.", "The fairing is broken."),
    Line("B", "El|carenaje|no|está|roto.", "The fairing is not broken."),
)
BILLED = Usage(1_000_000, 0, 0, 0)  # $2


class Writer:
    """Answers with IPA for each word it is given, numbered as asked, except those in `skip`."""

    def __init__(self, skip: tuple[str, ...] = (), fail: bool = False, ipa: str = "/ka/") -> None:
        self.skip, self.fail, self.ipa = skip, fail, ipa
        self.asked: list[list[tuple[str, str]]] = []

    async def __call__(self, language: str, asked: list[tuple[str, str]]) -> Any:
        self.asked.append(list(asked))
        if self.fail:
            raise IpaFailed("down")
        words = [
            {"n": n, "word": w, "ipa": self.ipa}
            for n, (w, _) in enumerate(asked, 1)
            if w not in self.skip
        ]
        return words, BILLED


def stored_text(conn: Any, lines: tuple[Line, ...] = LINES, language: str = "es") -> Any:
    lexicon = lexicon_from(DECK, language, 1000)  # type: ignore[arg-type]
    coverage = check([ln.text for ln in lines], lexicon)
    generated = Generated("t", lines, {}, coverage, 1, True, ())
    topic = store.add_topic(conn, f"Topic {len(store.topic_names(conn))}", NOW)
    text_id = store.save_text(
        conn,
        topic.id,
        generated,
        [],
        0.95,
        NOW,
        "ready",
        "dialogue",
        language,  # type: ignore[arg-type]
    )
    text = store.get_text(conn, text_id)
    assert text is not None
    return text


def test_only_a_word_with_no_table_ipa_is_asked_about_once_with_its_line() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "es", 1000)
    asked = missing([text], lexicon, {})
    assert [(w.word, w.line) for w in asked] == [("carenaje", "El|carenaje|está|roto.")]


def test_a_word_already_asked_about_is_not_asked_again_even_with_no_answer() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "es", 1000)
    assert missing([text], lexicon, {"carenaje": ""}) == []


def test_a_language_with_no_table_asks_for_nothing() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn, language="en")
    assert missing([text], lexicon_from([], "en", 1000), {}) == []


def test_the_request_numbers_each_word_with_its_line_in_the_languages_style() -> None:
    message = request_message("ru", [("доме", "Мы|говорили|о|доме.")])
    assert "1. доме | Мы|говорили|о|доме." in message
    assert "[ˈdomʲɪ]" in message


def test_fill_keeps_what_is_written_and_costs_once() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "es", 1000)
    writer = Writer(ipa="kaɾeˈnaxe")  # no slashes: they're added

    written = asyncio.run(fill(conn, writer, "es", missing([text], lexicon, {}), lambda: NOW))

    assert written == {"carenaje": "/kaɾeˈnaxe/"}
    assert store.word_ipa(conn, "es") == written
    assert store.ipa_spending(conn, NOW - timedelta(days=1)) == {"es": (1, 2.0)}
    # Kept, so the next pass finds nothing to ask.
    assert missing([text], lexicon, store.word_ipa(conn, "es")) == []


def test_an_answer_is_placed_by_its_number_and_checked() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "es", 1000)
    wanted = missing([text], lexicon, {})

    async def write(language: str, words: list[tuple[str, str]]) -> Any:
        return [{"n": 1, "word": "Carenaje", "ipa": "/ka re/"}], Usage(0, 0, 0, 0)  # a space

    asyncio.run(fill(conn, write, "es", wanted, lambda: NOW))
    assert store.word_ipa(conn, "es") == {"carenaje": ""}  # unusable: kept empty, not asked again

    async def wrong_word(language: str, words: list[tuple[str, str]]) -> Any:
        return [
            {"n": 1, "word": "otra", "ipa": "/x/"},  # the wrong word for its number
            {"n": 9, "word": "carenaje", "ipa": "/x/"},  # no such number
            {"word": "carenaje", "ipa": "/x/"},  # no number
            "garbage",
        ], Usage(0, 0, 0, 0)

    conn2 = store.connect(":memory:")
    asyncio.run(fill(conn2, wrong_word, "es", wanted, lambda: NOW))
    assert store.word_ipa(conn2, "es") == {"carenaje": ""}


@pytest.mark.parametrize(
    ("value", "kept"),
    [
        ("/kaɾeˈnaxe/", "/kaɾeˈnaxe/"),
        ("[ˈdomʲɪ]", "[ˈdomʲɪ]"),
        ("kaɾeˈnaxe", "/kaɾeˈnaxe/"),
        ("", ""),
        ("//", ""),
        ("/ka re/", ""),
        ("/ka|re/", ""),
        ("/k4/", ""),
        ("/" + "a" * 80 + "/", ""),
        (None, ""),
    ],
)
def test_an_ipa_is_kept_only_when_usable(value: object, kept: str) -> None:
    assert ai_ipa._clean(value) == kept


def test_a_failed_call_keeps_its_cost_and_its_words_are_asked_again() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    lexicon = lexicon_from(DECK, "es", 1000)
    wanted = missing([text], lexicon, {})

    async def refused(language: str, asked: list[tuple[str, str]]) -> Any:
        raise IpaFailed("No IPA (refusal)", BILLED)

    with pytest.raises(IpaFailed):
        asyncio.run(fill(conn, refused, "es", wanted, lambda: NOW))
    assert store.word_ipa(conn, "es") == {}  # no word marked as asked
    assert store.ipa_spending(conn, NOW - timedelta(days=1)) == {"es": (1, 2.0)}

    with pytest.raises(IpaFailed):  # a call Claude never answered costs nothing
        asyncio.run(fill(conn, Writer(fail=True), "es", wanted, lambda: NOW))
    assert store.ipa_spending(conn, NOW - timedelta(days=1)) == {"es": (1, 2.0)}


def test_the_engine_fills_and_waits_after_a_failure_then_the_reader_shows_it_as_ai() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "es")
    text = stored_text(conn)
    now = [NOW]
    writer = Writer(fail=True)
    engine = Engine(conn, None, None, lambda: now[0], random.Random(1), write_ipa=writer)

    asyncio.run(engine.fill_ipa([text], "es"))
    asyncio.run(engine.fill_ipa([text], "es"))
    assert len(writer.asked) == 1  # cooling down
    assert engine.ai_ipa("es") == {}

    now[0] += FAILURE_COOLDOWN
    writer.fail, writer.ipa = False, "/kaɾeˈnaxe/"
    asyncio.run(engine.fill_ipa([text], "es"))
    assert engine.ai_ipa("es") == {"carenaje": "/kaɾeˈnaxe/"}

    lexicon = lexicon_from(DECK, "es", 1000)
    words = [
        w
        for ln in render(text, lexicon, {}, ai_ipa=engine.ai_ipa("es"))["lines"]
        for w in ln["words"]
    ]
    by_text = {w["text"]: w for w in words}
    assert (by_text["carenaje"]["ipa"], by_text["carenaje"]["ipa_source"]) == ("/kaɾeˈnaxe/", "ai")
    # Wiktionary's wins wherever it has the word, whatever the AI wrote.
    assert by_text["está"]["ipa_source"] == "wiktionary"
    assert (
        render(text, lexicon, {})["lines"][0]["words"][1]["ipa"] is None
    )  # nothing written, none shown


def test_the_table_beats_what_claude_wrote_for_the_same_word() -> None:
    lexicon = lexicon_from(DECK, "es", 1000)
    from franki_reader.ipa import ipa_for

    assert ipa_for("está", lexicon, None, {"está": "/wrong/"}) == (
        ipa_for("está", lexicon)[0],  # type: ignore[index]
        "wiktionary",
    )


def test_without_a_writer_nothing_is_asked() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1))
    asyncio.run(engine.fill_ipa([text], "es"))
    assert store.word_ipa(conn, "es") == {}


def test_the_costs_report_the_ipa_calls() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "es")
    text = stored_text(conn)
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_ipa=Writer())
    c: TestClient = started(create_app(engine, "open sesame"))
    asyncio.run(engine.fill_ipa([text], "es"))
    costs = c.get("/api/costs", headers=AUTH).json()["ipa"]
    assert costs["batches"] == 1 and costs["cost_usd"] == 2.0


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [("refusal", None), ("max_tokens", '{"words"'), ("end_turn", None), ("end_turn", "not json")],
)
def test_claude_ipa_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    write = claude_ipa(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(IpaFailed) as failed:
        finish(write("es", [("carenaje", "El carenaje.")]))
    assert failed.value.usage.output_tokens == 900  # the call is still paid for
