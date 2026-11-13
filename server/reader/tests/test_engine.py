import asyncio
import random
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from scripted import BAD, ENTRIES, IN_RANGE, ScriptedModel

from franki_reader import store
from franki_reader.difficulty import Difficulty
from franki_reader.engine import (
    FAILURE_COOLDOWN,
    MISSED_FLOOR,
    SHELF_SIZE,
    Engine,
    NotAvailable,
    NotFound,
)
from franki_reader.generator import GenerationFailed, Usage
from franki_reader.lexicon import Entry
from franki_reader.store import Reading, StoredText

NOW = datetime(2026, 10, 19, 9, 0)


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


def engine(
    model: ScriptedModel | None, with_lexicon: bool = True, clock: Clock | None = None
) -> Engine:
    conn = store.connect(":memory:")
    if with_lexicon:
        store.save_snapshot(conn, ENTRIES, NOW)
    return Engine(conn, model.ask_for if model else None, None, clock or Clock(), random.Random(1))


def run(scenario: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(scenario())  # type: ignore[arg-type]


async def settle(e: Engine) -> None:
    """Lets every background write finish."""
    while e._tasks:
        await asyncio.gather(*list(e._tasks))


async def fetch(e: Engine, topic_id: int) -> StoredText:
    """What the app does: ask, and ask again once a background write has finished."""
    for _ in range(5):
        text = await e.next_text(topic_id)
        if text is not None:
            return text
        await settle(e)
    raise AssertionError("no text")


def reading(rating: str | None) -> Reading:
    return Reading(rating, True, (), (), 1.0, False, 120)


def test_asking_for_a_topic_with_nothing_ready_writes_one_in_the_background() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)

    async def scenario() -> tuple[StoredText | None, str, StoredText]:
        first = await e.next_text(topic.id)
        state = e.topic_state(store.get_topic(e.conn, topic.id))  # type: ignore[arg-type]
        return first, state, await fetch(e, topic.id)

    first, state, text = run(scenario)

    assert first is None
    assert state == "writing"
    assert text.title == "At the stall"
    assert text.stretch == ("ข้าวเหนียวมะม่วง",)
    assert model.calls == 1


def test_asking_again_while_writing_does_not_start_a_second_write() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)

    async def scenario() -> None:
        assert await e.next_text(topic.id) is None
        assert await e.next_text(topic.id) is None
        await settle(e)

    run(scenario)
    assert model.calls == 1
    assert store.get_topic(e.conn, topic.id).ready == 1  # type: ignore[union-attr]


def test_a_caller_waiting_on_the_lock_takes_the_text_just_written() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)

    async def scenario() -> tuple[StoredText | None, StoredText | None]:
        a, b = await asyncio.gather(e.make_text(topic.id), e.make_text(topic.id))
        return a, b

    a, b = run(scenario)
    assert a is not None and b is not None and a.id == b.id
    assert model.calls == 1


def test_a_ready_text_is_served_without_calling_the_model() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    made = run(lambda: e.make_text(topic.id))

    served = run(lambda: e.next_text(topic.id))

    assert served is not None and served.id == made.id
    assert model.calls == 1


def test_a_text_that_misses_the_floor_is_reported_once_then_retried() -> None:
    model = ScriptedModel(BAD)
    e = engine(model)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)

    async def scenario() -> None:
        assert await e.next_text(topic.id) is None
        await settle(e)
        with pytest.raises(NotAvailable, match="Couldn't write a text that fits"):
            await e.next_text(topic.id)
        assert e.topic_state(store.get_topic(e.conn, topic.id)) == "failed"  # type: ignore[arg-type]
        assert await e.next_text(topic.id) is None  # asking again is a deliberate retry
        await settle(e)

    run(scenario)
    assert store.get_topic(e.conn, topic.id).ready == 0  # type: ignore[union-attr]
    assert model.calls == 6


def test_a_dropped_text_is_kept_for_its_cost_but_never_served() -> None:
    e = engine(ScriptedModel(BAD))
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    assert run(lambda: e.make_text(topic.id)) is None
    rows = e.conn.execute("SELECT status, cost_usd FROM texts").fetchall()
    assert len(rows) == 1 and rows[0][0] == "dropped" and rows[0][1] > 0
    assert store.next_ready_text(e.conn, topic.id) is None


def test_a_revision_that_fails_still_stores_the_dropped_text_for_its_cost() -> None:
    e = engine(ScriptedModel(BAD, GenerationFailed("The response was cut off")))
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    assert run(lambda: e.make_text(topic.id)) is None
    rows = e.conn.execute("SELECT status, cost_usd FROM texts").fetchall()
    assert len(rows) == 1 and rows[0][0] == "dropped" and rows[0][1] > 0


def test_a_first_attempt_that_fails_with_an_answer_is_stored_dropped_for_its_cost() -> None:
    cut_off = GenerationFailed("The response was cut off", Usage(100, 500, 2000, 0))
    e = engine(ScriptedModel(cut_off))
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    with pytest.raises(GenerationFailed, match="cut off"):
        run(lambda: e.make_text(topic.id))
    rows = e.conn.execute("SELECT status, attempts, cost_usd FROM texts").fetchall()
    assert len(rows) == 1 and rows[0][:2] == ("dropped", 1) and rows[0][2] > 0
    assert store.next_ready_text(e.conn, topic.id) is None
    spent = store.spending(e.conn, NOW - timedelta(days=1))["th"]
    assert (spent.dropped, spent.texts) == (1, 1)
    assert spent.cost_usd == pytest.approx(rows[0][2])


def test_a_claude_error_is_reported_to_the_next_request() -> None:
    e = engine(ScriptedModel(IN_RANGE))

    def failing(entries: Any, language: Any) -> Any:
        async def ask(messages: Any) -> Any:
            raise GenerationFailed("Claude didn't answer (APIConnectionError)")

        return ask

    e.ask_for = failing
    topic = store.add_topic(e.conn, "Food stall", True, NOW)

    async def scenario() -> None:
        await e.next_text(topic.id)
        await settle(e)
        with pytest.raises(NotAvailable, match="APIConnectionError"):
            await e.next_text(topic.id)

    run(scenario)
    # No answer, no cost: nothing to keep on record.
    assert e.conn.execute("SELECT COUNT(*) FROM texts").fetchone()[0] == 0


def test_says_what_is_missing() -> None:
    no_key = engine(None)
    topic = store.add_topic(no_key.conn, "Food stall", True, NOW)
    with pytest.raises(NotAvailable, match="no Claude API key"):
        run(lambda: no_key.next_text(topic.id))

    no_words = engine(ScriptedModel(IN_RANGE), with_lexicon=False)
    topic = store.add_topic(no_words.conn, "Food stall", True, NOW)
    with pytest.raises(NotAvailable, match="no Thai word list"):
        run(lambda: no_words.next_text(topic.id))


def test_an_unknown_topic_is_not_found() -> None:
    with pytest.raises(NotFound):
        run(lambda: engine(ScriptedModel(IN_RANGE)).next_text(99))


def test_top_up_fills_the_shelf_with_one_of_each_kind_in_both_forms() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    store.add_topic(e.conn, "Food stall", True, NOW)
    store.add_topic(e.conn, "Taxi", True, NOW)

    run(e.top_up)
    run(e.top_up)  # full: nothing more is written

    shelf = store.shelf_texts(e.conn, "th")
    assert model.calls == SHELF_SIZE == len(shelf)
    assert [t.reason for t in shelf] == ["due", "liked", "new"]
    assert [t.form for t in shelf] == ["dialogue", "story", "dialogue"]
    # The idea is filed away: not listed as a topic, and not offered again.
    new = store.topic_name(e.conn, shelf[2].topic_id)
    assert [t.name for t in store.list_topics(e.conn)] == ["Food stall", "Taxi"]
    assert new in store.topic_names(e.conn)


def test_a_text_taken_off_the_shelf_is_replaced_and_counted_as_skipped() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    run(e.top_up)
    first = store.shelf_texts(e.conn, "th")[0]

    assert store.skip_text(e.conn, first.id)
    assert not store.skip_text(e.conn, first.id)  # already off the shelf
    run(e.top_up)

    assert len(store.shelf_texts(e.conn, "th")) == SHELF_SIZE
    assert first.id not in {t.id for t in store.shelf_texts(e.conn, "th")}
    assert store.spending(e.conn, NOW)["th"].skipped == 1


def test_a_failed_shelf_text_ends_the_pass_and_its_topic_cools_down() -> None:
    clock = Clock()
    model = ScriptedModel(BAD, BAD, BAD, IN_RANGE)
    e = engine(model, clock=clock)
    market = store.add_topic(e.conn, "At the market", True, NOW)

    run(e.top_up)  # the due-words text, on the only liked theme, misses three times
    assert model.calls == 3
    assert store.shelf_texts(e.conn, "th") == []
    assert e.failure(market.id, "th") == MISSED_FLOOR

    run(e.top_up)  # the shelf waits out the cooldown rather than trying another idea
    assert model.calls == 3

    clock.now = NOW + FAILURE_COOLDOWN
    assert e.failure(market.id, "th") is None
    run(e.top_up)
    assert len(store.shelf_texts(e.conn, "th")) == SHELF_SIZE


def test_a_text_asked_for_joins_the_shelf_beyond_its_size() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    run(e.top_up)

    async def scenario() -> None:
        e.write_about("Haggling at a market", "story")
        await settle(e)

    run(scenario)
    shelf = store.shelf_texts(e.conn, "th")
    assert len(shelf) == SHELF_SIZE + 1
    asked = shelf[-1]
    assert (asked.reason, asked.form) == ("asked", "story")
    assert store.topic_name(e.conn, asked.topic_id) == "Haggling at a market"
    with pytest.raises(ValueError):
        e.write_about("   ", "dialogue")


def test_a_story_keeps_its_cast_and_each_episode_hears_the_ones_before() -> None:
    first = {
        **IN_RANGE,
        "series": "Noi's stall",
        "cast": "Noi sells noodles.",
        "recap": "Noi opens.",
    }
    second = {**IN_RANGE, "recap": "It rains on Noi."}
    model = ScriptedModel(first, second)
    e = engine(model)

    async def start() -> int:
        story = e.start_story("a noodle stall")
        await settle(e)
        return story.id

    story_id = run(start)
    story = store.get_story(e.conn, story_id)
    assert story is not None and (story.title, story.cast) == ("Noi's stall", "Noi sells noodles.")
    episode = store.waiting_episode(e.conn, story_id)
    assert episode is not None and (episode.episode, episode.recap) == (1, "Noi opens.")
    assert episode.reason == "story" and episode.form == "story"
    assert "first episode" in model.messages_seen[0][0]["content"]
    assert "a noodle stall" in model.messages_seen[0][0]["content"]
    # Waiting episodes aren't on the shelf, and a second isn't written while one waits.
    assert episode.id not in {t.id for t in store.shelf_texts(e.conn, "th")}

    e.record_reading(episode.id, reading(None))
    calls = model.calls
    run(e.top_up)
    nxt = store.waiting_episode(e.conn, story_id)
    assert nxt is not None and (nxt.episode, nxt.recap) == (2, "It rains on Noi.")
    asked = model.messages_seen[calls][0]["content"]
    assert 'episode 2 of an ongoing story, "Noi\'s stall"' in asked
    assert "Noi opens." in asked and "Noi sells noodles." in asked

    run(e.top_up)  # episode 2 is waiting: no third
    assert [t.episode for t in store.episodes(e.conn, story_id)] == [1, 2]


def test_a_new_story_retires_the_old_one() -> None:
    e = engine(ScriptedModel(IN_RANGE))

    async def scenario() -> tuple[int, int]:
        old = e.start_story("")
        await settle(e)
        new = e.start_story("a haunted house")
        await settle(e)
        return old.id, new.id

    old, new = run(scenario)
    active = store.active_story(e.conn, "th")
    assert active is not None and active.id == new != old


def test_top_up_stops_quietly_without_a_key() -> None:
    e = engine(None)
    store.add_topic(e.conn, "Food stall", True, NOW)
    run(e.top_up)  # no exception
    assert e.topic_state(store.list_topics(e.conn)[0]) == "idle"


def test_the_difficulty_follows_the_rating() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: fetch(e, topic.id))

    e.record_reading(text.id, reading("too_hard"))

    assert store.load_difficulty(e.conn) == Difficulty(0.93, 1)
    assert store.get_topic(e.conn, topic.id).ready == 0  # type: ignore[union-attr]


def test_a_repeated_reading_is_ignored() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: fetch(e, topic.id))

    e.record_reading(text.id, reading("too_hard"))
    e.record_reading(text.id, reading("too_hard"))

    assert store.load_difficulty(e.conn) == Difficulty(0.93, 1)
    assert e.conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0] == 1


def test_a_reading_without_a_rating_leaves_difficulty_alone() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: fetch(e, topic.id))
    e.record_reading(text.id, reading(None))
    assert store.load_difficulty(e.conn) == Difficulty()


def test_reading_an_unknown_text_is_not_found() -> None:
    with pytest.raises(NotFound):
        engine(ScriptedModel(IN_RANGE)).record_reading(42, reading(None))


def test_the_missed_floor_message_is_plain() -> None:
    assert "Try again or pick another topic" in MISSED_FLOOR


class FakeVoice:
    def __init__(self, fail_on: str | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self.fail_on = fail_on

    async def __call__(self, text: str, voice: str) -> bytes:
        from franki_reader.tts import TtsFailed

        self.calls.append((text, voice))
        if text == self.fail_on:
            raise TtsFailed("Azure answered 500")
        return f"mp3:{text}".encode()


def speaking_engine(tmp_path: Path, voice: FakeVoice | None) -> Engine:
    from franki_reader.tts import AudioCache

    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    return Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        Clock(),
        random.Random(1),
        synthesize=voice,
        audio=AudioCache(tmp_path),
        voices={"male": "voice-a", "male2": "voice-b", "female": "voice-c"},
    )


def test_a_new_text_gets_audio_for_each_line_in_its_speakers_voice(tmp_path: Path) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)

    text = run(lambda: fetch(e, topic.id))

    assert voice.calls == [
        # The scripted text is two men: the second speaker reads in the second man's voice.
        ("ฉันอยากกินข้าวเหนียวมะม่วงครับฉันอยากกินทอนครับ", "voice-a"),
        ("ข้าวเหนียวมะม่วงครับ!ฉันอยากกินครับฉันอยากกินครับ", "voice-b"),
    ]
    assert e.has_audio(text.id, 0) and e.has_audio(text.id, 1)


def test_a_text_is_not_ready_until_its_audio_is_made(tmp_path: Path) -> None:
    seen: list[str | None] = []
    e = speaking_engine(tmp_path, None)

    async def voice(text: str, name: str) -> bytes:
        seen.append(store.text_status(e.conn, 1))
        return b"mp3"

    e.synthesize = voice
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    run(lambda: e.make_text(topic.id))

    assert seen == ["pending", "pending"]
    assert store.text_status(e.conn, 1) == "ready"


def test_a_pending_text_left_by_a_restart_becomes_ready(tmp_path: Path) -> None:
    db = tmp_path / "t.db"
    e = engine(ScriptedModel(IN_RANGE))
    e.conn = store.connect(db)
    store.save_snapshot(e.conn, ENTRIES, NOW)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    run(lambda: e.make_text(topic.id))
    e.conn.execute("UPDATE texts SET status = 'pending'")
    e.conn.commit()

    assert store.text_status(store.connect(db), 1) == "ready"


def test_a_failed_line_stays_silent_and_the_text_is_still_served(tmp_path: Path) -> None:
    e = speaking_engine(tmp_path, FakeVoice(fail_on="ข้าวเหนียวมะม่วงครับ!ฉันอยากกินครับฉันอยากกินครับ"))
    topic = store.add_topic(e.conn, "Food stall", True, NOW)

    text = run(lambda: fetch(e, topic.id))

    assert e.has_audio(text.id, 0)
    assert not e.has_audio(text.id, 1)


def test_missing_audio_is_made_on_request_and_then_cached(tmp_path: Path) -> None:
    e = speaking_engine(tmp_path, None)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: fetch(e, topic.id))
    assert run(lambda: e.line_audio(text, 0)) is None  # no text to speech yet

    voice = FakeVoice()
    e.synthesize = voice
    path = run(lambda: e.line_audio(text, 0))
    again = run(lambda: e.line_audio(text, 0))

    assert path is not None and path.read_bytes().startswith(b"mp3:")
    assert again == path
    assert len(voice.calls) == 1
    assert run(lambda: e.line_audio(text, 9)) is None


def audio_chars(e: Engine, text_id: int) -> int:
    return int(
        e.conn.execute("SELECT audio_chars FROM texts WHERE id = ?", (text_id,)).fetchone()[0]
    )


def test_the_characters_azure_speaks_for_a_text_are_counted(tmp_path: Path) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)

    text = run(lambda: fetch(e, topic.id))
    spoken = sum(len(t) for t, _ in voice.calls)

    assert spoken > 0 and audio_chars(e, text.id) == spoken
    # A line already cached isn't spoken again, so it isn't counted again.
    run(lambda: e.line_audio(text, 0))
    assert audio_chars(e, text.id) == spoken
    # A re-recording is billed again, and counts again.
    e.audio.drop(text.id)  # type: ignore[union-attr]
    run(lambda: e.make_audio(text))
    assert audio_chars(e, text.id) == spoken * 2


def test_a_line_azure_refused_is_not_counted(tmp_path: Path) -> None:
    refused = "ข้าวเหนียวมะม่วงครับ!ฉันอยากกินครับฉันอยากกินครับ"
    voice = FakeVoice(fail_on=refused)
    e = speaking_engine(tmp_path, voice)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)

    text = run(lambda: fetch(e, topic.id))

    counted = sum(len(t) for t, _ in voice.calls if t != refused)
    assert audio_chars(e, text.id) == counted > 0


def test_audio_recorded_before_counting_is_estimated_once_from_the_volume(tmp_path: Path) -> None:
    e = speaking_engine(tmp_path, FakeVoice())
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: fetch(e, topic.id))
    counted = audio_chars(e, text.id)
    e.conn.execute("UPDATE texts SET audio_chars = 0")  # as before this was recorded
    e.conn.commit()

    e.count_existing_audio()
    assert audio_chars(e, text.id) == counted

    # Done once: later audio isn't added to a count it's already in.
    e.conn.execute("UPDATE texts SET audio_chars = 5")
    e.conn.commit()
    e.count_existing_audio()
    assert audio_chars(e, text.id) == 5


def test_spending_adds_up_each_languages_audio_characters(tmp_path: Path) -> None:
    e = speaking_engine(tmp_path, FakeVoice())
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: fetch(e, topic.id))

    spent = store.spending(e.conn, datetime(2020, 1, 1))

    assert spent[text.language].audio_chars == audio_chars(e, text.id) > 0


def test_a_newer_voice_change_supersedes_a_running_rerecord(tmp_path: Path) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    other = store.add_topic(e.conn, "Bus stop", True, NOW)
    run(lambda: e.make_text(topic.id))
    run(lambda: e.make_text(other.id))  # two texts waiting
    voice.calls.clear()

    async def slow(text: str, name: str) -> bytes:
        await asyncio.sleep(0)  # a real request yields
        return await voice(text, name)

    e.synthesize = slow

    async def two_changes() -> None:
        await asyncio.gather(e.rerecord("th"), e.rerecord("th"))

    run(two_changes)

    # The first run finishes the text it was on (2 lines), then stops; the second does both texts.
    # Without superseding, two full runs would make 8 requests.
    assert len(voice.calls) == 6


# ==== Stretch words setting ====


def test_by_default_the_model_chooses_stretch_words_from_a_list() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    store.save_difficulty(e.conn, Difficulty(stretch=1))
    request = e._request("Food stall", ENTRIES, store.load_difficulty(e.conn))
    assert request.choose == 1
    # Due and young words only; the deck here has just the one.
    assert [w.text for w in request.stretch] == ["ข้าวเหนียวมะม่วง"]


def test_set_to_any_the_stretch_words_are_given() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    store.save_settings(e.conn, store.Settings(stretch_words="any"))
    request = e._request("Food stall", ENTRIES, Difficulty(stretch=2))
    assert request.choose is None
    assert [w.text for w in request.stretch] == ["ข้าวเหนียวมะม่วง"]


def test_a_text_records_the_stretch_words_the_model_chose() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: fetch(e, topic.id))
    assert text.stretch == ("ข้าวเหนียวมะม่วง",)


def test_a_stretch_word_from_a_text_read_yesterday_is_offered_again_today() -> None:
    from datetime import timedelta

    from franki_reader.lexicon import Entry

    clock = Clock()
    e = engine(ScriptedModel(IN_RANGE), clock=clock)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: fetch(e, topic.id))
    e.record_reading(text.id, reading("about_right"))
    young = [Entry(10 + i, f"คำ{i}", "word", "young", due=True) for i in range(20)]
    entries = ENTRIES + young

    # Read today: not "an earlier day" yet, so it's only one choice among many.
    assert store.practiced_days(e.conn, NOW.replace(hour=0)) == {}

    clock.now = NOW + timedelta(days=1)
    request = e._request("Food stall", entries, Difficulty(stretch=1))
    assert request.stretch[0].text == "ข้าวเหนียวมะม่วง"


def test_a_stretch_word_read_earlier_the_same_study_day_is_not_from_an_earlier_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from datetime import timedelta, timezone

    clock = Clock()
    clock.now = datetime(2026, 10, 18, 23, 30)  # 06:30 in Bangkok on the 19th
    e = engine(ScriptedModel(IN_RANGE), clock=clock)
    e.zone = timezone(timedelta(hours=7))
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: fetch(e, topic.id))
    e.record_reading(text.id, reading("about_right"))

    seen: list[dict[str, int]] = []
    practiced_days = store.practiced_days

    def spy(*args: Any, **kwargs: Any) -> dict[str, int]:
        seen.append(practiced_days(*args, **kwargs))
        return seen[-1]

    monkeypatch.setattr(store, "practiced_days", spy)
    clock.now = datetime(2026, 10, 19, 1, 0)  # 08:00 in Bangkok: the same study day, a new UTC one
    e._request("Food stall", ENTRIES, Difficulty(stretch=1))
    assert seen == [{}]
    clock.now = datetime(2026, 10, 19, 21, 30)  # 04:30 in Bangkok on the 20th: the next study day
    e._request("Food stall", ENTRIES, Difficulty(stretch=1))
    assert seen[-1] == {"ข้าวเหนียวมะม่วง": 1}


def test_the_length_setting_sets_the_number_of_lines_asked_for() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    assert e._request("Food stall", ENTRIES, Difficulty()).lines == 8
    store.save_settings(e.conn, store.Settings(lines=12))
    assert e._request("Food stall", ENTRIES, Difficulty()).lines == 12


def test_the_form_setting_asks_for_a_story_and_the_text_keeps_it() -> None:
    from scripted import draft

    story = draft("ฉัน|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ", "*ข้าวเหนียวมะม่วง*|ครับ!")
    for line in story["lines"]:
        line["speaker"] = "N"
    model = ScriptedModel(story)
    e = engine(model)
    store.save_settings(e.conn, store.Settings(form="story"))
    assert e._request("Food stall", ENTRIES, Difficulty()).form == "story"

    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: fetch(e, topic.id))
    assert text.form == "story"
    assert {line.speaker for line in text.lines} == {"N"}


# ==== Texts written to practice chosen words (the app's "Read a text with these words") ====


def test_chosen_words_are_offered_as_the_stretch_words() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    request = e._request("Food stall", ENTRIES, Difficulty(stretch=2), "th", "กิน\nครับ")
    assert sorted(w.text for w in request.stretch) == ["กิน", "ครับ"]
    assert request.choose == 2


def test_chosen_words_not_yet_studied_are_left_out_and_none_says_so() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    request = e._request("Food stall", ENTRIES, Difficulty(stretch=3), "th", "กิน\nทอน\nไม่มี")
    assert [w.text for w in request.stretch] == ["กิน"]
    assert request.choose == 1
    with pytest.raises(NotAvailable, match="None of those words are in the Thai word list yet"):
        e._request("Food stall", ENTRIES, Difficulty(), "th", "ทอน")


def test_a_text_for_chosen_words_is_its_own_and_not_the_queues() -> None:
    model = ScriptedModel(IN_RANGE, IN_RANGE)
    e = engine(model)
    topic = store.add_topic(e.conn, "Food stall", True, NOW)

    async def scenario() -> tuple[StoredText, int, StoredText]:
        queued = await fetch(e, topic.id)  # the queue's own text, still unread
        for _ in range(5):
            chosen = await e.next_text(topic.id, ["<b>ข้าวเหนียวมะม่วง</b>", "ครับ"])
            if chosen is not None:
                break
            await settle(e)
        assert chosen is not None
        ready = store.list_topics(e.conn)[0].ready
        return queued, ready, chosen

    queued, ready, chosen = run(scenario)

    assert chosen.id != queued.id
    assert model.calls == 2
    # The queue's text is still the one waiting; the chosen-words text isn't counted or served there.
    assert ready == 1
    assert store.next_ready_text(e.conn, topic.id).id == queued.id  # type: ignore[union-attr]


def test_chosen_words_read_the_deck_again_first() -> None:
    reads: list[str] = []
    fresh = [*ENTRIES[:6], Entry(7, "ทอน", "give change", "young")]

    async def read(language: Any) -> list[Entry]:
        reads.append(language.deck)
        return fresh

    e = engine(ScriptedModel(IN_RANGE))
    e.read_deck = read
    topic = store.add_topic(e.conn, "Food stall", True, NOW)
    text = run(lambda: e.make_text(topic.id, "th", "ทอน"))
    assert text is not None
    assert reads == ["👅 Languages::🐘 ภาษาไทย"]  # though today's snapshot wasn't a day old
