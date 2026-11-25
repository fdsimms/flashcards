import asyncio
import random
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from franki_reader import grammar, store, written_points
from franki_reader.app import create_app
from franki_reader.coverage import Lexicon
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.grammar import FinderSpec, finder_from_spec
from franki_reader.lexicon import Entry
from franki_reader.written_points import check_point, needs_point, request_message

NOW = datetime(2026, 11, 25, 9, 0)
AUTH = {"Authorization": "Bearer open sesame"}
WORDS = ["แม่", "ให้", "ฉัน", "กิน", "ข้าว", "เขา", "ไป", "ตลาด", "ของ", "จะ", "นอน", "ครู", "อ่าน"]
ENTRIES = [Entry(i, w, w, "mature") for i, w in enumerate(WORDS, 1)]


@pytest.fixture(autouse=True)
def forget_written_points() -> Iterator[None]:
    """POINTS is the process's: take out what a test registered."""
    yield
    for pid in [p for p in grammar.POINTS if ".c" in p]:
        grammar.unregister(pid)


def ex(line: str) -> dict[str, Any]:
    return {"line": line, "english": "An example.", "words": ["ให้"]}


# ให้ before a person and a verb: "let" or "have someone do".
LET_EXAMPLES = [ex("แม่ให้ฉันกินข้าว"), ex("ครูให้เขาอ่าน"), ex("แม่ให้เขานอน"), ex("เขาให้ฉันไปตลาด")]
LET: dict[str, Any] = {
    "name": "ให้ (let, have someone do)",
    "note": "Letting or having someone do something",
    "example": "แม่ให้ฉันกิน, Mom let me eat",
    "explanation": '**ให้** before a person and a verb: **แม่ให้ฉันไป**, "Mom let me go".',
    "markers": ["ให้"],
    "not_these": [],
    "not_before": ["ของ"],
    "not_after": [],
    "not_first": False,
    "examples": LET_EXAMPLES,
    # ให้ as "give": ruled out by ของ after it.
    "lookalikes": [{"line": "เขาให้ของฉัน", "english": "He gave me a thing."}],
}


def test_a_spec_finds_its_marker_and_skips_the_neighbors_that_rule_it_out() -> None:
    thai = finder_from_spec("th", FinderSpec(("ให้",), not_before=("ของ",)))
    assert thai(["แม่", "ให้", "ฉัน", "กิน"]) == [(1, 2)]
    assert thai(["เขา", "ให้", "ของ", "ฉัน"]) == []
    polish = finder_from_spec("pl", FinderSpec(("czy",), not_first=False, not_after=("albo",)))
    assert polish(["czy", "masz", "kota"]) == [(0, 1)]
    assert polish(["albo", "czy", "nie"]) == []
    phrase = finder_from_spec("nb", FinderSpec(("kommer til å",)))
    assert phrase(["jeg", "kommer", "til", "å", "reise"]) == [(1, 4)]


def test_a_point_is_kept_when_its_finder_finds_its_examples_and_not_its_lookalikes() -> None:
    data, why = check_point(LET, Lexicon(WORDS), "th", "th.c1", 11)
    assert data is not None, why
    assert data["level"] == 11 and data["word_named"] and data["spec"]["markers"] == ["ให้"]


def test_a_point_is_dropped_when_it_finds_a_lookalike_too_few_examples_or_repeats_a_point() -> None:
    checker = Lexicon(WORDS)
    fires = {**LET, "not_before": []}
    assert check_point(fires, checker, "th", "th.c1", 11) == (
        None,
        "its finder fires on a look-alike line",
    )
    few = {**LET, "examples": LET_EXAMPLES[:2]}
    assert check_point(few, checker, "th", "th.c1", 11)[1].startswith("too few examples")
    will = {
        **LET,
        "markers": ["จะ"],
        "lookalikes": [],
        "examples": [
            {"line": line, "english": "x", "words": ["จะ"]}
            for line in ("แม่จะกินข้าว", "เขาจะไปตลาด", "ฉันจะนอน", "ครูจะอ่าน")
        ],
    }
    assert check_point(will, checker, "th", "th.c1", 11) == (None, "the same as th.future")


def test_only_a_language_short_of_points_to_learn_needs_one_and_never_japanese() -> None:
    thai = [p.id for p in grammar.points_for("th")]
    known = {pid: "normal" for pid in thai[1:]}
    assert needs_point("th", known)  # one left
    assert not needs_point("th", {pid: "normal" for pid in thai[3:]})
    assert not needs_point("ja", {p.id: "normal" for p in grammar.points_for("ja")})
    assert "เคย (have ever)" in request_message("th") and "like เคย" in request_message("th")


def _writer(answer: dict[str, Any]) -> written_points.WritePoint:
    async def write(
        entries: list[Entry], language: str, message: str
    ) -> tuple[dict[str, Any], Usage]:
        return answer, Usage()

    return write


def _engine(write: written_points.WritePoint | None = None, path: str = ":memory:") -> Engine:
    conn = store.connect(path)
    store.save_snapshot(conn, ENTRIES, NOW)
    return Engine(conn, None, None, lambda: NOW, random.Random(1), write_point=write)


def test_a_kept_point_is_registered_beside_the_catalog_and_after_a_restart(tmp_path: Path) -> None:
    path = str(tmp_path / "reader.db")
    e = _engine(path=path)
    point = asyncio.run(written_points.write_point(e.conn, e.snapshot, _writer(LET), "th", NOW))
    assert point is not None and point.id == "th.c1" and point.written
    assert grammar.POINTS["th.c1"].name == "ให้ (let, have someone do)"
    assert "th.c1" in [p.id for p in grammar.points_for("th")]

    grammar.unregister("th.c1")
    store.connect(path)
    assert grammar.POINTS["th.c1"].find(["แม่", "ให้", "ฉัน", "กิน"]) == [(1, 2)]


def test_a_language_running_short_gets_one_point_a_day_while_text_is_asked_for() -> None:
    e = _engine(_writer(LET))
    thai = [p.id for p in grammar.points_for("th")]
    store.set_grammar_many(e.conn, {pid: "normal" for pid in thai[1:]}, NOW)

    async def ask_twice() -> None:
        e.rotate_grammar("th")
        while e._tasks:
            await asyncio.gather(*list(e._tasks))
        e.rotate_grammar("th")  # the day's write is spent
        while e._tasks:
            await asyncio.gather(*list(e._tasks))

    asyncio.run(ask_twice())
    assert [p.id for p in store.written_points(e.conn, "th")] == ["th.c1"]


def test_a_slot_left_empty_is_filled_once_a_point_is_written() -> None:
    e = _engine()
    swap = store.Rotation(0, "th", "th.ever", "", "", NOW, 8, 4, 9, 10, "dismissed")
    rid = store.add_rotation(e.conn, swap)
    thai = [p.id for p in grammar.points_for("th")]
    store.set_grammar_many(e.conn, {pid: "normal" for pid in thai}, NOW)
    e.rotate_grammar("th")
    assert store.get_rotation(e.conn, rid).started == ""  # type: ignore[union-attr]

    asyncio.run(written_points.write_point(e.conn, e.snapshot, _writer(LET), "th", NOW))
    e.rotate_grammar("th")
    filled = store.get_rotation(e.conn, rid)
    assert filled is not None and (filled.started, filled.state) == ("th.c1", "new")
    assert store.load_grammar(e.conn)["th.c1"] == "practice"


def test_the_app_reads_the_written_points() -> None:
    e = _engine()
    asyncio.run(written_points.write_point(e.conn, e.snapshot, _writer(LET), "th", NOW))
    with TestClient(create_app(e, "open sesame")) as c:
        [point] = c.get("/api/grammar/written", headers=AUTH).json()["points"]
    assert point["id"] == "th.c1" and point["explanation"] == LET["explanation"]
    assert point["word_named"] is True and point["level"] == 11
