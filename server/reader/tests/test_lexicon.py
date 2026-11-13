from pathlib import Path

from fake_anki import card, note

from franki_reader.lexicon import THAI_NOTES_QUERY, build_entries, clean, lexicon_from

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
