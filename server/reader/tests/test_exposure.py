import asyncio
import random
import sqlite3
from datetime import datetime, timedelta

from test_grammar import ES, Model, draft

from franki_reader import store
from franki_reader.difficulty import Difficulty
from franki_reader.engine import Engine
from franki_reader.exposure import Exposure, exposure, review_points, unset_points
from franki_reader.generator import TextRequest, generate
from franki_reader.store import Reading

NOW = datetime(2026, 11, 12, 9, 0)


def connect() -> sqlite3.Connection:
    conn = store.connect(":memory:")
    store.save_settings(conn, store.Settings(language="es"))
    return conn


def write(
    conn: sqlite3.Connection, *lines: str, at: datetime = NOW, review: tuple[str, ...] = ()
) -> int:
    generated = asyncio.run(generate(Model(draft(*lines)), ES, TextRequest("t", language="es")))
    topic = store.add_topic(conn, "t", False, at)
    grammar = {"practice": [], "avoid": [], "review": list(review)}
    return store.save_text(conn, topic.id, generated, [], 0.9, at, language="es", grammar=grammar)


def read(conn: sqlite3.Connection, text_id: int, at: datetime = NOW, finished: bool = True) -> None:
    store.log_reading(conn, text_id, Reading(None, finished, (), (), None, False, 10), at)


def test_uses_are_counted_in_texts_read_to_the_end_only() -> None:
    conn = connect()
    read(conn, write(conn, "Ayer|hablé|con|Ana.", "¿Y|qué|dijo?"), NOW - timedelta(days=3))
    read(conn, write(conn, "Hoy|hablo|con|Ana.", "Ella|comía|y|dijo|algo."), NOW)
    read(conn, write(conn, "Ayer|hablé|mucho."), NOW, finished=False)  # stopped partway
    write(conn, "Ayer|hablé|mucho.")  # never opened
    seen = exposure(conn, ES, "es", {})
    assert seen["es.preterite"] == Exposure(texts=2, uses=3, last_seen=NOW)
    assert seen["es.imperfect"] == Exposure(texts=1, uses=1, last_seen=NOW)
    assert seen["es.future"] == Exposure()


def test_a_texts_matches_are_found_once_and_kept() -> None:
    conn = connect()
    text_id = write(conn, "Ayer|hablé|con|Ana.")
    read(conn, text_id)
    cache: dict[int, dict[str, int]] = {}
    exposure(conn, ES, "es", cache)
    assert cache == {text_id: {"es.preterite": 1}}
    cache[text_id] = {"es.future": 5}  # a cached count is used as it is
    assert exposure(conn, ES, "es", cache)["es.future"].uses == 5


def test_only_known_points_are_worked_in_never_met_ones_first() -> None:
    choices = {
        "es.preterite": "normal",
        "es.imperfect": "normal",
        "es.future": "normal",
        "es.conditional": "practice",
        "es.pluperfect": "avoid",
    }
    seen = {
        "es.preterite": Exposure(5, 9, NOW),
        "es.imperfect": Exposure(1, 1, NOW - timedelta(days=9)),
    }
    picked = review_points(choices, seen, {}, "es")  # type: ignore[arg-type]
    # The future was never met; the imperfect was met longest ago.
    assert picked == ("es.future", "es.imperfect")


def test_being_asked_for_counts_too_so_the_list_rotates() -> None:
    choices = {"es.preterite": "normal", "es.imperfect": "normal", "es.future": "normal"}
    offered = {"es.future": NOW, "es.imperfect": NOW - timedelta(days=1)}
    # None of the three has come up in a text read; the future was just asked for, so the
    # preterite and the imperfect come next.
    assert review_points(choices, {}, offered, "es") == ("es.preterite", "es.imperfect")  # type: ignore[arg-type]


def test_unset_points_are_the_ones_never_marked() -> None:
    unset = unset_points({"es.preterite": "normal", "es.future": "avoid"}, "es")
    assert "es.preterite" not in unset and "es.future" not in unset
    assert "es.imperfect" in unset


def test_the_request_works_in_known_points_and_caps_unmarked_ones() -> None:
    conn = connect()
    store.set_grammar(conn, "es.preterite", "normal")
    store.set_grammar(conn, "es.imperfect", "normal")
    store.set_grammar(conn, "es.future", "normal")
    store.set_grammar(conn, "es.pluperfect", "avoid")
    read(conn, write(conn, "Ayer|hablé|con|Ana."))
    e = Engine(conn, None, None, lambda: NOW, random.Random(1))
    request = e._request("t", [], Difficulty(), "es")
    assert request.review == ("es.imperfect", "es.future")  # the preterite was just read
    assert "es.preterite" not in request.unset and "es.pluperfect" not in request.unset
    assert "es.conditional" in request.unset
    # A text written to work them in counts as their latest turn, read or not.
    write(conn, "Hoy|hablo.", at=NOW + timedelta(hours=1), review=request.review)
    assert e._request("t", [], Difficulty(), "es").review == ("es.preterite", "es.imperfect")
