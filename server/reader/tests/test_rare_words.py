import random
import sqlite3
from collections.abc import Sequence
from datetime import datetime

from fastapi.testclient import TestClient
from test_app import AUTH, started

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.languages import Code
from franki_reader.lexicon import Entry
from franki_reader.rare_words import REFILL_BELOW, RareWord, RareWordsFailed, clean
from franki_reader.store import Settings
from franki_reader.word_suggestions import excluded

NOW = datetime(2026, 11, 19, 9, 0)
DECK = [
    Entry(1, "velleity", "a faint wish", "mature"),
    Entry(2, "kenosis", "self-emptying", "young"),
]


def connect() -> sqlite3.Connection:
    conn = store.connect(":memory:")
    store.save_settings(conn, Settings(language="en", common={"en": 5000}))
    store.save_snapshot(conn, DECK, NOW, "en")
    return conn


def test_clean_keeps_only_rare_single_new_words() -> None:
    skip = excluded("en", DECK, [], ["acedia"])
    words = [
        RareWord("Perspicacious", "keen in judgment"),  # kept, lowercased
        RareWord("kidnap", "to abduct"),  # on the common list: a native speaker knows it
        RareWord("velleity", "a faint wish"),  # in the deck
        RareWord("acedia", "spiritual sloth"),  # queued or dismissed
        RareWord("perspicacious", "again"),  # twice
        RareWord("sine qua non", "essential"),  # a phrase
        RareWord("Zeitgeist", ""),  # no meaning
        RareWord("ab", "too short to be a word worth adding"),
        RareWord("tenebrous", "dark"),
    ]
    got = clean(words, "en", skip, ["tenebrous"])
    assert [w.word for w in got] == ["perspicacious"]


def routes(conn: sqlite3.Connection, calls: list[list[str]], fail: bool = False) -> TestClient:
    async def write(
        language: Code, entries: Sequence[Entry], avoid: Sequence[str]
    ) -> tuple[list[RareWord], Usage]:
        calls.append(list(avoid))
        if fail:
            raise RareWordsFailed("Claude didn't answer (APIError). Try again in a moment.")
        n = len(calls) * 100
        # Thirty words each time, so one call fills the list past the refill line.
        words = [
            RareWord(f"{chr(97 + i // 26)}{chr(97 + i % 26)}zq{'x' * (n // 100)}", "m")
            for i in range(30)
        ]
        return words + [RareWord("kidnap", "to abduct")], Usage()

    engine = Engine(conn, None, None, lambda: NOW, random.Random(1))
    return started(create_app(engine, "open sesame", write_rare_words=write))


def test_english_gets_written_words_not_common_ones_and_asks_once() -> None:
    conn = connect()
    calls: list[list[str]] = []
    c = routes(conn, calls)
    got = c.get("/api/word-suggestions", params={"language": "en"}, headers=AUTH).json()
    assert got["common"] == [] and got["written_error"] == ""
    assert len(got["written"]) == 30 and "kidnap" not in {w["word"] for w in got["written"]}
    assert got["written"][0]["meaning"] == "m" and got["written"][0]["rank"] is None
    again = c.get("/api/word-suggestions", params={"language": "en"}, headers=AUTH).json()
    assert again["written"] == got["written"] and len(calls) == 1  # kept, not asked again


def test_a_dismissed_word_is_dropped_and_not_asked_for_again_until_the_list_runs_short() -> None:
    conn = connect()
    calls: list[list[str]] = []
    c = routes(conn, calls)
    first = c.get("/api/word-suggestions", params={"language": "en"}, headers=AUTH).json()[
        "written"
    ]
    for w in first[: 30 - REFILL_BELOW + 1]:  # leaves one fewer than the refill line
        c.post(
            "/api/word-suggestions/dismiss",
            json={"language": "en", "word": w["word"]},
            headers=AUTH,
        )
    after = c.get("/api/word-suggestions", params={"language": "en"}, headers=AUTH).json()[
        "written"
    ]
    assert len(calls) == 2 and first[0]["word"] in calls[1]  # a dismissal is told not to repeat
    assert first[0]["word"] not in {w["word"] for w in after}
    assert len(after) > REFILL_BELOW - 1


def test_a_failed_call_is_said_and_costs_nothing_unanswered() -> None:
    conn = connect()
    c = routes(conn, [], fail=True)
    got = c.get("/api/word-suggestions", params={"language": "en"}, headers=AUTH).json()
    assert got["written"] == [] and "didn't answer" in got["written_error"]


def test_no_claude_says_so_and_other_languages_have_no_written_words() -> None:
    conn = connect()
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))
    got = c.get("/api/word-suggestions", params={"language": "en"}, headers=AUTH).json()
    assert got["written"] == [] and "ANTHROPIC_API_KEY" in got["written_error"]
    es = c.get("/api/word-suggestions", params={"language": "es"}, headers=AUTH).json()
    assert es["written"] == [] and es["written_error"] == ""
