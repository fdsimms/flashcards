from franki_reader.kanji import MAX_MEANINGS, kanji_of


def test_a_word_gives_each_kanji_with_its_meaning_and_readings() -> None:
    kanji = kanji_of("肌寒いです")
    assert kanji is not None
    assert [k["char"] for k in kanji] == ["肌", "寒"]
    assert kanji[1]["meanings"] == ["cold"]
    assert kanji[1]["on"] == ["カン"] and kanji[1]["kun"] == ["さむ.い"]
    assert kanji[1]["strokes"] == 12


def test_a_repeated_kanji_is_listed_once() -> None:
    kanji = kanji_of("人々人")
    assert kanji is not None and [k["char"] for k in kanji] == ["人"]


def test_a_word_with_no_kanji_has_none() -> None:
    assert kanji_of("です") is None
    assert kanji_of("hello") is None
    assert kanji_of("") is None


def test_meanings_are_capped() -> None:
    kanji = kanji_of("生")
    assert kanji is not None and len(kanji[0]["meanings"]) <= MAX_MEANINGS
