import asyncio
import random
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from scripted import ENTRIES

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine, NotAvailable
from franki_reader.generator import Usage
from franki_reader.languages import Code
from franki_reader.own_text import (
    MAX_CHARS,
    OwnLine,
    OwnTextRefused,
    TranslationFailed,
    checked,
    clean,
    parse_translation,
    part_title,
    split_lines,
    split_parts,
    title_of,
)
from franki_reader.store import Reading

NOW = datetime(2026, 11, 25, 9, 0)
AUTH = {"Authorization": "Bearer open sesame"}
THAI = "ฉันอยากกินข้าวเหนียวมะม่วงครับ ฉันอยากกินข้าวเหนียวมะม่วง\n\nรับอะไรดีครับ ฉันอยากกินครับ"


def test_cleans_line_ends_and_the_line_formats_marks() -> None:
    assert clean("  a *b*  c|d\r\ne ~f~ \r\n") == "a b c d\ne f"


def test_splits_sentences_and_paragraphs_in_a_spaced_language() -> None:
    text = (
        'Ala ma kota. Kot ma Alę! "Czy to prawda?" Tak.\n\nNowy akapit… I tyle.\nWers\nDrugi wers'
    )
    lines = split_lines(text, "pl")
    assert [ln.text for ln in lines] == [
        "Ala ma kota.",
        "Kot ma Alę!",
        '"Czy to prawda?"',
        "Tak.",
        "Nowy akapit…",
        "I tyle.",
        "Wers",
        "Drugi wers",
    ]
    assert [ln.paragraph for ln in lines] == [True, False, False, False, True, False, False, False]


def test_splits_japanese_at_its_full_stops() -> None:
    assert [ln.text for ln in split_lines("今日は雨です。「行く？」と聞いた。", "ja")] == [
        "今日は雨です。",
        "「行く？」",
        "と聞いた。",
    ]


def test_splits_thai_at_its_spaces_joining_short_pieces() -> None:
    lines = split_lines("ฉันอยากกินข้าวเหนียวมะม่วง ครับ วันนี้อากาศดีมากเลยนะ", "th")
    # ครับ alone is too short to be a line, so it stays with what it ends.
    assert [ln.text for ln in lines] == ["ฉันอยากกินข้าวเหนียวมะม่วง ครับ", "วันนี้อากาศดีมากเลยนะ"]


def test_parts_break_at_a_paragraph_and_each_starts_one() -> None:
    lines = [OwnLine("a" * 40, i % 3 == 0) for i in range(12)]
    parts = split_parts(lines, size=200)
    assert sum(len(p) for p in parts) == 12
    assert all(p[0].paragraph for p in parts)
    assert all(sum(len(x.text) for x in p) <= 200 for p in parts)
    # A cut falls on a paragraph start where one is past half the part.
    assert [len(p) for p in parts] == [3, 3, 3, 3]
    assert split_parts(lines[:2], size=200) == [lines[:2]]


def test_titles() -> None:
    first = [
        OwnLine("Nowy most w Krakowie został otwarty w sobotę dla pieszych i rowerzystów", True)
    ]
    assert title_of("  Mój  tekst ", first) == "Mój tekst"
    assert title_of("", first).endswith("…") and len(title_of("", first)) <= 60
    assert part_title("Most", 1, 1) == "Most"
    assert part_title("Most", 2, 3) == "Most · Part 2 of 3"


def test_refuses_an_empty_or_too_long_text_saying_why() -> None:
    with pytest.raises(OwnTextRefused, match="no text"):
        checked(" | * ", "pl")
    with pytest.raises(OwnTextRefused, match=f"up to {MAX_CHARS:,}"):
        checked("a" * (MAX_CHARS + 1), "pl")


def test_a_translation_must_have_one_line_for_each() -> None:
    assert parse_translation({"lines": [" I  want ", "rice"]}, 2) == ["I want", "rice"]
    with pytest.raises(TranslationFailed, match="Expected 3"):
        parse_translation({"lines": ["a"]}, 3)
    with pytest.raises(TranslationFailed):
        parse_translation([], 1)


class Translator:
    def __init__(self, fail: bool = False) -> None:
        self.asked: list[list[str]] = []
        self.fail = fail

    async def __call__(self, language: Code, lines: list[str]) -> tuple[list[str], Usage]:
        self.asked.append(lines)
        if self.fail:
            raise TranslationFailed("No translation (refusal)", Usage(input_tokens=100))
        return [f"English {i}" for i in range(len(lines))], Usage(100, 50)


def engine(translator: Translator | None) -> Engine:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    return Engine(conn, None, None, lambda: NOW, random.Random(1), write_translation=translator)


async def settle(e: Engine) -> None:
    while e._tasks:
        await asyncio.gather(*list(e._tasks))


def test_previews_coverage_new_words_and_size_against_the_deck() -> None:
    p = engine(Translator()).own_preview("th", THAI + " ทอน")
    assert 0 < p.coverage < 1
    # ทอน is in the deck but not studied yet, so it's new.
    assert "ทอน" in p.new_words and "ฉัน" not in p.new_words
    assert p.new_count == len(set(p.new_words))
    assert p.lines == 4 and p.parts == 1 and p.cost_usd > 0 and p.seconds > 0
    with pytest.raises(NotAvailable, match="word list"):
        engine(Translator()).own_preview("pl", "Ala ma kota.")


def test_adds_a_text_that_joins_its_own_row_once_translated() -> None:
    translator = Translator()
    e = engine(translator)

    async def scenario() -> None:
        ids = e.add_own_text("th", THAI, "ของกิน")
        assert len(ids) == 1
        # Pending while it's made, and shown as being made.
        assert store.own_texts(e.conn, "th") == []
        assert [j.reason for j in e.writing("th")] == ["own"]
        await settle(e)
        [text] = store.own_texts(e.conn, "th")
        assert text.id == ids[0] and text.title == "ของกิน" and text.reason == "own"
        assert [ln.english for ln in text.lines] == [
            "English 0",
            "English 1",
            "English 2",
            "English 3",
        ]
        assert text.lines[0].paragraph and text.lines[2].paragraph and not text.lines[1].paragraph
        (cost,) = e.conn.execute("SELECT cost_usd FROM texts WHERE id = ?", (text.id,)).fetchone()
        assert cost > 0
        # Not mixed in with the texts written for the shelf.
        assert store.shelf_texts(e.conn, "th") == []
        assert e.writing("th") == []

    asyncio.run(scenario())


def test_a_part_that_cant_be_translated_is_still_served_without_english() -> None:
    e = engine(Translator(fail=True))

    async def scenario() -> None:
        e.add_own_text("th", THAI)
        await settle(e)
        [text] = store.own_texts(e.conn, "th")
        assert {ln.english for ln in text.lines} == {""}

    asyncio.run(scenario())


def test_adding_needs_a_claude_key() -> None:
    with pytest.raises(NotAvailable, match="Claude"):
        engine(None).add_own_text("th", THAI)


def test_reading_one_never_moves_the_difficulty() -> None:
    e = engine(Translator())

    async def scenario() -> None:
        e.add_own_text("th", THAI)
        await settle(e)

    asyncio.run(scenario())
    before = store.load_difficulty(e.conn, "th")
    # A check this poor would make a written text's language easier.
    e.record_reading(text_id_of(e), Reading("too_hard", True, (), (), 1.0, False, 300, 0, 4))
    assert store.load_difficulty(e.conn, "th") == before
    assert store.text_status(e.conn, text_id_of(e)) == "read"


def text_id_of(e: Engine) -> int:
    (found,) = e.conn.execute("SELECT id FROM texts WHERE reason = 'own'").fetchone()
    return int(found)


def client(e: Engine) -> TestClient:
    return TestClient(create_app(e, "open sesame", None))


def test_the_routes() -> None:
    e = engine(Translator())
    with client(e) as c:
        r = c.post("/api/own-texts/preview", json={"language": "th", "text": THAI}, headers=AUTH)
        assert r.status_code == 200
        body: dict[str, Any] = r.json()
        assert body["lines"] == 4 and body["title"].startswith("ฉัน")
        empty = c.post("/api/own-texts/preview", json={"language": "th", "text": "|"}, headers=AUTH)
        assert empty.status_code == 422 and "no text" in empty.json()["detail"]
        assert c.post("/api/own-texts", json={"language": "th", "text": THAI}).status_code == 401
        added = c.post("/api/own-texts", json={"language": "th", "text": THAI}, headers=AUTH)
        assert added.status_code == 202 and len(added.json()["ids"]) == 1
    asyncio.run(settle(e))
    with client(e) as c:
        shelf = c.get("/api/shelf?language=th", headers=AUTH).json()
        assert [t["reason"] for t in shelf["own"]] == ["own"] and shelf["texts"] == []
    with client(engine(None)) as c:
        r = c.post("/api/own-texts", json={"language": "th", "text": THAI}, headers=AUTH)
        assert r.status_code == 503


def test_the_translation_prompt_asks_for_natural_english() -> None:
    from franki_reader.generator import NATURAL_ENGLISH
    from franki_reader.own_text import _SYSTEM

    assert NATURAL_ENGLISH in _SYSTEM
