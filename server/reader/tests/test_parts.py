from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.reader import compound_parts, render_parts

ENTRIES = [
    Entry(1, "ความคิด", "idea; thought", "mature"),
    Entry(2, "คิด", "to think", "mature"),
    Entry(3, "กลับบ้าน", "to go home", "mature"),
    Entry(4, "กลับ", "to return", "mature"),
    Entry(5, "บ้าน", "home", "mature"),
]
MEANINGS = {e.text: e.meaning for e in ENTRIES}


def test_a_compound_splits_into_the_words_it_is_made_of_though_it_is_a_word_itself() -> None:
    lexicon = lexicon_from(ENTRIES)
    assert compound_parts("ความคิด", lexicon) == ["ความ", "คิด"]
    assert compound_parts("กลับบ้าน", lexicon) == ["กลับ", "บ้าน"]


def test_a_single_word_or_a_phrase_or_other_script_does_not_split() -> None:
    lexicon = lexicon_from(ENTRIES)
    assert compound_parts("บ้าน", lexicon) is None
    assert compound_parts("ก", lexicon) is None
    assert compound_parts("ฉันกลับบ้าน ฉันกลับบ้านและก็นอน ฉันกลับบ้านแล้ว", lexicon) is None
    assert compound_parts("home", lexicon) is None


def test_other_languages_have_no_split() -> None:
    assert (
        compound_parts("Haustür", lexicon_from([Entry(1, "Haustür", "front door", "mature")], "de"))
        is None
    )


def test_the_parts_come_back_as_words_that_join_to_the_headword_each_glossed_by_the_deck() -> None:
    words = render_parts("ความคิด", lexicon_from(ENTRIES), MEANINGS, {"คิด": "khít"})
    assert [w["text"] for w in words] == ["ความ", "คิด"]
    think = words[1]
    assert think["gloss"] == "to think" and think["translit"] == "khít" and think["deck"] is True
    assert (
        words[0]["gloss"] is None and words[0]["deck"] is False
    )  # ความ is asked for in the background


def test_a_headword_that_does_not_split_comes_back_whole() -> None:
    words = render_parts("บ้าน", lexicon_from(ENTRIES), MEANINGS, {})
    assert [w["text"] for w in words] == ["บ้าน"]
