"""The vocabulary check's question bank: the sample, the checks on what Claude writes, the stored bank
and its endpoint."""

import asyncio
import random
from datetime import datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from test_app import AUTH, started

from franki_reader import store
from franki_reader.app import VOCAB_RETRY, create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.lexicon import Entry
from franki_reader.spaced import common_lemmas
from franki_reader.vocab_check import (
    ASKED_PER_BAND,
    BANDS,
    MIN_PER_BAND,
    PER_BAND,
    VocabFailed,
    band_of,
    check,
    request_message,
    sample,
    write_bank,
)

NOW = datetime(2026, 11, 12, 9, 0)


def good(word: str, **over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "word": word,
        "meaning": "to see",
        "wrong": ["to sleep", "to buy", "house"],
    }
    return {**base, **over}


def test_the_sample_takes_a_fixed_number_of_plain_words_from_each_band() -> None:
    asked = sample("pl")
    assert sample("pl") == asked  # the same words every time, so each is glossed once
    for i, (lo, hi) in enumerate(BANDS):
        in_band = [(r, w) for r, w in asked if band_of(r) == i]
        assert len(in_band) == ASKED_PER_BAND and all(lo <= r <= hi for r, _ in in_band)
    assert all(w.isalpha() and w == common_lemmas("pl")[r - 1] for r, w in asked)
    assert sample("ru") != asked  # each language draws its own


def test_the_request_lists_the_ranked_words() -> None:
    message = request_message("pl", [(3, "i"), (20, "mieć")])
    assert "Polish" in message and "3. i\n20. mieć" in message


def test_keeps_a_word_it_asked_for_with_three_usable_wrong_choices() -> None:
    kept = check(good("widzieć"), {"widzieć": 612})
    assert kept is not None
    assert (kept.lemma, kept.rank, kept.meaning) == ("widzieć", 612, "to see")
    assert kept.wrong == ("to sleep", "to buy", "house")


def test_drops_a_word_it_didnt_ask_for_or_a_malformed_one() -> None:
    asked = {"widzieć": 612}
    assert check(good("kot"), asked) is None
    assert check("nope", asked) is None
    assert check(good("widzieć", wrong="to sleep"), asked) is None
    assert check(good("widzieć", meaning=" "), asked) is None
    assert check(good("widzieć", meaning="x" * 41), asked) is None


def test_drops_choices_that_could_also_be_right() -> None:
    asked = {"widzieć": 612}
    # Three wrong choices are needed after the duplicates and look-alikes of the meaning go.
    assert check(good("widzieć", wrong=["to sleep", "to buy", "to see"]), asked) is None
    assert check(good("widzieć", wrong=["to sleep", "to buy", "to see again"]), asked) is None
    assert check(good("widzieć", wrong=["to sleep", "to buy", "to buy"]), asked) is None
    assert (
        check(good("widzieć", wrong=["to sleep", "to buy", "house", "to see"]), asked) is not None
    )


def test_drops_text_the_learner_would_see_with_markup_or_an_em_dash() -> None:
    asked = {"widzieć": 612}
    assert check(good("widzieć", meaning="to see — look"), asked) is None
    assert check(good("widzieć", wrong=["to sleep", "to buy", "ho|use"]), asked) is None


class Writer:
    def __init__(self, *batches: list[Any] | Exception) -> None:
        self.batches = list(batches)
        self.calls = 0

    async def __call__(self, language: Any, asked: Any) -> tuple[list[Any], Usage]:
        self.calls += 1
        batch = self.batches.pop(0)
        if isinstance(batch, Exception):
            raise batch
        return batch, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")


def whole_bank(language: str = "pl", per_band: int = ASKED_PER_BAND) -> list[dict[str, Any]]:
    by_band: dict[int | None, int] = {}
    out = []
    for rank, word in sample(language):  # type: ignore[arg-type]
        band = band_of(rank)
        if by_band.get(band, 0) < per_band:
            by_band[band] = by_band.get(band, 0) + 1
            out.append(good(word))
    return out


def test_writes_the_bank_once_and_keeps_the_cost() -> None:
    conn = store.connect(":memory:")
    writer = Writer(whole_bank())
    assert asyncio.run(write_bank(conn, writer, "pl", lambda: NOW))
    assert len(store.vocab_items(conn, "pl")) == len(BANDS) * ASKED_PER_BAND
    assert store.vocab_spending(conn, NOW - timedelta(days=1)) == {"pl": (1, 2.0)}


def test_a_bank_with_a_band_too_thin_keeps_nothing_but_the_cost() -> None:
    conn = store.connect(":memory:")
    thin = whole_bank(per_band=MIN_PER_BAND - 1)
    assert not asyncio.run(write_bank(conn, Writer(thin), "pl", lambda: NOW))
    assert store.vocab_items(conn, "pl") == []
    assert store.vocab_spending(conn, NOW - timedelta(days=1)) == {"pl": (1, 2.0)}


def test_a_failed_call_stores_nothing() -> None:
    conn = store.connect(":memory:")
    assert not asyncio.run(write_bank(conn, Writer(VocabFailed("no")), "pl", lambda: NOW))
    assert store.vocab_spending(conn, NOW - timedelta(days=1)) == {}


def vocab_client(writer: Writer | None, deck: list[Entry] | None = None) -> TestClient:
    conn = store.connect(":memory:")
    now = [NOW]
    store.save_snapshot(conn, deck or [], NOW, "pl")
    engine = Engine(conn, None, None, lambda: now[0], random.Random(1))
    c = started(create_app(engine, "open sesame", write_vocab=writer))
    c.now = now  # type: ignore[attr-defined]
    return c


def get(c: TestClient, language: str = "pl") -> Any:
    return c.get(f"/api/vocab-check?language={language}", headers=AUTH)


def test_the_first_ask_starts_writing_and_the_next_serves_the_bank() -> None:
    writer = Writer(whole_bank())
    c = vocab_client(writer)
    assert get(c).json() == {"state": "preparing", "items": []}
    ready = get(c).json()
    assert ready["state"] == "ready" and writer.calls == 1
    assert len(ready["items"]) == len(BANDS) * PER_BAND  # kept to PER_BAND a band
    first = ready["items"][0]
    assert set(first) == {"word", "rank", "meaning", "wrong"} and len(first["wrong"]) == 3
    assert get(c).json()["state"] == "ready" and writer.calls == 1  # never written twice


def test_words_already_in_the_deck_are_left_out() -> None:
    bank = whole_bank()
    in_deck = bank[0]["word"]
    c = vocab_client(Writer(bank), [Entry(1, in_deck, "meaning", "mature")])
    get(c)
    words = [i["word"] for i in get(c).json()["items"]]
    assert in_deck not in words and len(words) == len(BANDS) * PER_BAND


def test_a_failed_write_isnt_asked_again_until_the_retry_time() -> None:
    writer = Writer(VocabFailed("no"), whole_bank())
    c = vocab_client(writer)
    get(c)
    assert get(c).json()["state"] == "failed" and writer.calls == 1
    c.now[0] = NOW + VOCAB_RETRY + timedelta(seconds=1)  # type: ignore[attr-defined]
    assert get(c).json()["state"] == "preparing"
    assert get(c).json()["state"] == "ready" and writer.calls == 2


def test_without_claude_the_check_is_unavailable() -> None:
    assert get(vocab_client(None)).json() == {"state": "unavailable", "items": []}


def test_thai_and_unknown_languages_are_refused() -> None:
    c = vocab_client(Writer())
    assert get(c, "th").status_code == 422
    assert get(c, "xx").status_code == 422
    assert c.get("/api/vocab-check?language=pl").status_code == 401


def test_the_cost_shows_in_the_costs() -> None:
    c = vocab_client(Writer(whole_bank()))
    get(c)
    costs = c.get("/api/costs", headers=AUTH).json()["vocab_checks"]
    assert costs["batches"] == 1 and costs["cost_usd"] == 2.0
    assert costs["languages"] == [
        {"language": "pl", "name": "Polish", "batches": 1, "cost_usd": 2.0}
    ]
