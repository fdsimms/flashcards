from datetime import datetime, timedelta
from types import SimpleNamespace

from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW, started
from test_engine import Clock, engine, fetch, reading, run

from franki_reader import reading_lines, store
from franki_reader.app import create_app
from franki_reader.coverage import Lexicon
from franki_reader.engine import Engine
from franki_reader.lexicon import lexicon_from

FULL = lexicon_from(ENTRIES, "th")
MANGO = "ข้าวเหนียวมะม่วง"


def read_two_texts() -> tuple[Engine, list[int]]:
    """An engine with two texts read an hour apart, each using กิน and the mango word."""
    clock = Clock()
    e = engine(ScriptedModel(IN_RANGE), clock=clock)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    ids = []
    for hour in (0, 1):
        clock.now = NOW + timedelta(hours=hour)
        text = run(lambda: fetch(e, topic.id))
        e.record_reading(text.id, reading(None))
        ids.append(text.id)
    return e, ids


def test_finds_a_words_lines_one_a_text_latest_read_first() -> None:
    e, (first, second) = read_two_texts()
    read = store.finished_texts(e.conn, "th")
    found = reading_lines.find(["กิน", MANGO, "ไม่มี"], read, FULL)
    # กิน is in both texts: the one read last comes first, and one line a text.
    assert [ln.text_id for ln in found["กิน"]] == [second, first]
    assert all("กิน" in ln.line and "|" not in ln.line and "*" not in ln.line for ln in found["กิน"])
    assert found["กิน"][0].english
    # The word as the line has it, for the card to mark it there.
    assert found["กิน"][0].word == "กิน" and found["กิน"][0].word in found["กิน"][0].line
    # A phrase of the deck is found too, and a word in no text is left out.
    assert [ln.text_id for ln in found[MANGO]] == [second, first]
    assert "ไม่มี" not in found


def test_keeps_only_so_many_lines_a_word() -> None:
    e, (_, second) = read_two_texts()
    read = store.finished_texts(e.conn, "th")
    assert [ln.text_id for ln in reading_lines.find(["กิน"], read, FULL, per_word=1)["กิน"]] == [
        second
    ]
    assert reading_lines.find([], read, FULL) == {}


def test_the_route_answers_by_word_and_needs_the_passphrase() -> None:
    e, (_, second) = read_two_texts()
    c = started(create_app(e, "open sesame"))
    body = {"language": "th", "words": [MANGO, "ไม่มี"]}
    assert c.post("/api/reading-lines", json=body).status_code == 401
    got = c.post("/api/reading-lines", json=body, headers=AUTH).json()["lines"]
    assert list(got) == [MANGO]
    assert got[MANGO][0]["text_id"] == second and set(got[MANGO][0]) == {
        "text_id",
        "title",
        "line",
        "english",
        "word",
    }
    assert c.post(
        "/api/reading-lines", json={"language": "es", "words": [MANGO]}, headers=AUTH
    ).json() == {"lines": {}}


def test_a_name_beside_a_word_does_not_make_a_word_of_the_two() -> None:
    # ข้าง + the name ต้น must not count as ข้างต้น (aforementioned), nor a name as the deck word.
    lex = Lexicon(["ข้าง", "ต้น", "ข้างต้น"])
    line = SimpleNamespace(text="เขา|อยู่|ข้าง|~ต้น~", english="He is next to Ton.")
    text = SimpleNamespace(id=1, title="T", lines=(line,))
    found = reading_lines.find(["ข้างต้น", "ข้าง", "ต้น"], [(text, datetime(2026, 1, 1))], lex)  # type: ignore[list-item]
    assert list(found) == ["ข้าง"]
