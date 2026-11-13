"""The vocabulary check's question bank: the sample, the checks on what Claude writes, the stored bank
and its endpoint."""

import asyncio
import random
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_app import AUTH, started
from test_generator import FakeClient, finish, response

from franki_reader import store
from franki_reader.app import VOCAB_RETRY, create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.japanese import quiz_word
from franki_reader.lexicon import Entry
from franki_reader.spaced import common_lemmas
from franki_reader.vocab_check import (
    ASKED_PER_BAND,
    BANDS,
    MIN_PER_BAND,
    VocabFailed,
    VocabItem,
    band_of,
    check,
    claude_vocab,
    is_giveaway,
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


def test_japanese_asks_only_about_content_words_in_their_dictionary_form() -> None:
    asked = sample("ja")
    words = [w for _, w in asked]
    assert len(asked) == len(BANDS) * ASKED_PER_BAND
    assert all(w == common_lemmas("ja")[r - 1] for r, w in asked)  # ranks stay the list's
    # Particles, auxiliaries, lone kana and pieces of a conjugated word are never asked.
    assert not {"は", "を", "です", "ます", "き", "なっ", "あっ", "だっ"} & set(words)
    assert quiz_word("食べる") and quiz_word("映画")
    assert not quiz_word("東京")  # a name
    # Claude may leave out what Sudachi reads as a word but isn't one alone (まし).
    assert "まし" in request_message("ja", [(30, "まし")])
    assert "まし" not in request_message("pl", [(3, "i")])


def test_katakana_loanwords_are_giveaways() -> None:
    assert is_giveaway("ホテル", "hotel")
    assert is_giveaway("ゲーム", "game")
    assert not is_giveaway("映画", "movie")


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


def test_only_a_kept_batch_counts_its_words_as_asked() -> None:
    conn = store.connect(":memory:")
    thin = whole_bank(per_band=MIN_PER_BAND - 1)
    assert not asyncio.run(write_bank(conn, Writer(thin), "pl", lambda: NOW))
    assert store.vocab_asked(conn, "pl") == 0  # kept nothing: asked again, and topped up later
    assert asyncio.run(write_bank(conn, Writer(whole_bank()), "pl", lambda: NOW))
    assert store.vocab_asked(conn, "pl") == len(sample("pl"))


def test_a_top_up_that_keeps_nothing_still_counts_as_asked() -> None:
    conn = store.connect(":memory:")
    ranks = {word: rank for rank, word in sample("pl")}
    stored = [
        VocabItem(w["word"], ranks[w["word"]], w["meaning"], tuple(w["wrong"]))
        for w in whole_bank()[:70]
    ]
    store.save_vocab_batch(conn, "pl", stored, 70, NOW, 0.0)
    assert asyncio.run(write_bank(conn, Writer([]), "pl", lambda: NOW))
    assert store.vocab_asked(conn, "pl") == len(sample("pl"))  # not asked again on every visit


def test_a_failed_call_stores_nothing() -> None:
    conn = store.connect(":memory:")
    assert not asyncio.run(write_bank(conn, Writer(VocabFailed("no")), "pl", lambda: NOW))
    assert store.vocab_spending(conn, NOW - timedelta(days=1)) == {}


BILLED = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2


def test_a_failed_call_claude_answered_keeps_its_cost_and_the_bank_is_written_later() -> None:
    conn = store.connect(":memory:")
    refused = Writer(VocabFailed("No words (refusal)", BILLED), whole_bank())
    assert not asyncio.run(write_bank(conn, refused, "pl", lambda: NOW))
    assert store.vocab_items(conn, "pl") == [] and store.vocab_asked(conn, "pl") == 0
    assert store.vocab_spending(conn, NOW - timedelta(days=1)) == {"pl": (1, 2.0)}
    assert asyncio.run(write_bank(conn, refused, "pl", lambda: NOW))
    assert store.vocab_spending(conn, NOW - timedelta(days=1)) == {"pl": (2, 4.0)}


def test_a_failed_top_up_doesnt_count_its_words_as_asked() -> None:
    conn = store.connect(":memory:")
    ranks = {word: rank for rank, word in sample("pl")}
    stored = [
        VocabItem(w["word"], ranks[w["word"]], w["meaning"], tuple(w["wrong"]))
        for w in whole_bank()[:70]
    ]
    store.save_vocab_batch(conn, "pl", stored, 70, NOW, 0.0)
    writer = Writer(VocabFailed("No words (max_tokens)", BILLED))
    assert not asyncio.run(write_bank(conn, writer, "pl", lambda: NOW))
    assert store.vocab_asked(conn, "pl") == 70  # the rest are still asked for later
    assert store.vocab_spending(conn, NOW - timedelta(days=1)) == {"pl": (2, 2.0)}


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [("refusal", None), ("max_tokens", '{"words"'), ("end_turn", None), ("end_turn", "not json")],
)
def test_claude_vocab_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    write = claude_vocab(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(VocabFailed) as failed:
        finish(write("pl", [(3, "i")]))
    assert failed.value.usage.output_tokens == 900  # the call is still paid for


def vocab_client(
    writer: Writer | None, deck: list[Entry] | None = None, stored: list[Any] | None = None
) -> TestClient:
    conn = store.connect(":memory:")
    if stored:
        store.save_vocab_batch(conn, "pl", stored, len(stored), NOW, 0.0)
    now = [NOW]
    store.save_snapshot(conn, deck or [], NOW, "pl")
    engine = Engine(conn, None, None, lambda: now[0], random.Random(1))
    c = started(create_app(engine, "open sesame", write_vocab=writer))
    c.now = now  # type: ignore[attr-defined]
    c.conn = conn  # type: ignore[attr-defined]
    return c


def get(c: TestClient, language: str = "pl") -> Any:
    return c.get(f"/api/vocab-check?language={language}", headers=AUTH)


def test_the_first_ask_starts_writing_and_the_next_serves_the_bank() -> None:
    writer = Writer(whole_bank())
    c = vocab_client(writer)
    assert get(c).json() == {"state": "preparing", "items": []}
    ready = get(c).json()
    assert ready["state"] == "ready" and writer.calls == 1
    assert len(ready["items"]) == len(BANDS) * ASKED_PER_BAND  # every stored word is served
    first = ready["items"][0]
    assert set(first) == {"word", "rank", "meaning", "wrong"} and len(first["wrong"]) == 3
    assert get(c).json()["state"] == "ready" and writer.calls == 1  # never written twice


def test_words_already_in_the_deck_are_left_out() -> None:
    bank = whole_bank()
    in_deck = bank[0]["word"]
    c = vocab_client(Writer(bank), [Entry(1, in_deck, "meaning", "mature")])
    get(c)
    words = [i["word"] for i in get(c).json()["items"]]
    assert in_deck not in words and len(words) == len(BANDS) * ASKED_PER_BAND - 1


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


def test_proper_nouns_and_obvious_cognates_are_giveaways() -> None:
    assert is_giveaway("po", "Po")  # a river
    assert is_giveaway("támesis", "Thames")
    assert is_giveaway("legislador", "legislator")
    assert is_giveaway("persona", "person")
    assert is_giveaway("importante", "important")
    assert is_giveaway("aceptar", "to accept")
    assert is_giveaway("comunicación", "communication")
    assert is_giveaway("no", "no")
    assert is_giveaway("sí", "si")  # accents don't hide a match


def test_russian_and_greek_words_are_compared_by_their_latin_spelling() -> None:
    for word, meaning in [
        ("телефон", "telephone"),
        ("президент", "president"),
        ("университет", "university"),
        ("революция", "revolution"),
        ("музыка", "music"),
        ("τηλέφωνο", "telephone"),
        ("πρόβλημα", "problem"),
        ("θέατρο", "theater"),
        ("μουσική", "music"),
    ]:
        assert is_giveaway(word, meaning), word


def test_words_that_need_studying_are_not_giveaways() -> None:
    assert not is_giveaway("alcalde", "mayor")
    assert not is_giveaway("ver", "to see")
    assert not is_giveaway("se", "see")  # shared letters in a short word aren't a cognate
    assert not is_giveaway("tiempo", "time")
    assert not is_giveaway("casa", "house")
    assert not is_giveaway("yo", "I")  # "I" is capitalized but isn't a proper noun
    assert not is_giveaway("работа", "work")
    for word, meaning in [
        ("дом", "house"),
        ("время", "time"),
        ("говорить", "to speak"),
        ("мой", "my"),  # short: sharing a sound isn't a cognate
        ("σπίτι", "house"),
        ("άνθρωπος", "person"),
        ("μιλάω", "to speak"),
    ]:
        assert not is_giveaway(word, meaning), word


def test_giveaways_in_a_stored_bank_are_left_out_when_served() -> None:
    bank = whole_bank()
    bank[0]["meaning"] = "Thames"
    bank[1]["meaning"] = bank[1]["word"]  # a word that is its own meaning
    c = vocab_client(Writer(bank))
    get(c)
    words = [i["word"] for i in get(c).json()["items"]]
    assert bank[0]["word"] not in words and bank[1]["word"] not in words


def test_a_bank_written_with_fewer_words_is_topped_up_with_the_rest() -> None:
    old = [
        VocabItem(w["word"], r, "to see", ("to sleep", "to buy", "house"))
        for (r, _), w in zip(sample("pl"), whole_bank(), strict=False)
    ]
    stored = [i for i in old if i.lemma in {w for _, w in sample("pl")}]
    writer = Writer(whole_bank())
    c = vocab_client(writer)
    store.save_vocab_batch(c.conn, "pl", stored[:70], 70, NOW, 0.0)  # type: ignore[attr-defined]
    before = len(store.vocab_items(c.conn, "pl"))  # type: ignore[attr-defined]
    # The quiz is served at once, and the rest of the sample is written in the background.
    assert get(c).json()["state"] == "ready" and writer.calls == 1
    assert len(store.vocab_items(c.conn, "pl")) > before  # type: ignore[attr-defined]
    assert get(c).json()["state"] == "ready" and writer.calls == 1  # not topped up twice


def test_the_cost_shows_in_the_costs() -> None:
    c = vocab_client(Writer(whole_bank()))
    get(c)
    costs = c.get("/api/costs", headers=AUTH).json()["vocab_checks"]
    assert costs["batches"] == 1 and costs["cost_usd"] == 2.0
    assert costs["languages"] == [
        {"language": "pl", "name": "Polish", "batches": 1, "cost_usd": 2.0}
    ]


def test_a_failed_call_shows_in_the_costs() -> None:
    c = vocab_client(Writer(VocabFailed("No words (refusal)", BILLED)))
    get(c)
    assert get(c).json()["state"] == "failed"
    costs = c.get("/api/costs", headers=AUTH).json()["vocab_checks"]
    assert costs["batches"] == 1 and costs["cost_usd"] == 2.0


def test_a_bank_written_before_the_top_band_is_served_and_topped_up() -> None:
    ranks = {word: rank for rank, word in sample("pl")}
    legacy = [
        VocabItem(w["word"], ranks[w["word"]], w["meaning"], tuple(w["wrong"]))
        for w in whole_bank()
        if band_of(ranks[w["word"]]) != len(BANDS) - 1
    ]
    writer = Writer(whole_bank())
    c = vocab_client(writer, stored=legacy)
    first = get(c).json()  # served as it is, and topped up behind the response
    assert first["state"] == "ready" and not any(i["rank"] > 5000 for i in first["items"])
    assert writer.calls == 1
    assert any(i["rank"] > 5000 for i in get(c).json()["items"])
    assert get(c).json()["state"] == "ready" and writer.calls == 1
