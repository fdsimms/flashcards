"""Which languages get a reading task today (read_plan.py)."""

from datetime import datetime, timedelta

from franki_reader import read_plan, store
from franki_reader.read_plan import Reading, plan

DAY = datetime(2026, 11, 19, 9, 0)  # the study day began at 4 AM Eastern, naive UTC


def lang(code: str, name: str, waiting: int = 1, days_ago: float | None = None) -> Reading:
    """A language, last read `days_ago` days before the day began (negative: since it began)."""
    last = None if days_ago is None else DAY - timedelta(days=days_ago)
    return Reading(code, name, waiting, last)


def codes(entries: list[read_plan.Entry]) -> list[str]:
    return [e.language for e in entries]


def test_a_rotating_language_read_least_recently_goes_first() -> None:
    langs = [
        lang("de", "German", days_ago=1),
        lang("pl", "Polish", days_ago=6),
        lang("es", "Spanish", days_ago=3),
    ]
    assert codes(plan(langs, {}, 1, DAY, [])) == ["pl"]
    assert codes(plan(langs, {}, 2, DAY, [])) == ["pl", "es"]


def test_a_language_never_read_goes_before_one_that_was() -> None:
    langs = [lang("de", "German", days_ago=1), lang("el", "Greek")]
    assert codes(plan(langs, {}, 1, DAY, [])) == ["el"]


def test_of_the_languages_never_read_the_one_with_most_texts_waiting_goes_first() -> None:
    # German comes first by name, but Japanese has more waiting.
    langs = [lang("de", "German", waiting=1), lang("ja", "Japanese", waiting=3)]
    assert codes(plan(langs, {}, 1, DAY, [])) == ["ja"]
    # With equal shelves it falls back to the name, so the order is stable.
    even = [lang("ja", "Japanese"), lang("de", "German")]
    assert codes(plan(even, {}, 1, DAY, [])) == ["de"]


def test_a_language_with_nothing_waiting_is_not_picked() -> None:
    langs = [lang("pl", "Polish", waiting=0, days_ago=9), lang("de", "German", days_ago=1)]
    assert codes(plan(langs, {}, 1, DAY, [])) == ["de"]


def test_toki_pona_has_no_daily_task_until_one_is_chosen_for_it() -> None:
    assert read_plan.default_mode("tok") == "off" and read_plan.default_mode("de") == "rotate"
    langs = [
        lang("de", "German", days_ago=1),
        lang("tok", "Toki Pona"),
    ]  # never read: it would go first
    assert codes(plan(langs, {}, 2, DAY, [])) == ["de"]
    assert codes(plan(langs, {"tok": "rotate"}, 2, DAY, [])) == ["tok", "de"]


def test_every_day_languages_are_always_listed_and_do_not_use_up_the_rotation() -> None:
    langs = [
        lang("th", "Thai", days_ago=0.5),
        lang("de", "German", days_ago=1),
        lang("pl", "Polish", days_ago=6),
    ]
    entries = plan(langs, {"th": "daily"}, 1, DAY, [])
    assert codes(entries) == ["th", "pl"]
    assert [e.mode for e in entries] == ["daily", "rotate"]


def test_an_every_day_language_with_nothing_waiting_is_left_out_until_it_is_read() -> None:
    assert plan([lang("th", "Thai", waiting=0, days_ago=1)], {"th": "daily"}, 1, DAY, []) == []
    read_today = [lang("th", "Thai", waiting=0, days_ago=-0.1)]
    assert [(e.language, e.done) for e in plan(read_today, {"th": "daily"}, 1, DAY, [])] == [
        ("th", True)
    ]


def test_a_language_set_to_off_is_never_listed() -> None:
    langs = [lang("th", "Thai", days_ago=2), lang("nb", "Norwegian", days_ago=9)]
    assert codes(plan(langs, {"nb": "off", "th": "off"}, 3, DAY, [])) == []


def test_a_rotating_language_read_on_its_own_today_counts_as_the_turn() -> None:
    # Spanish was read this morning without being picked, so the one turn is spent.
    langs = [lang("es", "Spanish", days_ago=-0.1), lang("pl", "Polish", days_ago=6)]
    entries = plan(langs, {}, 1, DAY, [])
    assert [(e.language, e.done) for e in entries] == [("es", True)]


def test_reading_another_language_drops_an_unread_pick_once_the_turns_are_filled() -> None:
    # Polish was picked, then Spanish was read on its own: one turn a day, so Polish's task goes.
    langs = [lang("es", "Spanish", days_ago=-0.1), lang("pl", "Polish", days_ago=6)]
    assert [(e.language, e.done) for e in plan(langs, {}, 1, DAY, ["pl"])] == [("es", True)]
    # With two turns a day Polish keeps its place.
    assert codes(plan(langs, {}, 2, DAY, ["pl"])) == ["pl", "es"]


def test_picks_stay_for_the_day_and_a_lower_count_never_takes_one_away() -> None:
    langs = [lang("pl", "Polish", days_ago=6), lang("es", "Spanish", days_ago=3)]
    assert codes(plan(langs, {}, 1, DAY, ["es"])) == ["es"]
    assert codes(plan(langs, {}, 1, DAY, ["pl", "es"])) == ["pl", "es"]
    # A pick whose language has been set to Off is dropped.
    assert codes(plan(langs, {"es": "off"}, 1, DAY, ["es"])) == ["pl"]


def test_today_keeps_its_picks_across_reads_and_forgets_them_on_a_new_day() -> None:
    conn = store.connect(":memory:")
    settings = store.Settings()
    langs = [lang("pl", "Polish", days_ago=6), lang("es", "Spanish", days_ago=3)]
    assert codes(read_plan.today(conn, langs, settings, DAY)) == ["pl"]
    # Polish gets read to the end, then Spanish's turn would come: it doesn't, the day already has its one.
    after = [lang("pl", "Polish", days_ago=-0.2), langs[1]]
    assert codes(read_plan.today(conn, after, settings, DAY)) == ["pl"]
    assert store.load_read_plan(conn) == (DAY, ["pl"])
    # The next study day starts again from what was read.
    tomorrow = DAY + timedelta(days=1)
    assert codes(read_plan.today(conn, after, settings, tomorrow)) == ["es"]


def test_german_read_last_night_is_not_picked_before_languages_read_longer_ago() -> None:
    # The case this was written for: German finished at 10:56 PM, the day before this one began.
    langs = [
        lang("de", "German", waiting=3, days_ago=0.2),
        lang("el", "Greek", waiting=3),
        lang("ja", "Japanese", waiting=3),
        lang("es", "Spanish", waiting=1, days_ago=6),
    ]
    assert codes(plan(langs, {}, 1, DAY, [])) == ["el"]
