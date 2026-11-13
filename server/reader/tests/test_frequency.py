from franki_reader.frequency import rank_of
from franki_reader.languages import LANGUAGES
from franki_reader.lexicon import lexicon_from
from franki_reader.spaced import common_lemmas


def test_a_spanish_form_is_ranked_by_its_dictionary_form() -> None:
    lexicon = lexicon_from([], "es")
    assert rank_of("hablé", lexicon) == rank_of("hablar", lexicon)
    assert rank_of("el", lexicon) == 1
    assert rank_of("casa", lexicon) == common_lemmas("es").index("casa") + 1


def test_a_word_past_the_end_of_the_list_has_no_rank() -> None:
    assert rank_of("ornitorrinco", lexicon_from([], "es")) is None


def test_punctuation_and_phrases_have_no_rank() -> None:
    lexicon = lexicon_from([], "es")
    assert rank_of("¿", lexicon) is None
    assert rank_of("mantener a raya", lexicon) is None


def test_thai_is_ranked_by_the_word_and_still_counts_only_its_deck_as_known() -> None:
    lexicon = lexicon_from([], "th")
    assert rank_of("ที่", lexicon) == 1
    assert 1 < (rank_of("กิน", lexicon) or 0) < 1000
    assert rank_of("เชียร์ลีดเดอร์", lexicon) is None
    assert lexicon.status("กิน") == "unknown"  # ranked, but not known without the deck
    assert not LANGUAGES["th"].counts_common


def test_japanese_is_ranked_by_the_dictionary_form() -> None:
    lexicon = lexicon_from([], "ja")
    assert rank_of("行きました", lexicon) == rank_of("行く", lexicon)
    assert rank_of("行く", lexicon) is not None
