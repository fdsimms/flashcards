import random
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from scripted import IN_RANGE
from scripted import ScriptedModel as AppModel
from test_app import AUTH, started

from franki_reader import level_store, store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.frequency import entry_place
from franki_reader.level import BANDS, HEADLINE, KEEP_DAYS, known_words, level, shares
from franki_reader.lexicon import Entry, lexicon_from

NOW = datetime(2026, 11, 28, 12, 0)

DECK = [
    Entry(1, "comer", "to eat", "mature"),
    Entry(2, "el perro", "dog", "young"),
    Entry(3, "la casa", "house", "young"),
    Entry(4, "el murciélago", "bat", "unreviewed"),  # not studied: not counted
    Entry(5, "echar de menos", "to miss", "mature"),  # a phrase: counted as studied, not placed
]


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


def test_studied_words_are_counted_by_band_and_by_their_share_of_speech() -> None:
    lexicon = lexicon_from(DECK, "es")
    figure = level("es", known_words(DECK), lexicon)
    assert figure is not None
    ranks = {entry_place(w, lexicon).rank for w in ("comer", "el perro", "la casa")}
    assert None not in ranks
    assert figure.studied == 4  # the four studied entries, the phrase among them
    assert sum(b.known for b in figure.bands) == 3
    assert [(b.start, b.end) for b in figure.bands] == list(BANDS)
    assert figure.known_top == sum(1 for r in ranks if r is not None and r <= HEADLINE)
    per_million = shares("es")
    assert per_million is not None
    assert figure.speech == sum(per_million[r - 1] for r in ranks if r is not None) / 1e6


def test_the_common_words_setting_doesnt_count() -> None:
    # Counted as known for texts, but nobody studied them: Your level says what's studied.
    lexicon = lexicon_from([], "es", common=5000)
    figure = level("es", known_words([]), lexicon)
    assert figure is not None
    assert figure.known_top == 0 and figure.speech == 0


def test_wanikani_words_count_for_japanese() -> None:
    lexicon = lexicon_from([], "ja", extra=["食べる"])
    figure = level("ja", known_words([], ["食べる"]), lexicon)
    assert figure is not None and figure.known_top == 1


def test_a_language_with_no_frequency_list_has_no_level() -> None:
    assert level("tok", ["pona"], lexicon_from([], "tok")) is None


def test_every_list_has_its_shares_line_for_line() -> None:
    from franki_reader.spaced import _DATA

    for path in _DATA.glob("*_shares.txt"):
        code = path.name.removesuffix("_shares.txt")
        words = [
            w for w in (_DATA / f"{code}_common.txt").read_text("utf-8").splitlines()
            if w and not w.startswith("#")
        ]  # fmt: skip
        found = shares(code)
        assert found is not None and len(found) == len(words), code
        assert list(found) == sorted(found, reverse=True) or code == "th", code


def client(clock: Clock, snapshot: bool = True) -> tuple[TestClient, Engine]:
    conn = store.connect(":memory:")
    if snapshot:
        store.save_snapshot(conn, DECK, NOW, "es")
    engine = Engine(conn, AppModel(IN_RANGE).ask_for, None, clock, random.Random(1))
    return started(create_app(engine, "open sesame")), engine


def test_the_page_gets_bands_and_a_day_by_day_trend() -> None:
    clock = Clock()
    c, _ = client(clock)
    got = c.get("/api/level", params={"language": "es"}, headers=AUTH)
    assert got.status_code == 200
    body = got.json()
    assert body["top"] == HEADLINE and body["studied"] == 4
    assert [b["start"] for b in body["bands"]] == [a for a, _ in BANDS]
    assert len(body["history"]) == 1
    # Opened again the same day: still one figure for it. A day later: a second.
    c.get("/api/level", params={"language": "es"}, headers=AUTH)
    clock.now = NOW + timedelta(days=1)
    body = c.get("/api/level", params={"language": "es"}, headers=AUTH).json()
    assert [h["day"] for h in body["history"]] == ["2026-11-28", "2026-11-29"]


def test_the_top_up_pass_keeps_a_figure_once_a_day() -> None:
    clock = Clock()
    _, engine = client(clock)
    assert engine.note_level("es") is not None
    assert engine.note_level("es") is None  # already kept today
    assert len(level_store.history(engine.conn, "es")) == 1


def test_figures_older_than_a_year_are_dropped() -> None:
    clock = Clock()
    _, engine = client(clock)
    figure = engine.level("es")
    assert figure is not None
    level_store.keep(engine.conn, "es", (NOW - timedelta(days=KEEP_DAYS + 5)).date(), figure)
    level_store.keep(engine.conn, "es", NOW.date(), figure)
    assert [d.day for d in level_store.history(engine.conn, "es")] == [NOW.date()]


def test_before_the_deck_is_read_and_for_toki_pona_it_says_so() -> None:
    c, _ = client(Clock(), snapshot=False)
    assert c.get("/api/level", params={"language": "es"}, headers=AUTH).status_code == 409
    assert c.get("/api/level", params={"language": "tok"}, headers=AUTH).status_code == 404
    assert c.get("/api/level", params={"language": "es"}).status_code == 401
