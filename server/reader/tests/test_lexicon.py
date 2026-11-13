from pathlib import Path

from fake_anki import card, note

from franki_reader.lexicon import (
    THAI_NOTES_QUERY,
    Entry,
    build_entries,
    clean,
    days_until_due,
    lexicon_from,
)

# Real entries and meanings from the Thai deck.
NOTES = [
    note(1772113047610, "ฉัน", "I; me (feminine)"),
    note(1788968359270, "รับอะไรดี", "what would you like? (server asking for order)"),
    note(1788968259380, "ข้าวเหนียวมะม่วง", "mango sticky rice"),
    note(1775529304199, "ดี", "good; well"),
]
CARDS = [
    card(1772113047610, 2, 320),
    card(1772113047610, 2, 286),
    card(1788968359270, 2, 5),
    card(1788968259380, 0, 0),
    card(1775529304199, 2, 40),
    card(1775529304199, 0, 0),
    card(9999, 2, 100),  # a Consonant Classes card: its note isn't in the Thai query
]


def test_entries_get_their_tier_from_their_cards() -> None:
    tiers = {e.text: e.tier for e in build_entries(NOTES, CARDS)}
    assert tiers == {
        "ฉัน": "mature",
        "รับอะไรดี": "young",
        "ข้าวเหนียวมะม่วง": "unreviewed",
        "ดี": "mature",
    }


def test_a_note_with_no_cards_is_unreviewed() -> None:
    assert build_entries([note(1, "ไป", "go")], [])[0].tier == "unreviewed"


def test_unreviewed_notes_are_not_known_for_coverage() -> None:
    known = lexicon_from(build_entries(NOTES, CARDS)).known
    assert known == {"ฉัน", "รับอะไรดี", "ดี"}


def test_a_note_whose_reviewed_cards_are_all_suspended_is_unreviewed() -> None:
    # A leech the preset suspended: the word the learner keeps failing isn't known.
    leech = [note(1, "ยาก", "hard")]
    assert build_entries(leech, [card(1, 2, 40, suspended=True)])[0].tier == "unreviewed"
    relearning = [card(1, 3, 2, suspended=True), card(1, 0, 0)]
    assert build_entries(leech, relearning)[0].tier == "unreviewed"
    assert lexicon_from(build_entries(leech, [card(1, 2, 40, suspended=True)])).known == set()


def test_a_suspended_card_leaves_the_tier_to_the_notes_other_cards() -> None:
    word = [note(1, "ยาก", "hard")]
    # The suspended card was the weakest: the note is as known as its unsuspended one.
    assert build_entries(word, [card(1, 2, 3, suspended=True), card(1, 2, 40)])[0].tier == "mature"
    assert build_entries(word, [card(1, 2, 40, suspended=True), card(1, 2, 3)])[0].tier == "young"


TODAY = 400  # the collection's day number
CUTOFF = 1_800_000_000  # when the next study day starts, Unix seconds


def test_days_until_due_reads_a_day_number_or_a_learning_steps_time() -> None:
    assert days_until_due(2, 2, TODAY, TODAY, CUTOFF) == 0  # a review due today
    assert days_until_due(2, 2, TODAY - 3, TODAY, CUTOFF) == -3  # overdue
    assert days_until_due(2, 2, TODAY + 5, TODAY, CUTOFF) == 5
    assert days_until_due(1, 3, TODAY + 1, TODAY, CUTOFF) == 1  # a step that crossed into tomorrow
    assert days_until_due(1, 1, CUTOFF - 600, TODAY, CUTOFF) == 0  # a step later today
    assert days_until_due(3, 1, CUTOFF + 600, TODAY, CUTOFF) == 1  # past the rollover: tomorrow
    assert days_until_due(2, -2, TODAY + 2, TODAY, CUTOFF) == 2  # buried: due as it would be
    assert days_until_due(0, 0, 12, TODAY, CUTOFF) is None  # new: its due is a position
    assert days_until_due(2, -1, TODAY, TODAY, CUTOFF) is None  # suspended


def test_an_entry_is_due_until_every_due_card_is_answered_today() -> None:
    word = [note(1, "ดี", "good")]
    due = build_entries(word, [card(1, 2, 5, due=True, due_in=0), card(1, 2, 9, due_in=4)])[0]
    assert (due.due, due.reviewed, due.due_in) == (True, False, 0)
    # Answered today, and again in relearning (is:due again): reviewed, and no longer waiting.
    done = build_entries(word, [card(1, 3, 1, due=True, rated=True, due_in=0)])[0]
    assert (done.due, done.reviewed) == (False, True)
    # One card answered, its reverse still due: still waiting for that review.
    half = [card(1, 2, 5, rated=True, due_in=3), card(1, 2, 5, due=True, due_in=0)]
    assert build_entries(word, half)[0].due
    # A suspended card never comes due.
    leech = build_entries(word, [card(1, 2, 5, suspended=True, due_in=0), card(1, 2, 9, due_in=4)])
    assert leech[0].due_in == 4


def test_a_withheld_thai_word_is_unknown_even_when_it_splits_into_known_ones() -> None:
    deck = [Entry(1, "เข้า", "to enter", "mature"), Entry(2, "ใจ", "heart", "mature")]
    deck.append(Entry(3, "เข้าใจ", "to understand", "young"))
    writing = lexicon_from(deck, withheld=["เข้าใจ"])
    assert lexicon_from(deck).status("เข้าใจ") == "known"
    assert writing.status("เข้าใจ") == "unknown"
    assert writing.status("เข้า") == "known"
    assert "เข้าใจ" not in writing.known


def test_clean_strips_html_and_entities() -> None:
    assert clean("<b>ไป</b>&nbsp;") == "ไป"
    assert clean("go <br>away") == "go away"


def test_an_empty_entry_is_skipped() -> None:
    assert build_entries([note(1, "<br>", "nothing")], []) == []


def test_the_thai_query_leaves_out_the_consonant_cards() -> None:
    assert '-"deck:👅 Languages::🐘 ภาษาไทย::🏛 Consonant Classes"' in THAI_NOTES_QUERY


def test_a_chosen_deck_keeps_the_languages_skipped_subdecks() -> None:
    from franki_reader.languages import with_deck

    assert with_deck("th", None).notes_query == THAI_NOTES_QUERY
    assert with_deck("th", "Mine").notes_query == '"deck:Mine" -"deck:Mine::🏛 Consonant Classes"'
    assert with_deck("es", "Mío").notes_query == '"deck:Mío"'


def test_a_chosen_decks_name_is_searched_literally(tmp_path: Path) -> None:
    """Wildcards and quotes in a deck name match only that deck, as Anki's own search string does."""
    from anki.collection import Collection, SearchNode

    from franki_reader.languages import with_deck

    col = Collection(str(tmp_path / "collection.anki2"))
    try:
        names = ["W::a_b", "W::axb", "W::st*r", "W::stXr", 'W::q"uote', "W::back\\slash"]
        basic = col.models.by_name("Basic")
        assert basic
        for name in names:
            note = col.new_note(basic)
            note["Front"] = name
            deck = col.decks.id(name)
            assert deck
            col.add_note(note, deck)
        for name in names:
            query = with_deck("es", name).notes_query
            # Anki quotes a term only when it holds a space, and none of these do.
            assert query == f'"{col.build_search_string(SearchNode(deck=name))}"'
            assert [col.get_note(n)["Front"] for n in col.find_notes(query)] == [name]
    finally:
        col.close()
