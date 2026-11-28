import asyncio
import random
from collections.abc import Awaitable, Callable
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from franki_speech import WordMark
from scripted import BAD, ENTRIES, IN_RANGE, WITHOUT_KIN, ScriptedModel

from franki_reader import store, xray
from franki_reader.difficulty import Difficulty
from franki_reader.engine import (
    MISSED_FLOOR,
    Engine,
    NotAvailable,
    NotFound,
)
from franki_reader.generator import GenerationFailed, Usage
from franki_reader.lexicon import Entry
from franki_reader.store import Reading, StoredText
from franki_reader.tts import SLOW_RATE, Spoken

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
    topic = store.add_topic(e.conn, "Food stall", NOW)

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
    topic = store.add_topic(e.conn, "Food stall", NOW)

    async def scenario() -> None:
        assert await e.next_text(topic.id) is None
        assert await e.next_text(topic.id) is None
        await settle(e)

    run(scenario)
    assert model.calls == 1
    assert store.get_topic(e.conn, topic.id).ready == 1  # type: ignore[union-attr]


def test_a_text_being_written_reports_each_stage_in_order_and_none_once_done() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", NOW)
    seen: list[str | None] = []
    translate, record = e.fill_meanings, e.make_audio

    async def translating(*args: Any, **kwargs: Any) -> None:
        seen.append(e.writing_stage(topic.id))
        await translate(*args, **kwargs)

    async def recording(*args: Any, **kwargs: Any) -> None:
        seen.append(e.writing_stage(topic.id))
        await record(*args, **kwargs)

    e.fill_meanings = translating  # type: ignore[method-assign]
    e.make_audio = recording  # type: ignore[method-assign]

    async def scenario() -> None:
        assert await e.next_text(topic.id) is None
        assert e.writing_stage(topic.id) in (None, "writing")
        await settle(e)

    run(scenario)
    assert seen == ["translating", "recording"]
    assert e.writing_stage(topic.id) is None


def test_a_caller_waiting_on_the_lock_takes_the_text_just_written() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    topic = store.add_topic(e.conn, "Food stall", NOW)

    async def scenario() -> tuple[StoredText | None, StoredText | None]:
        a, b = await asyncio.gather(e.make_text(topic.id), e.make_text(topic.id))
        return a, b

    a, b = run(scenario)
    assert a is not None and b is not None and a.id == b.id
    assert model.calls == 1


def test_a_ready_text_is_served_without_calling_the_model() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    made = run(lambda: e.make_text(topic.id))

    served = run(lambda: e.next_text(topic.id))

    assert served is not None and served.id == made.id
    assert model.calls == 1


def test_a_text_that_misses_the_floor_is_reported_once_then_retried() -> None:
    model = ScriptedModel(BAD)
    e = engine(model)
    topic = store.add_topic(e.conn, "Food stall", NOW)

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
    topic = store.add_topic(e.conn, "Food stall", NOW)
    assert run(lambda: e.make_text(topic.id)) is None
    rows = e.conn.execute("SELECT status, cost_usd FROM texts").fetchall()
    assert len(rows) == 1 and rows[0][0] == "dropped" and rows[0][1] > 0
    assert store.next_ready_text(e.conn, topic.id) is None


def test_a_revision_that_fails_still_stores_the_dropped_text_for_its_cost() -> None:
    e = engine(ScriptedModel(BAD, GenerationFailed("The response was cut off")))
    topic = store.add_topic(e.conn, "Food stall", NOW)
    assert run(lambda: e.make_text(topic.id)) is None
    rows = e.conn.execute("SELECT status, cost_usd FROM texts").fetchall()
    assert len(rows) == 1 and rows[0][0] == "dropped" and rows[0][1] > 0


def test_a_first_attempt_that_fails_with_an_answer_is_stored_dropped_for_its_cost() -> None:
    cut_off = GenerationFailed("The response was cut off", Usage(100, 500, 2000, 0))
    e = engine(ScriptedModel(cut_off))
    topic = store.add_topic(e.conn, "Food stall", NOW)
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

    def failing(entries: Any, language: Any, model: Any = None) -> Any:
        async def ask(messages: Any) -> Any:
            raise GenerationFailed("Claude didn't answer (APIConnectionError)")

        return ask

    e.ask_for = failing
    topic = store.add_topic(e.conn, "Food stall", NOW)

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
    topic = store.add_topic(no_key.conn, "Food stall", NOW)
    with pytest.raises(NotAvailable, match="no Claude API key"):
        run(lambda: no_key.next_text(topic.id))

    no_words = engine(ScriptedModel(IN_RANGE), with_lexicon=False)
    topic = store.add_topic(no_words.conn, "Food stall", NOW)
    with pytest.raises(NotAvailable, match="no Thai word list"):
        run(lambda: no_words.next_text(topic.id))


def test_an_unknown_topic_is_not_found() -> None:
    with pytest.raises(NotFound):
        run(lambda: engine(ScriptedModel(IN_RANGE)).next_text(99))


def test_top_up_writes_no_text_unasked() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    store.add_topic(e.conn, "Food stall", NOW)

    run(e.top_up)
    run(e.top_up)

    assert model.calls == 0
    assert store.shelf_texts(e.conn, "th") == []


def test_a_text_taken_off_the_shelf_is_counted_as_skipped_and_not_replaced() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)

    async def scenario() -> None:
        e.write_about("Haggling at a market", "story")
        await settle(e)

    run(scenario)
    first = store.shelf_texts(e.conn, "th")[0]

    assert store.skip_text(e.conn, first.id)
    assert not store.skip_text(e.conn, first.id)  # already off the shelf
    run(e.top_up)

    assert store.shelf_texts(e.conn, "th") == []
    assert model.calls == 1
    assert store.spending(e.conn, NOW)["th"].skipped == 1


def test_a_word_due_today_and_not_reviewed_is_left_out_of_a_new_text() -> None:
    # กิน is due today and not reviewed yet: a new text is written without it, but a text already
    # written that has it is read as before.
    entries = [replace(x, due=True, due_in=0) if x.text == "กิน" else x for x in ENTRIES]
    model = ScriptedModel(IN_RANGE, WITHOUT_KIN)
    e = engine(model)
    store.save_snapshot(e.conn, entries, NOW)
    topic = store.add_topic(e.conn, "Food stall", NOW)

    text = run(lambda: fetch(e, topic.id))

    listed = {x.text for x in model.entries_seen[0]}
    assert "กิน" not in listed and {"ฉัน", "ข้าวเหนียวมะม่วง"} <= listed
    revision = str(model.messages_seen[1][-1]["content"])
    assert "กิน" in revision  # named as a word outside the list, like any other
    assert model.calls == 2 and all("กิน" not in ln.text for ln in text.lines)
    assert e.writing_lexicon("th")[1].status("กิน") == "unknown"
    assert e.snapshot("th")[1].status("กิน") == "known"  # reading, glosses and marks unchanged
    # A practice word asked for is never withheld, whatever the snapshot says.
    kept = e.writing_lexicon("th", keep=[x for x in entries if x.text == "กิน"])[1]
    assert kept.status("กิน") == "known"


def test_a_word_that_came_due_since_the_snapshot_is_not_a_practice_word() -> None:
    clock = Clock()
    e = engine(ScriptedModel(IN_RANGE), clock=clock)
    # ข้าวเหนียวมะม่วง was reviewed on the snapshot's day and comes due 5 study days later.
    clock.now = NOW + timedelta(days=2)
    assert [x.text for x in e._request("x", ENTRIES, Difficulty(stretch=1)).stretch] == [
        "ข้าวเหนียวมะม่วง"
    ]
    clock.now = NOW + timedelta(days=5)
    assert e._request("x", ENTRIES, Difficulty(stretch=1)).stretch == ()


def test_a_text_asked_for_joins_the_shelf() -> None:
    model = ScriptedModel(IN_RANGE)
    e = engine(model)
    run(e.top_up)

    async def scenario() -> None:
        e.write_about("Haggling at a market", "story")
        await settle(e)

    run(scenario)
    shelf = store.shelf_texts(e.conn, "th")
    assert len(shelf) == 1
    asked = shelf[0]
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
        "plan": "Noi's stall is threatened.",
    }
    second = {**IN_RANGE, "recap": "It rains on Noi.", "plan": "Noi saves the stall."}
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
    assert "season's plan so far: Noi's stall is threatened." in asked
    story = store.get_story(e.conn, story_id)
    assert story is not None and story.plan == "Noi saves the stall."
    assert 'episode 2 of an ongoing story, "Noi\'s stall"' in asked
    assert "Noi opens." in asked and "Noi sells noodles." in asked

    run(e.top_up)  # episode 2 is waiting: no third
    assert [t.episode for t in store.episodes(e.conn, story_id)] == [1, 2]


def test_the_next_episode_hears_the_name_spellings_and_titles_so_far() -> None:
    first = {
        **IN_RANGE,
        "title": "ทาง|ป่า",
        "series": "Noi's stall",
        "lines": [{**IN_RANGE["lines"][0], "text": "~นก~|" + IN_RANGE["lines"][0]["text"]}]
        + IN_RANGE["lines"][1:],
    }
    model = ScriptedModel(first, IN_RANGE)
    e = engine(model)

    async def start() -> int:
        story = e.start_story("a noodle stall")
        await settle(e)
        return story.id

    story_id = run(start)
    episode = store.waiting_episode(e.conn, story_id)
    assert episode is not None and episode.title == "ทางป่า"
    e.record_reading(episode.id, reading(None))
    calls = model.calls
    run(e.top_up)
    asked = model.messages_seen[calls][0]["content"]
    assert "used each spelling: นก (1)." in asked
    assert "The latest episodes' titles: ทางป่า." in asked


def test_a_story_keeps_what_each_episode_tells_of_its_characters() -> None:
    first = {
        **IN_RANGE,
        "series": "Noi's stall",
        "cast": "Noi sells noodles.",
        "recap": "Noi opens.",
        "xray": [{"name": "Noi", "fact": "Sells noodles at a stall."}],
    }
    second = {
        **IN_RANGE,
        "recap": "It rains.",
        "xray": [
            {"name": "Noi", "fact": "Saves the stall from the rain."},
            {"name": "Dao", "fact": "A customer who always pays late."},
        ],
    }
    model = ScriptedModel(first, second)
    e = engine(model)

    async def start() -> int:
        story = e.start_story("a noodle stall")
        await settle(e)
        return story.id

    story_id = run(start)
    episode = store.waiting_episode(e.conn, story_id)
    assert episode is not None
    e.record_reading(episode.id, reading(None))
    calls = model.calls
    run(e.top_up)
    asked = model.messages_seen[calls][0]["content"]
    assert "- Noi: Sells noodles at a stall." in asked
    story = store.get_story(e.conn, story_id)
    assert story is not None
    # Episode 1's card never shows what episode 2 told.
    assert [c["description"] for c in xray.visible(story.characters, 1)] == [
        "Sells noodles at a stall."
    ]
    assert [c["name"] for c in xray.visible(story.characters, 2)] == ["Noi", "Dao"]


def test_the_next_episode_is_written_from_the_choice_the_reader_made() -> None:
    choices = [
        {"text": "ฉัน|กิน", "english": "I eat."},
        {"text": "อยาก|กิน", "english": "I want to eat."},
    ]
    first = {**IN_RANGE, "series": "Noi's stall", "cast": "Noi.", "recap": "Noi opens."}
    model = ScriptedModel({**first, "choices": choices}, {**IN_RANGE, "recap": "Noi eats."})
    e = engine(model)

    async def start() -> int:
        story = e.start_story("a noodle stall")
        await settle(e)
        return story.id

    story_id = run(start)
    episode = store.waiting_episode(e.conn, story_id)
    assert episode is not None and [c.english for c in episode.choices] == [
        "I eat.",
        "I want to eat.",
    ]
    assert episode.chosen is None

    assert store.set_choice(e.conn, episode.id, 1) == "ok"
    assert store.set_choice(e.conn, episode.id, 0) == "ok"  # a pick can change until it's read
    assert store.set_choice(e.conn, episode.id, 2) == "unknown"
    assert store.set_choice(e.conn, 9999, 0) == "unknown"
    assert store.get_text(e.conn, episode.id).chosen == 0  # type: ignore[union-attr]

    e.record_reading(episode.id, reading(None))
    assert store.set_choice(e.conn, episode.id, 1) == "read"
    calls = model.calls
    run(e.top_up)
    asked = model.messages_seen[calls][0]["content"]
    assert 'chose what happens next: "I eat."' in asked


def test_an_episode_read_with_no_choice_made_carries_on_without_one() -> None:
    choices = [{"text": "ฉัน|กิน", "english": "I eat."}, {"text": "อยาก|กิน", "english": "Eat."}]
    first = {**IN_RANGE, "series": "Noi's stall", "cast": "Noi.", "choices": choices}
    model = ScriptedModel(first, IN_RANGE)
    e = engine(model)

    async def start() -> int:
        story = e.start_story("a noodle stall")
        await settle(e)
        return story.id

    story_id = run(start)
    episode = store.waiting_episode(e.conn, story_id)
    assert episode is not None
    e.record_reading(episode.id, reading(None))
    calls = model.calls
    run(e.top_up)
    assert "chose what happens next" not in model.messages_seen[calls][0]["content"]


def test_a_new_story_runs_beside_the_old_one_which_keeps_the_card() -> None:
    e = engine(ScriptedModel(IN_RANGE))

    async def scenario() -> tuple[int, int]:
        old = e.start_story("")
        await settle(e)
        new = e.start_story("a haunted house")
        await settle(e)
        return old.id, new.id

    old, new = run(scenario)
    assert [s.id for s in store.stories(e.conn, "th", running_only=True)] == [new, old]
    pinned = store.pinned_story(e.conn, "th")
    assert pinned is not None and pinned.id == old


def test_a_new_story_is_told_the_names_the_other_stories_use() -> None:
    first = {**IN_RANGE, "series": "ร้านกาแฟของมาลี", "cast": "Mali runs a coffee shop."}
    model = ScriptedModel(first, IN_RANGE)
    e = engine(model)

    async def scenario() -> None:
        e.start_story("")
        await settle(e)
        e.start_story("")
        await settle(e)

    run(scenario)
    assert "Mali runs a coffee shop." not in model.messages_seen[0][0]["content"]
    assert "Mali runs a coffee shop." in model.messages_seen[1][0]["content"]


def test_pinning_ending_and_continuing_stories() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    first = store.start_story(e.conn, "th", "", NOW)
    second = store.start_story(e.conn, "th", "", NOW)
    # Another language's pin is its own.
    other = store.start_story(e.conn, "pl", "", NOW)
    assert store.pin_story(e.conn, second.id)
    assert store.pinned_story(e.conn, "th").id == second.id  # type: ignore[union-attr]
    assert store.pinned_story(e.conn, "pl").id == other.id  # type: ignore[union-attr]
    # Ending the pinned story leaves the card to the newest running one, and it can't be pinned.
    assert store.end_story(e.conn, second.id)
    assert not store.end_story(e.conn, second.id)
    assert not store.pin_story(e.conn, second.id)
    assert store.pinned_story(e.conn, "th").id == first.id  # type: ignore[union-attr]
    assert [s.id for s in store.stories(e.conn, "th")] == [first.id, second.id]
    # Continued, it runs again, but the card stays where it is.
    assert store.continue_story(e.conn, second.id)
    assert not store.continue_story(e.conn, second.id)
    assert store.pinned_story(e.conn, "th").id == first.id  # type: ignore[union-attr]
    assert not store.pin_story(e.conn, 999)


def test_top_up_writes_each_running_story_its_next_episode() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    first = store.start_story(e.conn, "th", "", NOW)
    second = store.start_story(e.conn, "th", "a haunted house", NOW)
    ended = store.start_story(e.conn, "th", "", NOW)
    store.end_story(e.conn, ended.id)
    run(e.top_up)
    assert store.waiting_episode(e.conn, first.id) is not None
    assert store.waiting_episode(e.conn, second.id) is not None
    assert store.waiting_episode(e.conn, ended.id) is None


def test_start_missing_episodes_shows_the_story_writing_before_it_finishes() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    story = store.start_story(e.conn, "th", "", NOW)

    async def scenario() -> list[int | None]:
        e.start_missing_episodes()
        # What a shelf request built right now would say: writing, not "not written yet".
        writing = [j.story_id for j in e.writing("th")]
        e.start_missing_episodes()  # a second ask doesn't start a second write
        await settle(e)
        return writing

    assert run(scenario) == [story.id]
    assert store.waiting_episode(e.conn, story.id) is not None
    assert [t.episode for t in store.episodes(e.conn, story.id)] == [1]


def test_start_missing_episodes_does_nothing_without_a_key() -> None:
    e = engine(None)
    store.start_story(e.conn, "th", "", NOW)
    e.start_missing_episodes()  # no exception
    assert e.writing("th") == []


def test_a_top_up_that_arrives_mid_pass_makes_the_pass_go_round_again() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    passes = 0
    later: list[int] = []
    original = e._top_up_pass

    async def pass_() -> None:
        nonlocal passes
        passes += 1
        if passes == 1:
            await original()
            # An episode was just read after the story check: the call for it lands mid-pass.
            later.append(store.start_story(e.conn, "th", "", NOW).id)
            await e.top_up()
        else:
            await original()

    e._top_up_pass = pass_  # type: ignore[method-assign]
    run(e.top_up)
    assert passes == 2
    assert store.waiting_episode(e.conn, later[0]) is not None
    run(e.top_up)  # nothing left over: one pass
    assert passes == 3


def test_top_up_stops_quietly_without_a_key() -> None:
    e = engine(None)
    store.add_topic(e.conn, "Food stall", NOW)
    run(e.top_up)  # no exception
    assert e.topic_state(store.list_topics(e.conn)[0]) == "idle"


def test_a_rating_no_longer_moves_the_difficulty() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: fetch(e, topic.id))

    e.record_reading(text.id, reading("too_hard"))

    # Still logged, from an older app that sends one, but it changes nothing.
    assert store.load_difficulty(e.conn) == Difficulty()
    assert e.conn.execute("SELECT rating FROM readings").fetchone()[0] == "too_hard"


def test_a_repeated_reading_is_ignored() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: fetch(e, topic.id))

    e.record_reading(text.id, checked(0, 8))
    e.record_reading(text.id, checked(0, 8))

    assert store.load_difficulty(e.conn) == Difficulty(0.97)
    assert e.conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0] == 1


def test_a_reading_without_a_rating_leaves_difficulty_alone() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", NOW)
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
        self.languages: list[str] = []
        self.rates: list[float] = []
        self.fail_on = fail_on

    async def __call__(self, text: str, voice: str, language: str, rate: float = 1.0) -> Spoken:
        from franki_reader.tts import TtsFailed

        self.calls.append((text, voice))
        self.languages.append(language)
        self.rates.append(rate)
        if text == self.fail_on:
            raise TtsFailed("Azure answered 500")
        return Spoken(f"mp3:{text}".encode())


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
    topic = store.add_topic(e.conn, "Food stall", NOW)

    text = run(lambda: fetch(e, topic.id))

    assert voice.calls == [
        # The scripted text is two men: the second speaker reads in the second man's voice.
        ("ผมอยากกินข้าวเหนียวมะม่วงครับผมอยากกินทอนครับ", "voice-a"),
        ("ข้าวเหนียวมะม่วงครับ!ผมอยากกินครับผมอยากกินครับ", "voice-b"),
    ]
    # Each line says the text's language, for a Multilingual voice.
    assert voice.languages == ["th-TH", "th-TH"]
    assert e.has_audio(text.id, 0) and e.has_audio(text.id, 1)


def test_a_text_is_not_ready_until_its_audio_is_made(tmp_path: Path) -> None:
    seen: list[str | None] = []
    e = speaking_engine(tmp_path, None)

    async def voice(text: str, name: str, language: str) -> Spoken:
        seen.append(store.text_status(e.conn, 1))
        return Spoken(b"mp3")

    e.synthesize = voice
    topic = store.add_topic(e.conn, "Food stall", NOW)
    run(lambda: e.make_text(topic.id))

    assert seen == ["pending", "pending"]
    assert store.text_status(e.conn, 1) == "ready"


def test_a_pending_text_left_by_a_restart_becomes_ready(tmp_path: Path) -> None:
    db = tmp_path / "t.db"
    e = engine(ScriptedModel(IN_RANGE))
    e.conn = store.connect(db)
    store.save_snapshot(e.conn, ENTRIES, NOW)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    run(lambda: e.make_text(topic.id))
    e.conn.execute("UPDATE texts SET status = 'pending'")
    e.conn.commit()

    assert store.text_status(store.connect(db), 1) == "ready"


def test_a_failed_line_stays_silent_and_the_text_is_still_served(tmp_path: Path) -> None:
    e = speaking_engine(tmp_path, FakeVoice(fail_on="ข้าวเหนียวมะม่วงครับ!ผมอยากกินครับผมอยากกินครับ"))
    topic = store.add_topic(e.conn, "Food stall", NOW)

    text = run(lambda: fetch(e, topic.id))

    assert e.has_audio(text.id, 0)
    assert not e.has_audio(text.id, 1)


def test_missing_audio_is_made_on_request_and_then_cached(tmp_path: Path) -> None:
    e = speaking_engine(tmp_path, None)
    topic = store.add_topic(e.conn, "Food stall", NOW)
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


def test_a_language_with_no_voice_is_never_recorded_even_with_text_to_speech_set(
    tmp_path: Path,
) -> None:
    from dataclasses import replace

    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = replace(run(lambda: fetch(e, topic.id)), language="tok")
    e.audio.drop(text.id)  # type: ignore[union-attr]
    voice.calls.clear()

    assert run(lambda: e.line_audio(text, 0)) is None
    assert run(lambda: e.line_audio(text, 0, slow=True)) is None
    assert voice.calls == [] and not e.has_audio(text.id, 0)


def test_two_requests_for_a_line_at_once_pay_for_one_recording(tmp_path: Path) -> None:
    e = speaking_engine(tmp_path, None)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: fetch(e, topic.id))

    class SlowVoice(FakeVoice):
        async def __call__(self, text: str, voice: str, language: str, rate: float = 1.0) -> Spoken:
            await asyncio.sleep(0.01)  # Azure takes a moment: both requests are in by then
            return await super().__call__(text, voice, language, rate)

    voice = SlowVoice()
    e.synthesize = voice

    async def both() -> list[Path | None]:
        return list(await asyncio.gather(e.line_audio(text, 0), e.line_audio(text, 0)))

    first, second = run(both)
    assert first is not None and first == second
    assert len(voice.calls) == 1
    assert not e._recording  # nothing left waiting


def audio_chars(e: Engine, text_id: int) -> int:
    return int(
        e.conn.execute("SELECT audio_chars FROM texts WHERE id = ?", (text_id,)).fetchone()[0]
    )


def test_the_characters_azure_speaks_for_a_text_are_counted(tmp_path: Path) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    topic = store.add_topic(e.conn, "Food stall", NOW)

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


def test_a_slow_recording_is_made_when_asked_for_and_kept_beside_the_normal_one(
    tmp_path: Path,
) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    assert e.audio is not None
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: fetch(e, topic.id))
    normal = audio_chars(e, text.id)
    assert voice.rates and set(voice.rates) == {1.0}
    assert not e.audio.has(text.id, 0, slow=True)

    path = run(lambda: e.line_audio(text, 0, slow=True))

    assert path == e.audio.path(text.id, 0, slow=True) and path.is_file()
    assert voice.rates[-1] == SLOW_RATE
    # The normal recording is untouched, and the slow one is billed as its own recording.
    assert e.audio.has(text.id, 0)
    assert audio_chars(e, text.id) > normal
    # Asked again, it comes from the cache and isn't billed again.
    billed = audio_chars(e, text.id)
    calls = len(voice.calls)
    run(lambda: e.line_audio(text, 0, slow=True))
    assert len(voice.calls) == calls and audio_chars(e, text.id) == billed
    # Re-recording a text in new voices forgets its slow lines too.
    e.audio.drop(text.id)
    assert not e.audio.has(text.id, 0, slow=True)


def test_slow_recordings_from_the_old_rate_are_dropped_once(tmp_path: Path) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    assert e.audio is not None
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: fetch(e, topic.id))
    run(lambda: e.line_audio(text, 0, slow=True))
    assert e.audio.has(text.id, 0, slow=True)

    e.drop_old_slow_audio()

    assert not e.audio.has(text.id, 0, slow=True) and e.audio.has(text.id, 0)
    # Once: a slow recording made at the new rate is kept.
    run(lambda: e.line_audio(text, 0, slow=True))
    e.drop_old_slow_audio()
    assert e.audio.has(text.id, 0, slow=True)


def test_a_slow_line_azure_refused_has_no_slow_audio_and_isnt_counted(tmp_path: Path) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: fetch(e, topic.id))
    counted = audio_chars(e, text.id)
    voice.fail_on = voice.calls[0][0]  # the first line's words, as spoken

    assert run(lambda: e.line_audio(text, 0, slow=True)) is None
    assert audio_chars(e, text.id) == counted


def test_a_line_azure_refused_is_not_counted(tmp_path: Path) -> None:
    refused = "ข้าวเหนียวมะม่วงครับ!ผมอยากกินครับผมอยากกินครับ"
    voice = FakeVoice(fail_on=refused)
    e = speaking_engine(tmp_path, voice)
    topic = store.add_topic(e.conn, "Food stall", NOW)

    text = run(lambda: fetch(e, topic.id))

    counted = sum(len(t) for t, _ in voice.calls if t != refused)
    assert audio_chars(e, text.id) == counted > 0


def test_audio_recorded_before_counting_is_estimated_once_from_the_volume(tmp_path: Path) -> None:
    e = speaking_engine(tmp_path, FakeVoice())
    topic = store.add_topic(e.conn, "Food stall", NOW)
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
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: fetch(e, topic.id))

    spent = store.spending(e.conn, datetime(2020, 1, 1))

    assert spent[text.language].audio_chars == audio_chars(e, text.id) > 0


def test_a_newer_voice_change_supersedes_a_running_rerecord(tmp_path: Path) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    other = store.add_topic(e.conn, "Bus stop", NOW)
    run(lambda: e.make_text(topic.id))
    run(lambda: e.make_text(other.id))  # two texts waiting
    voice.calls.clear()

    async def slow(text: str, name: str, language: str) -> Spoken:
        await asyncio.sleep(0)  # a real request yields
        return await voice(text, name, language)

    e.synthesize = slow

    async def two_changes() -> None:
        await asyncio.gather(e.rerecord("th"), e.rerecord("th"))

    run(two_changes)

    # The first run finishes the text it was on (2 lines), then stops; the second does both texts.
    # Without superseding, two full runs would make 8 requests.
    assert len(voice.calls) == 6


def test_texts_waiting_from_before_timings_are_re_recorded_with_them_once(tmp_path: Path) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    assert e.audio is not None
    topic = store.add_topic(e.conn, "Food stall", NOW)
    other = store.add_topic(e.conn, "Bus stop", NOW)
    run(lambda: e.make_text(topic.id))
    run(lambda: e.make_text(other.id))
    read, waiting = store.ready_texts(e.conn, "th")
    e.conn.execute("UPDATE texts SET status = 'read' WHERE id = ?", (read.id,))
    shelf = store.ready_texts(e.conn, "th")
    # Both recorded before timings (FakeVoice gives none); the waiting one has a line with no audio.
    e.audio.path(waiting.id, 1).unlink()
    voice.calls.clear()

    async def timed(text: str, name: str, language: str) -> Spoken:
        voice.calls.append((text, name))
        return Spoken(b"mp3", [WordMark(text, 0, 1000)])

    e.synthesize = timed
    run(e.time_waiting_texts)

    # Every waiting text's lines, the one missing a line's audio included; not the read one's.
    assert read.id not in {t.id for t in shelf}
    assert len(voice.calls) == sum(len(t.lines) for t in shelf)
    assert all(e.audio.has_marks(t.id, i) for t in shelf for i in range(len(t.lines)))
    assert not e.audio.has_marks(read.id, 0)

    voice.calls.clear()
    run(e.time_waiting_texts)
    assert voice.calls == []


def test_a_pass_where_azure_gave_no_timings_isnt_repeated(tmp_path: Path) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    run(lambda: e.make_text(topic.id))
    voice.calls.clear()

    run(e.time_waiting_texts)
    run(e.time_waiting_texts)

    assert len(voice.calls) == 2  # one pass, both lines


def test_a_pass_cut_short_skips_the_texts_it_already_timed(tmp_path: Path) -> None:
    voice = FakeVoice()
    e = speaking_engine(tmp_path, voice)
    assert e.audio is not None
    food = store.add_topic(e.conn, "Food stall", NOW)
    bus = store.add_topic(e.conn, "Bus stop", NOW)
    run(lambda: e.make_text(food.id))
    run(lambda: e.make_text(bus.id))
    first, second = store.ready_texts(e.conn, "th")
    # The first was re-recorded with timings before a restart; the flag was never set.
    for i in range(len(first.lines)):
        e.audio.write(first.id, i, Spoken(b"mp3", [WordMark("x", 0, 1)]))
    voice.calls.clear()

    run(e.time_waiting_texts)

    assert len(voice.calls) == len(second.lines)


def test_a_word_looked_up_outside_the_deck_is_offered_to_a_later_days_text() -> None:
    clock = Clock()
    e = engine(ScriptedModel(IN_RANGE), clock=clock)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: fetch(e, topic.id))
    e.record_reading(text.id, Reading(None, True, ("ทอน", "ผม"), (), 1.0, False, 120))

    # The same day it was met: not again. The next day: offered, with its gloss; the known word never.
    assert e._request("Food stall", ENTRIES, Difficulty()).met == ()
    clock.now = NOW + timedelta(days=1)
    assert [(w.text, w.meaning) for w in e._request("Food stall", ENTRIES, Difficulty()).met] == [
        ("ทอน", "give change")
    ]
    assert e._request("Food stall", ENTRIES, Difficulty(), "es").met == ()


def test_input_time_totals_reading_and_listening_by_language() -> None:
    clock = Clock()
    e = engine(ScriptedModel(IN_RANGE), clock=clock)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    assert store.input_time(e.conn, NOW - timedelta(days=7)) == []
    first = run(lambda: fetch(e, topic.id))
    e.record_reading(first.id, Reading(None, True, (), (), 1.0, False, 120))
    second = run(lambda: fetch(e, topic.id))
    e.record_reading(second.id, Reading(None, True, (), (), 1.0, True, 60))  # words hidden
    # A lesson played to the end counts by its length; one never played doesn't.
    for heard in (True, False):
        lesson_id = store.add_lesson(e.conn, "th", "a café", NOW)
        with e.conn:
            e.conn.execute("UPDATE lessons SET duration_ms = 90500 WHERE id = ?", (lesson_id,))
        if heard:
            store.mark_lesson_heard(e.conn, lesson_id, NOW)
    # A text heard again counts by how long it played; one from an older app, with no time, doesn't.
    store.log_listen(e.conn, first.id, NOW, "a", 45)
    store.log_listen(e.conn, first.id, NOW, "b")

    assert store.input_time(e.conn, NOW - timedelta(days=7)) == [
        store.InputTime("th", 120, 195, NOW)
    ]
    # Past the window nothing is counted, and the last reading is still known.
    assert store.input_time(e.conn, NOW + timedelta(days=1)) == [store.InputTime("th", 0, 0, NOW)]


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
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: fetch(e, topic.id))
    assert text.stretch == ("ข้าวเหนียวมะม่วง",)


def test_stretch_readings_list_the_words_of_texts_read_to_the_end() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", NOW)
    finished = run(lambda: fetch(e, topic.id))
    e.record_reading(finished.id, reading("about_right"))
    left = run(lambda: fetch(e, topic.id))
    e.record_reading(left.id, Reading(None, False, (), (), 1.0, False, 5))  # backed out of

    found = store.stretch_readings(e.conn, NOW - timedelta(days=1))
    assert found == [(NOW, ["ข้าวเหนียวมะม่วง"])]
    assert store.stretch_readings(e.conn, NOW + timedelta(days=1)) == []
    assert store.stretch_readings(e.conn, NOW - timedelta(days=1), "es") == []


def test_a_stretch_word_from_a_text_read_yesterday_is_offered_again_today() -> None:
    from datetime import timedelta

    from franki_reader.lexicon import Entry

    clock = Clock()
    e = engine(ScriptedModel(IN_RANGE), clock=clock)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: fetch(e, topic.id))
    e.record_reading(text.id, reading("about_right"))
    young = [Entry(10 + i, f"คำ{i}", "word", "young", reviewed=True, due_in=5) for i in range(20)]
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
    topic = store.add_topic(e.conn, "Food stall", NOW)
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

    story = draft("ผม|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ", "*ข้าวเหนียวมะม่วง*|ครับ!")
    for line in story["lines"]:
        line["speaker"] = "N"
    model = ScriptedModel(story)
    e = engine(model)
    store.save_settings(e.conn, store.Settings(form="story"))
    assert e._request("Food stall", ENTRIES, Difficulty()).form == "story"

    topic = store.add_topic(e.conn, "Food stall", NOW)
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
    topic = store.add_topic(e.conn, "Food stall", NOW)

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
    fresh = [*ENTRIES[:6], Entry(7, "ทอน", "give change", "young"), *ENTRIES[7:]]

    async def read(language: Any) -> list[Entry]:
        reads.append(language.deck)
        return fresh

    e = engine(ScriptedModel(IN_RANGE))
    e.read_deck = read
    topic = store.add_topic(e.conn, "Food stall", NOW)
    text = run(lambda: e.make_text(topic.id, "th", "ทอน"))
    assert text is not None
    assert reads == ["👅 Languages::🐘 ภาษาไทย"]  # though today's snapshot wasn't a day old


def checked(right: int, asked: int) -> Reading:
    return Reading(
        "about_right", True, (), (), 1.0, False, 120, check_right=right, check_asked=asked
    )


def read_with(e: Engine, topic_id: int, reading_: Reading) -> None:
    e.record_reading(run(lambda: fetch(e, topic_id)).id, reading_)


def test_a_poor_check_steers_only_together_with_the_last_texts() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", NOW)
    read_with(e, topic.id, checked(1, 4))  # alone: too few answers to count
    assert store.load_difficulty(e.conn, "th").floor == 0.95
    read_with(e, topic.id, checked(1, 4))  # with the one before: 2 of 8
    assert store.load_difficulty(e.conn, "th").floor == 0.97


def test_a_good_check_after_a_poor_one_changes_nothing() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    topic = store.add_topic(e.conn, "Food stall", NOW)
    read_with(e, topic.id, checked(0, 4))
    read_with(e, topic.id, checked(4, 4))  # 4 of 8 is under 60%, so this one does steer
    assert store.load_difficulty(e.conn, "th").floor == 0.97
    e2 = engine(ScriptedModel(IN_RANGE))
    topic2 = store.add_topic(e2.conn, "Food stall", NOW)
    read_with(e2, topic2.id, checked(3, 4))
    read_with(e2, topic2.id, checked(3, 4))  # 6 of 8
    assert store.load_difficulty(e2.conn, "th").floor == 0.95


def test_a_step_starts_over_so_the_answers_that_made_it_cant_make_the_next() -> None:
    e = engine(ScriptedModel(IN_RANGE))
    store.save_difficulty(e.conn, Difficulty(floor=0.97), "th")
    topic = store.add_topic(e.conn, "Food stall", NOW)
    read_with(e, topic.id, checked(4, 4))
    read_with(e, topic.id, checked(4, 4))  # 8 of 8: Easier to Standard
    assert store.load_difficulty(e.conn, "th").floor == 0.95
    read_with(e, topic.id, checked(4, 4))  # alone at Standard: too few answers to move again
    assert store.load_difficulty(e.conn, "th").floor == 0.95
    read_with(e, topic.id, checked(4, 4))  # with the one before at Standard: 8 of 8
    assert store.load_difficulty(e.conn, "th").floor == 0.93


def test_a_check_from_over_a_week_ago_isnt_counted_with_this_one() -> None:
    clock = Clock()
    e = engine(ScriptedModel(IN_RANGE), clock=clock)
    topic = store.add_topic(e.conn, "Food stall", NOW)
    first = run(lambda: fetch(e, topic.id))
    second = run(lambda: fetch(e, topic.id))
    e.record_reading(first.id, checked(0, 4))
    clock.now = NOW + timedelta(days=8)
    e.record_reading(second.id, checked(0, 4))
    assert store.load_difficulty(e.conn, "th").floor == 0.95


class FakeParts:
    """Records each line spoken in several voices (a story's quotations)."""

    def __init__(self) -> None:
        self.calls: list[list[Any]] = []

    async def __call__(self, parts: Any, language: str) -> Spoken:
        self.calls.append(list(parts))
        return Spoken(b"mp3")


def _quoted(speaker: str, who: list[str], text: str) -> dict[str, Any]:
    return {**IN_RANGE["lines"][0], "speaker": "N", "text": text, "quotes": who}


def _story_episode(*lines: dict[str, Any], speakers: list[dict[str, str]]) -> dict[str, Any]:
    return {
        **IN_RANGE,
        "lines": [*lines, {**IN_RANGE["lines"][1], "speaker": "N"}],
        "speakers": speakers,
    }


def test_a_story_characters_voice_is_given_once_and_kept_in_every_episode(tmp_path: Path) -> None:
    from franki_speech import Part

    from franki_reader.tts import AudioCache

    say = "“ผม|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ|ผม|อยาก|กิน|ทอน|ครับ”"
    noi = {"name": "Noi", "gender": "male", "age": "adult"}
    ploy = {"name": "Ploy", "gender": "female", "age": "child"}
    first = _story_episode(_quoted("N", ["Noi"], say), speakers=[noi])
    # Ploy is a girl: no ครับ in her words, which Thai's gender check would send back.
    girl = "“ฉัน|อยาก|กิน|ทอน|ฉัน|อยาก|กิน|ฉัน|อยาก|กิน”"
    second = _story_episode(
        _quoted("N", ["Noi"], say), _quoted("N", ["Ploy"], girl), speakers=[noi, ploy]
    )
    model = ScriptedModel(first, second)
    narrator, parts = FakeVoice(), FakeParts()
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    e = Engine(
        conn,
        model.ask_for,
        None,
        Clock(),
        random.Random(1),
        synthesize=narrator,
        synthesize_parts=parts,
        audio=AudioCache(tmp_path),
        voices={"male": "voice-a", "male2": "voice-b", "female": "voice-c", "female2": "voice-d"},
    )

    async def start() -> int:
        story = e.start_story("a noodle stall")
        await settle(e)
        return story.id

    story_id = run(start)
    story = store.get_story(e.conn, story_id)
    assert story is not None
    # Noi is a man, and the narrator has voice-a: Noi gets the other man's voice.
    assert {n: (v.voice, v.pitch) for n, v in story.voices.items()} == {"Noi": ("voice-b", 0)}
    # The quoted line is one recording in Noi's voice, the plain one the narrator's.
    assert parts.calls == [[Part(say.replace("|", "").replace("*", ""), "voice-b", 0)]]
    assert [t for t, _ in narrator.calls] == ["ข้าวเหนียวมะม่วงครับ!ผมอยากกินครับผมอยากกินครับ"]
    assert "No character has a voice yet" in model.messages_seen[0][0]["content"]

    episode = store.waiting_episode(e.conn, story_id)
    assert episode is not None
    e.record_reading(episode.id, reading(None))
    run(e.top_up)
    # The next episode is told Noi has a voice, and only Ploy, who is new, is given one.
    asked = model.messages_seen[1][0]["content"]
    assert "- Noi (male, adult)" in asked
    story = store.get_story(e.conn, story_id)
    assert story is not None
    assert {n: (v.voice, v.pitch) for n, v in story.voices.items()} == {
        "Noi": ("voice-b", 0),
        "Ploy": ("voice-c", 8),
    }
    assert [p[0].voice for p in parts.calls[1:]] == ["voice-b", "voice-c"]
    assert parts.calls[-1][0].pitch == 8


def test_without_a_parts_voice_a_quoted_line_is_read_whole_by_the_narrator(tmp_path: Path) -> None:
    say = "“ผม|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ|ผม|อยาก|กิน|ทอน|ครับ”"
    noi = {"name": "Noi", "gender": "male", "age": "adult"}
    model = ScriptedModel(_story_episode(_quoted("N", ["Noi"], say), speakers=[noi]))
    narrator = FakeVoice()
    e = speaking_engine(tmp_path, narrator)
    e.ask_for = model.ask_for

    async def start() -> None:
        e.start_story("a noodle stall")
        await settle(e)

    run(start)
    assert [v for _, v in narrator.calls] == ["voice-a", "voice-a"]


def test_a_line_azure_wont_record_in_several_voices_is_read_whole_by_the_narrator(
    tmp_path: Path,
) -> None:
    from franki_reader.tts import TtsFailed

    say = "“ผม|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ|ผม|อยาก|กิน|ทอน|ครับ”"
    noi = {"name": "Noi", "gender": "male", "age": "adult"}
    model = ScriptedModel(_story_episode(_quoted("N", ["Noi"], say), speakers=[noi]))
    narrator = FakeVoice()
    e = speaking_engine(tmp_path, narrator)
    e.ask_for = model.ask_for

    async def refused(parts: Any, language: str) -> Spoken:
        raise TtsFailed("Azure answered 400")

    e.synthesize_parts = refused

    async def start() -> int:
        story = e.start_story("a noodle stall")
        await settle(e)
        return story.id

    story_id = run(start)
    episode = store.waiting_episode(e.conn, story_id)
    assert episode is not None and e.has_audio(episode.id, 0) and e.has_audio(episode.id, 1)
    assert narrator.calls[0][1] == "voice-a"


def test_a_story_episode_is_written_at_the_story_effort_and_a_plain_text_is_not() -> None:
    from franki_reader.generator import STORY_EFFORT

    story_model = ScriptedModel(
        {**IN_RANGE, "series": "Noi's stall", "cast": "Noi.", "recap": "x", "plan": "y"}
    )
    story_engine = engine(story_model)

    async def start() -> None:
        story_engine.start_story("a noodle stall")
        await settle(story_engine)

    run(start)
    assert story_model.efforts_seen == [STORY_EFFORT]

    text_model = ScriptedModel(IN_RANGE)
    text_engine = engine(text_model)

    async def write() -> None:
        text_engine.write_about("Haggling at a market", "dialogue")
        await settle(text_engine)

    run(write)
    assert text_model.efforts_seen == [None]
