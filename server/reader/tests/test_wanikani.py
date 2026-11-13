"""WaniKani's learned vocabulary as known Japanese words (wanikani.py): reading it from the API,
keeping the last list when it can't be read, and refreshing it with the Japanese deck."""

import asyncio
import random
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from franki_reader import store
from franki_reader.engine import Engine
from franki_reader.wanikani import (
    WaniKaniUnavailable,
    WaniKaniWord,
    as_entries,
    parse_subject,
    wanikani_reader,
)

NOW = datetime(2026, 11, 13, 9, 0)


def subject(
    sid: int, characters: str, meaning: str, reading: str = "", kind: str = "vocabulary"
) -> dict[str, Any]:
    return {
        "id": sid,
        "object": kind,
        "data": {
            "characters": characters,
            "meanings": [
                {"meaning": "Other", "primary": False},
                {"meaning": meaning, "primary": True},
            ],
            "readings": [{"reading": reading, "primary": True}] if reading else [],
        },
    }


def assignment(sid: int, stage: int) -> dict[str, Any]:
    return {"object": "assignment", "data": {"subject_id": sid, "srs_stage": stage}}


class FakeWaniKani:
    """Answers the two requests the reader makes, assignments over two pages."""

    def __init__(self, status: int = 200) -> None:
        self.status = status
        self.requests: list[httpx.Request] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, json={"error": "nope"})
        url = urlparse(str(request.url))
        query = parse_qs(url.query)
        if url.path.endswith("/assignments"):
            if "page_after_id" in query:
                return httpx.Response(
                    200, json={"data": [assignment(3, 9)], "pages": {"next_url": None}}
                )
            next_url = f"{request.url}&page_after_id=2"
            return httpx.Response(
                200,
                json={
                    "data": [assignment(1, 5), assignment(2, 7)],
                    "pages": {"next_url": next_url},
                },
            )
        ids = [int(i) for i in query["ids"][0].split(",")]
        known = {
            1: subject(1, "〜中", "during", "ちゅう"),
            2: subject(2, "大人", "adult", "おとな"),
            3: subject(3, "ラーメン", "ramen", kind="kana_vocabulary"),
        }
        return httpx.Response(
            200, json={"data": [known[i] for i in ids], "pages": {"next_url": None}}
        )


def read_with(fake: FakeWaniKani) -> Any:
    return wanikani_reader("token", httpx.MockTransport(fake.handle))


def test_the_learned_vocabulary_is_read_page_by_page() -> None:
    fake = FakeWaniKani()
    words = asyncio.run(read_with(fake)())
    assert words == [
        WaniKaniWord(1, "中", "during", "ちゅう", 5),
        WaniKaniWord(2, "大人", "adult", "おとな", 7),
        WaniKaniWord(3, "ラーメン", "ramen", "", 9),
    ]
    first = fake.requests[0]
    assert first.headers["Authorization"] == "Bearer token"
    assert first.headers["Wanikani-Revision"] == "20170710"
    query = parse_qs(urlparse(str(first.url)).query)
    assert query["srs_stages"] == ["5,6,7,8,9"]  # Guru and above
    assert query["subject_types"] == ["vocabulary,kana_vocabulary"]


def test_a_refused_token_or_a_failure_is_unavailable() -> None:
    with pytest.raises(WaniKaniUnavailable, match="WANIKANI_TOKEN"):
        asyncio.run(read_with(FakeWaniKani(401))())
    with pytest.raises(WaniKaniUnavailable):
        asyncio.run(read_with(FakeWaniKani(503))())


def test_only_vocabulary_with_a_meaning_is_kept() -> None:
    assert parse_subject(subject(1, "大", "big", kind="kanji"), 5) is None
    assert (
        parse_subject({"id": 1, "object": "vocabulary", "data": {"characters": "大人"}}, 5) is None
    )


def test_master_and_above_is_listed_as_well_known() -> None:
    entries = as_entries(
        [WaniKaniWord(2, "大人", "adult", "おとな", 7), WaniKaniWord(1, "中", "during", "", 5)]
    )
    assert [(e.note_id, e.tier) for e in entries] == [(-2, "mature"), (-1, "young")]


def test_the_list_is_kept_a_day_and_kept_when_wanikani_cant_be_read() -> None:
    conn = store.connect(":memory:")
    fake = FakeWaniKani()
    assert asyncio.run(store.refresh_wanikani_if_stale(conn, read_with(fake), NOW))
    assert len(store.load_wanikani(conn)) == 3
    calls = len(fake.requests)
    assert not asyncio.run(
        store.refresh_wanikani_if_stale(conn, read_with(fake), NOW + timedelta(hours=1))
    )
    assert len(fake.requests) == calls
    later = NOW + timedelta(days=1)
    assert not asyncio.run(
        store.refresh_wanikani_if_stale(conn, read_with(FakeWaniKani(503)), later)
    )
    assert len(store.load_wanikani(conn)) == 3


def test_the_engine_reads_wanikani_with_the_japanese_deck_only() -> None:
    conn = store.connect(":memory:")
    fake = FakeWaniKani()
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), read_wanikani=read_with(fake))
    asyncio.run(engine.refresh_lexicon("es"))
    assert fake.requests == []
    asyncio.run(engine.refresh_lexicon("ja"))
    assert [e.text for e in engine.wanikani_entries("ja")] == ["中", "大人", "ラーメン"]
    assert engine.snapshot("ja")[1].status("大人") == "known"
