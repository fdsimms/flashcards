import random

from fake_anki import card, note

from franki_reader.lexicon import Entry, build_entries
from franki_reader.stretch import due_soon, pick_stretch, reviewed_words, waiting

ENTRIES = [
    Entry(1, "ฉัน", "I", "mature", due_in=30),
    Entry(2, "ดี", "good", "mature", reviewed=True, due_in=40),  # reviewed today
    Entry(3, "ไป", "go", "young", due_in=6),
    Entry(4, "มา", "come", "young", reviewed=True, due_in=2),  # reviewed today
    Entry(5, "ทอน", "give change", "unreviewed"),
    Entry(6, "กิน", "eat", "young", due=True, due_in=0),  # due today, not reviewed yet
    Entry(7, "นอน", "sleep", "mature", due=True, due_in=0),  # due today, not reviewed yet
]


def texts(entries: list[Entry]) -> set[str]:
    return {e.text for e in entries}


def test_young_words_come_first_then_the_ones_reviewed_today() -> None:
    # A word just reviewed is at its strongest, so it's the last resort.
    picked = pick_stretch(ENTRIES, 3, random.Random(1))
    assert picked[0].text == "ไป"
    assert texts(picked[1:]) == {"ดี", "มา"}


def test_the_most_fragile_young_word_comes_first() -> None:
    entries = [
        Entry(1, "ไป", "go", "young", due_in=6, stability=20.0),
        Entry(2, "อยู่", "be", "young", due_in=8, stability=5.0),
        Entry(3, "เห็น", "see", "young", due_in=9, stability=None),  # no memory state read
    ]
    for seed in range(5):
        picked = pick_stretch(entries, 3, random.Random(seed))
        assert [e.text for e in picked] == ["อยู่", "ไป", "เห็น"]


def test_a_young_word_due_within_two_days_is_left_out_unless_reviewed_today() -> None:
    entries = [
        Entry(1, "ไป", "go", "young", due_in=3, stability=1.0),  # 3 days out: fine
        Entry(2, "อยู่", "be", "young", due_in=2, stability=1.0),  # due the day after tomorrow
        Entry(3, "เห็น", "see", "young", due_in=1, stability=1.0),
        Entry(
            4, "มา", "come", "young", reviewed=True, due_in=1
        ),  # just reviewed: next review is far
    ]
    assert texts(pick_stretch(entries, 10, random.Random(1))) == {"ไป", "มา"}
    # Two study days after the snapshot, the first is one day from its review.
    assert texts(pick_stretch(entries, 10, random.Random(1), days=2)) == set()
    assert due_soon(entries[0], 1) and not due_soon(entries[0], 0)
    assert not due_soon(Entry(9, "x", "x", "young"), 0)  # no due date read


def test_a_word_due_today_and_not_yet_reviewed_is_never_picked() -> None:
    # Read in context just before its review, the review would be short-term recall (principle 9).
    picked = texts(pick_stretch(ENTRIES, 10, random.Random(1)))
    assert picked == {"ดี", "มา", "ไป"}
    assert "กิน" not in texts(pick_stretch(ENTRIES, 10, random.Random(1), {"กิน": 1}))


def test_a_note_with_one_card_reviewed_today_and_another_still_due_waits() -> None:
    entries = build_entries(
        [note(1, "กิน", "eat"), note(2, "ไป", "go")],
        [
            card(1, 2, 5, rated=True, due_in=4),  # answered today
            card(1, 2, 5, due=True, due_in=0),  # its reverse card, not answered yet
            card(2, 2, 5, due=True, rated=True, due_in=0),  # answered today, again in relearning
        ],
    )
    assert [e.text for e in pick_stretch(entries, 3, random.Random(1))] == ["ไป"]
    assert [e.text for e in reviewed_words(entries)] == ["ไป"]


def test_count_is_respected() -> None:
    assert len(pick_stretch(ENTRIES, 1, random.Random(1))) == 1
    assert pick_stretch(ENTRIES, 0, random.Random(1)) == []


def test_only_words_reviewed_today_for_the_shelfs_due_text() -> None:
    picked = pick_stretch(ENTRIES, 10, random.Random(1), reviewed_only=True)
    assert texts(picked) == {"ดี", "มา"}
    assert pick_stretch(ENTRIES, 10, random.Random(1), {"ไป": 1}, reviewed_only=True)[0].text in {
        "ดี",
        "มา",
    }


def test_a_snapshot_from_an_earlier_day_reads_due_dates_not_todays_flags() -> None:
    # Two study days after the snapshot: nothing it read as reviewed was reviewed today, and a word
    # whose card has come due since is waiting for its review.
    picked = texts(pick_stretch(ENTRIES, 10, random.Random(1), days=2))
    assert picked == {"ไป"}  # มา came due on day 2; ไป is due on day 6
    assert reviewed_words(ENTRIES, days=2) == []
    assert not waiting(ENTRIES[2], 5) and waiting(ENTRIES[2], 6)
    # A studied note with no due date read is taken as waiting.
    assert waiting(Entry(9, "x", "x", "young"), 1)


def test_a_word_practiced_on_an_earlier_day_comes_back_first() -> None:
    picked = pick_stretch(ENTRIES, 3, random.Random(1), {"ไป": 1})
    assert picked[0].text == "ไป"
    assert texts(picked[1:]) == {"ดี", "มา"}


def test_a_word_stops_coming_back_after_three_days() -> None:
    entries = [
        Entry(1, "ไป", "go", "young", due_in=6, stability=20.0),
        Entry(2, "อยู่", "be", "young", due_in=8, stability=5.0),
    ]
    assert pick_stretch(entries, 2, random.Random(1), {"ไป": 1})[0].text == "ไป"
    assert pick_stretch(entries, 2, random.Random(1), {"ไป": 3})[0].text == "อยู่"


def test_a_practiced_word_that_has_matured_is_left_alone() -> None:
    picked = texts(pick_stretch(ENTRIES, 10, random.Random(1), {"ฉัน": 1}))
    assert "ฉัน" not in picked


def test_words_used_earlier_today_go_last_but_still_fill_a_pick() -> None:
    # ดี and มา were practiced in a text read earlier today: ไป goes first, and they follow.
    picked = pick_stretch(ENTRIES, 3, random.Random(1), today={"ดี", "มา"})
    assert picked[0].text == "ไป"
    assert texts(picked[1:]) == {"ดี", "มา"}
    # With room for two, a repeat is never the only kind of word while a fresh one is left.
    assert "ไป" in texts(pick_stretch(ENTRIES, 2, random.Random(1), today={"ดี", "มา"}))
    # With no fresh word at all, the pick is only repeats, so one of them is dropped for now.
    assert len(pick_stretch(ENTRIES, 3, random.Random(1), today={"ดี", "มา", "ไป"})) == 2
    assert len(pick_stretch(ENTRIES, 2, random.Random(1), today={"ดี", "มา", "ไป"})) == 1
    # A single practice word is kept: dropping it would leave the text with none.
    assert len(pick_stretch(ENTRIES, 1, random.Random(1), today={"ดี", "มา", "ไป"})) == 1


def test_a_returning_word_used_earlier_today_does_not_lead_again() -> None:
    picked = pick_stretch(ENTRIES, 2, random.Random(1), {"ไป": 1}, today={"ไป"})
    assert "ไป" not in texts(picked)


def test_a_suspended_leech_is_never_a_stretch_word() -> None:
    entries = build_entries(
        [note(1, "ยาก", "hard"), note(2, "ไป", "go")],
        # Young, and practiced on an earlier day, but suspended as a leech (is:due leaves it out).
        [card(1, 2, 5, suspended=True), card(2, 2, 5, due_in=3)],
    )
    assert [e.text for e in pick_stretch(entries, 3, random.Random(1), {"ยาก": 1})] == ["ไป"]
