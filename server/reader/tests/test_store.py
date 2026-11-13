import asyncio
from datetime import datetime, timedelta

import pytest
from fake_anki import FakeDeck, card, note

from franki_reader.gateway import AnkiUnavailable, with_timeout
from franki_reader.languages import LANGUAGES, Language
from franki_reader.lexicon import Entry
from franki_reader.store import (
    Settings,
    add_topic,
    connect,
    get_text,
    is_stale,
    load_settings,
    load_snapshot,
    refresh_if_stale,
    save_settings,
    save_snapshot,
    save_text,
)

NOW = datetime(2026, 10, 19, 9, 0)
OLD = [Entry(1, "ฉัน", "I; me", "mature")]


@pytest.fixture
def conn():  # type: ignore[no-untyped-def]
    return connect(":memory:")


def test_round_trip(conn) -> None:  # type: ignore[no-untyped-def]
    save_snapshot(conn, OLD, NOW)
    assert load_snapshot(conn) == (OLD, NOW)


def test_transliterations_survive_a_round_trip(conn) -> None:  # type: ignore[no-untyped-def]
    entries = [Entry(1, "หนังสือ", "book", "mature", translit="nǎng-sǔue")]
    save_snapshot(conn, entries, NOW)
    assert load_snapshot(conn)[0][0].translit == "nǎng-sǔue"


def test_a_snapshot_from_before_transliterations_is_refreshed(tmp_path) -> None:  # type: ignore[no-untyped-def]
    import sqlite3

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE lexicon (note_id INTEGER PRIMARY KEY, entry TEXT NOT NULL,"
        " meaning TEXT NOT NULL, tier TEXT NOT NULL, due INTEGER NOT NULL DEFAULT 0,"
        " language TEXT NOT NULL DEFAULT 'th');"
        "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
        "INSERT INTO lexicon VALUES (1, 'ฉัน', 'I; me', 'mature', 0, 'th');"
        "INSERT INTO meta VALUES ('snapshot_taken_at', '2026-10-19T09:00:00');"
    )
    old.commit()
    old.close()
    migrated = connect(path)
    entries, taken_at = load_snapshot(migrated)
    # The words still serve, but the missing time makes the next refresh read the deck again.
    assert [e.text for e in entries] == ["ฉัน"]
    assert is_stale(taken_at, NOW)


def test_a_new_snapshot_replaces_the_old_one(conn) -> None:  # type: ignore[no-untyped-def]
    save_snapshot(conn, OLD, NOW)
    save_snapshot(conn, [Entry(2, "ดี", "good", "young")], NOW)
    assert [e.text for e in load_snapshot(conn)[0]] == ["ดี"]


def test_staleness() -> None:
    assert is_stale(None, NOW)
    assert not is_stale(NOW - timedelta(hours=23), NOW)
    assert is_stale(NOW - timedelta(hours=24), NOW)


def test_refreshes_when_stale(conn) -> None:  # type: ignore[no-untyped-def]
    anki = FakeDeck([note(2, "ดี", "good")], [card(2, 2, 30)])
    assert asyncio.run(refresh_if_stale(conn, anki, NOW))
    assert load_snapshot(conn) == ([Entry(2, "ดี", "good", "mature")], NOW)


def test_does_not_call_anki_when_fresh(conn) -> None:  # type: ignore[no-untyped-def]
    save_snapshot(conn, OLD, NOW - timedelta(hours=1))
    anki = FakeDeck([], [])
    assert not asyncio.run(refresh_if_stale(conn, anki, NOW))
    assert anki.reads == []


def test_keeps_yesterdays_snapshot_when_anki_hangs(conn) -> None:  # type: ignore[no-untyped-def]
    save_snapshot(conn, OLD, NOW - timedelta(days=1))

    async def hangs(language: Language) -> list[Entry]:
        await asyncio.sleep(10)
        return []

    assert not asyncio.run(refresh_if_stale(conn, with_timeout(hangs, seconds=0.01), NOW))
    assert load_snapshot(conn) == (OLD, NOW - timedelta(days=1))


def test_keeps_the_old_snapshot_when_anki_returns_nothing(conn) -> None:  # type: ignore[no-untyped-def]
    save_snapshot(conn, OLD, NOW - timedelta(days=1))
    assert not asyncio.run(refresh_if_stale(conn, FakeDeck([], []), NOW))
    assert load_snapshot(conn)[0] == OLD


def test_any_failure_becomes_anki_unavailable() -> None:
    async def breaks(language: Language) -> list[Entry]:
        raise ConnectionError("server down")

    async def call() -> list[Entry]:
        return await with_timeout(breaks)(LANGUAGES["th"])

    with pytest.raises(AnkiUnavailable, match="server down"):
        asyncio.run(call())


def test_the_default_timeout_is_45_seconds() -> None:
    from franki_reader.gateway import TIMEOUT_SECONDS

    assert TIMEOUT_SECONDS == 45


def test_a_failed_read_keeps_the_old_snapshot(conn) -> None:  # type: ignore[no-untyped-def]
    save_snapshot(conn, OLD, NOW - timedelta(days=1))

    async def breaks(language: Language) -> list[Entry]:
        raise ConnectionError("server down")

    assert not asyncio.run(refresh_if_stale(conn, with_timeout(breaks), NOW))
    assert load_snapshot(conn)[0] == OLD


def test_settings_default_to_choosing_stretch_words_and_round_trip(conn) -> None:  # type: ignore[no-untyped-def]
    assert load_settings(conn) == Settings(stretch_words="topic")
    save_settings(conn, Settings(stretch_words="any"))
    assert load_settings(conn).stretch_words == "any"


def test_a_setting_that_no_longer_exists_is_ignored(conn) -> None:  # type: ignore[no-untyped-def]
    conn.execute("INSERT INTO meta (key, value) VALUES ('settings', '{\"retired\": 1}')")
    assert load_settings(conn) == Settings()


def test_a_text_keeps_its_speakers_roles(conn) -> None:  # type: ignore[no-untyped-def]
    from test_generator import GOOD, MANGO, ScriptedModel, run

    from franki_reader.generator import TextRequest

    generated = run(ScriptedModel(GOOD), TextRequest("food", (MANGO,)))
    topic = add_topic(conn, "food", True, NOW)
    text_id = save_text(conn, topic.id, generated, [], 0.95, NOW)
    stored = get_text(conn, text_id)
    assert stored is not None and stored.roles == {"A": "Vendor", "B": "Customer"}


def test_a_text_keeps_each_lines_register_and_an_older_one_has_none(conn) -> None:  # type: ignore[no-untyped-def]
    from dataclasses import replace

    from test_generator import GOOD, MANGO, ScriptedModel, run

    from franki_reader.generator import Line, TextRequest

    generated = run(ScriptedModel(GOOD), TextRequest("food", (MANGO,)))
    lines = (replace(generated.lines[0], register="casual"), generated.lines[1])
    topic = add_topic(conn, "food", True, NOW)
    text_id = save_text(conn, topic.id, replace(generated, lines=lines), [], 0.95, NOW)
    stored = get_text(conn, text_id)
    assert stored is not None and [ln.register for ln in stored.lines] == ["casual", ""]
    # A row written before the field has no key for it, and still loads.
    conn.execute(
        "UPDATE texts SET lines = ? WHERE id = ?",
        ('[{"speaker": "A", "text": "ฉัน", "english": "I.", "paragraph": false}]', text_id),
    )
    old = get_text(conn, text_id)
    assert old is not None and old.lines == (Line("A", "ฉัน", "I.", False, ""),)


def test_a_naturalness_answer_is_kept_per_line(conn) -> None:  # type: ignore[no-untyped-def]
    from test_generator import GOOD, MANGO, ScriptedModel, run

    from franki_reader.generator import TextRequest
    from franki_reader.store import get_naturalness, save_naturalness

    generated = run(ScriptedModel(GOOD), TextRequest("food", (MANGO,)))
    text_id = save_text(conn, add_topic(conn, "food", True, NOW).id, generated, [], 0.95, NOW)
    answer = {"verdict": "stiff", "reason": "Too written.", "alternative": "ฉัน กิน"}
    assert get_naturalness(conn, text_id, 0) is None
    save_naturalness(conn, text_id, 0, answer, NOW, 0.01)
    assert get_naturalness(conn, text_id, 0) == answer
    assert get_naturalness(conn, text_id, 1) is None


def test_a_text_keeps_its_speakers_characters(conn) -> None:  # type: ignore[no-untyped-def]
    from test_generator import GOOD, MANGO, ScriptedModel, run

    from franki_reader.generator import TextRequest

    generated = run(ScriptedModel(GOOD), TextRequest("food", (MANGO,)))
    topic = add_topic(conn, "food", True, NOW)
    stored = get_text(conn, save_text(conn, topic.id, generated, [], 0.95, NOW))
    assert stored is not None
    assert stored.characters == {"A": "shopkeeper", "B": "friend"}
    assert stored.genders == {"A": "male", "B": "male"}


def test_a_database_from_before_characters_gains_the_column(tmp_path) -> None:  # type: ignore[no-untyped-def]
    path = tmp_path / "old.db"
    first = connect(path)
    first.execute("ALTER TABLE texts DROP COLUMN characters")
    first.commit()
    first.close()
    columns = {r[1] for r in connect(path).execute("PRAGMA table_info(texts)")}
    assert "characters" in columns


def test_a_database_from_before_roles_gains_the_column(tmp_path) -> None:  # type: ignore[no-untyped-def]
    path = tmp_path / "old.db"
    first = connect(path)
    first.execute("ALTER TABLE texts DROP COLUMN roles")
    first.commit()
    first.close()
    columns = {r[1] for r in connect(path).execute("PRAGMA table_info(texts)")}
    assert "roles" in columns


def test_practiced_days_are_the_owners_study_days(conn) -> None:  # type: ignore[no-untyped-def]
    from datetime import timezone

    from scripted import GOOD

    from franki_reader.coverage import check
    from franki_reader.generator import Generated, Line
    from franki_reader.lexicon import lexicon_from
    from franki_reader.store import Reading, log_reading, practiced_days

    bangkok = timezone(timedelta(hours=7))
    topic = add_topic(conn, "Food", True, NOW)
    lines = tuple(Line(ln["speaker"], ln["text"], ln["english"]) for ln in GOOD["lines"])
    generated = Generated(
        "t", lines, {}, check([ln.text for ln in lines], lexicon_from(OLD)), 1, True, ()
    )

    def reading_at(at: datetime) -> None:
        text_id = save_text(conn, topic.id, generated, ["ข้าว"], 0.95, at)
        log_reading(conn, text_id, Reading(None, True, (), (), None, False, 10), at)

    # 06:30 and 07:30 in Bangkok on the 19th, an hour apart either side of UTC's midnight: one day.
    reading_at(datetime(2026, 10, 18, 23, 30))
    reading_at(datetime(2026, 10, 19, 0, 30))
    later = datetime(2026, 10, 25, 9)
    assert practiced_days(conn, later, "th", 4, bangkok) == {"ข้าว": 1}
    # 03:30 in Bangkok on the 19th is before 4 AM, so still the 18th's study day: another day.
    reading_at(datetime(2026, 10, 18, 20, 30))
    assert practiced_days(conn, later, "th", 4, bangkok) == {"ข้าว": 2}


def test_a_word_marked_again_after_clearing_is_listed_again(conn) -> None:  # type: ignore[no-untyped-def]
    from scripted import GOOD

    from franki_reader.coverage import check
    from franki_reader.generator import Generated, Line
    from franki_reader.lexicon import lexicon_from
    from franki_reader.store import Reading, clear_word, log_reading, marked_words

    topic = add_topic(conn, "Food", True, NOW)
    lines = tuple(Line(ln["speaker"], ln["text"], ln["english"]) for ln in GOOD["lines"])
    coverage = check([ln.text for ln in lines], lexicon_from(OLD))
    generated = Generated("t", lines, {"ทอน": "change"}, coverage, 1, True, ())

    def reading_at(at: datetime) -> None:
        text_id = save_text(conn, topic.id, generated, [], 0.95, at)
        log_reading(conn, text_id, Reading(None, True, (), ("ทอน",), None, False, 10), at)

    reading_at(NOW)
    clear_word(conn, "ทอน", NOW + timedelta(minutes=1))
    assert marked_words(conn) == []

    reading_at(NOW + timedelta(days=1))
    [word] = marked_words(conn)
    assert (word.word, word.times, word.glosses["ทอน"]) == ("ทอน", 1, "change")


def test_a_database_from_before_removing_topics_gains_the_column(tmp_path) -> None:  # type: ignore[no-untyped-def]
    import sqlite3

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.execute(
        "CREATE TABLE topics (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,"
        " favorite INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)"
    )
    old.execute("INSERT INTO topics (name, created_at) VALUES ('Taxi', '2026-10-19')")
    old.commit()
    old.close()

    from franki_reader.store import list_topics

    assert [t.name for t in list_topics(connect(path))] == ["Taxi"]


def test_a_database_from_before_stories_reads_its_texts_as_dialogues(tmp_path) -> None:  # type: ignore[no-untyped-def]
    import sqlite3

    path = tmp_path / "old.db"
    conn = connect(path)
    topic = add_topic(conn, "Food", True, NOW)
    conn.execute("ALTER TABLE texts DROP COLUMN form")
    conn.execute(
        "INSERT INTO texts (topic_id, created_at, title, lines, glosses, stretch, coverage,"
        " token_count, floor, attempts, model, input_tokens, output_tokens, cache_read_tokens,"
        " cache_write_tokens, cost_usd) VALUES (?, '2026-10-19', 't', '[]', '{}', '[]', 1, 0,"
        " 0.95, 1, 'm', 0, 0, 0, 0, 0)",
        (topic.id,),
    )
    conn.commit()
    conn.close()
    assert "form" not in {r[1] for r in sqlite3.connect(path).execute("PRAGMA table_info(texts)")}

    text = get_text(connect(path), 1)
    assert text is not None and text.form == "dialogue"


def test_spending_counts_every_text_written_since_the_date_by_language(conn) -> None:  # type: ignore[no-untyped-def]
    from dataclasses import replace

    from scripted import GOOD

    from franki_reader.coverage import check
    from franki_reader.generator import Generated, Line, Usage
    from franki_reader.lexicon import lexicon_from
    from franki_reader.store import Reading, log_reading, spending

    topic = add_topic(conn, "Food", True, NOW)
    lines = tuple(Line(ln["speaker"], ln["text"], ln["english"]) for ln in GOOD["lines"])
    base = Generated(
        "t", lines, {}, check([ln.text for ln in lines], lexicon_from(OLD)), 1, True, ()
    )
    # $0.01 an attempt: 1,000 output tokens at Sonnet's $10 a million.
    one = Usage(output_tokens=1000)

    def write(attempts: int, at: datetime, status: str = "ready", language: str = "th") -> int:
        generated = replace(base, attempts=attempts, usage=Usage(output_tokens=1000 * attempts))
        return save_text(conn, topic.id, generated, [], 0.95, at, status=status, language=language)  # type: ignore[arg-type]

    read_id = write(1, NOW)
    log_reading(conn, read_id, Reading(None, True, (), (), None, False, 10), NOW)
    write(3, NOW, status="dropped")
    write(2, NOW, status="pending")
    write(1, NOW - timedelta(days=40))  # before the date: left out
    write(1, NOW, language="es")

    assert one.cost_usd() == pytest.approx(0.01)
    spent = spending(conn, NOW - timedelta(days=30))
    assert list(spent) == ["th", "es"]  # the most spent first
    th = spent["th"]
    assert (th.read, th.waiting, th.dropped, th.texts, th.attempts) == (1, 1, 1, 3, 6)
    assert th.cost_usd == pytest.approx(0.06)
    es = spent["es"]
    assert (es.read, es.waiting, es.dropped, es.attempts) == (0, 1, 0, 1)
    assert es.cost_usd == pytest.approx(0.01)
    assert spending(conn, NOW + timedelta(days=1)) == {}


def test_only_a_served_text_becomes_read(conn) -> None:  # type: ignore[no-untyped-def]
    from franki_reader.coverage import Coverage
    from franki_reader.generator import Generated
    from franki_reader.store import Reading, log_reading, spending, text_status

    topic = add_topic(conn, "Food", True, NOW)
    empty = Generated("t", (), {}, Coverage((), ()), 1, True, ())
    ids = {
        status: save_text(conn, topic.id, empty, [], 0.95, NOW, status=status)
        for status in ("ready", "dropped", "skipped")
    }
    for text_id in ids.values():
        log_reading(conn, text_id, Reading(None, True, (), (), None, False, 10), NOW)

    assert {s: text_status(conn, i) for s, i in ids.items()} == {
        "ready": "read",
        "dropped": "dropped",
        "skipped": "skipped",
    }
    th = spending(conn, NOW - timedelta(days=1))["th"]
    assert (th.read, th.dropped, th.skipped) == (1, 1, 1)
