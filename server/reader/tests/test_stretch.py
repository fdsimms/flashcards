import random

from fake_anki import card, note

from franki_reader.lexicon import Entry, build_entries
from franki_reader.stretch import pick_stretch, reviewed_words, waiting

ENTRIES = [
    Entry(1, "ฉัน", "I", "mature", due_in=30),
    Entry(2, "ดี", "good", "mature", reviewed=True, due_in=40),  # reviewed today
    Entry(3, "ไป", "go", "young", due_in=3),
    Entry(4, "มา", "come", "young", reviewed=True, due_in=2),  # reviewed today
    Entry(5, "ทอน", "give change", "unreviewed"),
    Entry(6, "กิน", "eat", "young", due=True, due_in=0),  # due today, not reviewed yet
    Entry(7, "นอน", "sleep", "mature", due=True, due_in=0),  # due today, not reviewed yet
]


def texts(entries: list[Entry]) -> set[str]:
    return {e.text for e in entries}


def test_words_reviewed_today_come_first_then_young() -> None:
    picked = pick_stretch(ENTRIES, 3, random.Random(1))
    assert texts(picked[:2]) == {"ดี", "มา"}
    assert picked[2].text == "ไป"


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
    assert picked == {"ไป"}  # มา came due on day 2; ไป is due on day 3
    assert reviewed_words(ENTRIES, days=2) == []
    assert not waiting(ENTRIES[2], 2) and waiting(ENTRIES[2], 3)
    # A studied note with no due date read is taken as waiting.
    assert waiting(Entry(9, "x", "x", "young"), 1)


def test_a_word_practiced_on_an_earlier_day_comes_back_first() -> None:
    picked = pick_stretch(ENTRIES, 3, random.Random(1), {"ไป": 1})
    assert picked[0].text == "ไป"
    assert texts(picked[1:]) == {"ดี", "มา"}


def test_a_word_stops_coming_back_after_three_days() -> None:
    picked = pick_stretch(ENTRIES, 3, random.Random(1), {"ไป": 3})
    assert picked[2].text == "ไป"


def test_a_practiced_word_that_has_matured_is_left_alone() -> None:
    picked = texts(pick_stretch(ENTRIES, 10, random.Random(1), {"ฉัน": 1}))
    assert "ฉัน" not in picked


def test_a_suspended_leech_is_never_a_stretch_word() -> None:
    entries = build_entries(
        [note(1, "ยาก", "hard"), note(2, "ไป", "go")],
        # Young, and practiced on an earlier day, but suspended as a leech (is:due leaves it out).
        [card(1, 2, 5, suspended=True), card(2, 2, 5, due_in=3)],
    )
    assert [e.text for e in pick_stretch(entries, 3, random.Random(1), {"ยาก": 1})] == ["ไป"]
