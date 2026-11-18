import asyncio
import random
import sqlite3
from datetime import datetime

from fastapi.testclient import TestClient
from test_app import AUTH, started
from test_grammar import Model, draft

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import TextRequest, generate
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.store import Reading, Settings
from franki_reader.word_suggestions import excluded, from_common, from_texts, suggest

NOW = datetime(2026, 11, 18, 9, 0)

# Spanish counting no common words, so every word not in the deck is unknown in a text.
DECK = [
    Entry(1, "hablar", "to speak", "mature"),
    Entry(2, "la casa", "house", "young"),
    Entry(3, "el perro", "dog", "unreviewed"),  # added, not studied yet
]


def connect(common: int = 0) -> sqlite3.Connection:
    conn = store.connect(":memory:")
    store.save_settings(conn, Settings(language="es", common={"es": common}))
    store.save_snapshot(conn, DECK, NOW, "es")
    return conn


def write(conn: sqlite3.Connection, *lines: str, finished: bool = True) -> int:
    # Written with every word of its lines known, so the draft passes the first time.
    pieces = {w.strip("~.,¿?") for line in lines for w in line.split("|")}
    knows_all = lexicon_from([Entry(i, w, "", "mature") for i, w in enumerate(pieces)], "es", 0)
    request = TextRequest("t", language="es")
    generated = asyncio.run(generate(Model(draft(*lines)), knows_all, request))
    topic = store.add_topic(conn, f"t{random.random()}", NOW)
    text_id = store.save_text(conn, topic.id, generated, [], 0.9, NOW, language="es")
    store.log_reading(conn, text_id, Reading(None, finished, (), (), None, False, 10), NOW)
    return text_id


ES = lexicon_from(DECK, "es", 0)


def texts_of(conn: sqlite3.Connection) -> list[store.StoredText]:
    return [t for t, _ in store.finished_texts(conn, "es")]


def words(suggestions: list) -> list[tuple[str, int]]:  # type: ignore[type-arg]
    return [(s.word, s.texts) for s in suggestions]


def test_words_from_texts_read_most_texts_first_by_dictionary_form() -> None:
    conn = connect()
    write(conn, "Aprovechamos|la|casa.", "Hablé|con|~Ana~.")
    write(conn, "Ellos|aprovechan|el|perro.")
    write(conn, "Nunca|leído.", finished=False)  # stopped partway
    skip = excluded("es", DECK, [], [])
    found = words(from_texts(texts_of(conn), ES, skip, {}, "es"))
    # aprovechar is in both texts, in two forms; hablé is a form of a deck word, el perro is in
    # the deck though not studied, Ana is a name, and the unfinished text isn't counted.
    assert found[0] == ("aprovechar", 2)
    assert {w for w, _ in found} >= {"con", "él"}  # ellos, by its dictionary form
    assert not {"hablé", "hablar", "perro", "casa", "Ana", "ana", "nunca", "leído"} & {
        w for w, _ in found
    }


def test_a_word_is_shown_as_it_is_written_mid_sentence() -> None:
    conn = connect()
    write(conn, "Mañana|vamos.", "Vamos|mañana.")
    skip = excluded("es", DECK, [], [])
    shown = {s.word for s in from_texts(texts_of(conn), ES, skip, {}, "es")}
    assert "mañana" in shown and "Mañana" not in shown


def test_queued_and_dismissed_words_are_left_out() -> None:
    conn = connect()
    write(conn, "Aprovechamos|la|madrugada|ayer.")
    store.add_queued(conn, "es", "Español", [("la madrugada", "")], NOW)
    store.dismiss_word(conn, "es", "ayer", NOW)
    store.dismiss_word(conn, "es", "ayer", NOW)  # again is fine
    texts, common = suggest(conn, "es", DECK, ES, [], {})
    shown = {s.word for s in texts + common}
    assert "aprovechar" in shown
    assert not {"madrugada", "la madrugada", "ayer"} & shown
    assert store.dismissed_words(conn, "es") == ["ayer"]


def test_common_words_start_past_the_setting_and_skip_the_deck_and_texts() -> None:
    skip = excluded("es", DECK, [], [])
    common = from_common("es", 3, skip, ["en"], {"y": "and"})
    # The list starts el, de, que, en, y: three are counted as known, en came from a text.
    assert common[0].word == "y" and common[0].rank == 5 and common[0].meaning == "and"
    assert "en" not in {s.word for s in common}
    assert len(common) == 50
    assert "hablar" not in {s.word for s in common} and "casa" not in {s.word for s in common}


def test_thai_starts_at_the_top_of_its_list() -> None:
    conn = store.connect(":memory:")
    _, common = suggest(conn, "th", [], lexicon_from([], "th"), [], {})
    assert common[0].rank == 1


def test_routes() -> None:
    conn = connect(common=3)
    write(conn, "Aprovechamos|la|casa.")
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1))
    c: TestClient = started(create_app(engine, "open sesame"))
    got = c.get("/api/word-suggestions", params={"language": "es"}, headers=AUTH).json()
    assert got["texts"][0]["word"] == "aprovechar" and got["texts"][0]["texts"] == 1
    assert got["common"][0]["rank"] == 4  # past the setting's three
    first = got["common"][0]["word"]
    r = c.post(
        "/api/word-suggestions/dismiss", json={"language": "es", "word": f" {first} "}, headers=AUTH
    )
    assert r.status_code == 204
    again = c.get("/api/word-suggestions", params={"language": "es"}, headers=AUTH).json()
    assert first not in {s["word"] for s in again["common"]}
    assert c.get("/api/word-suggestions", params={"language": "es"}).status_code == 401
