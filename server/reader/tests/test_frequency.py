from franki_reader.frequency import EntryPlace, entry_place, rank_of
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
    # Spoken Thai counts as much as written: the polite particles and a loan word said every day.
    assert (rank_of("ครับ", lexicon) or 10**6) < 100
    assert (rank_of("โอเค", lexicon) or 10**6) < 500
    assert (rank_of("ป่ะ", lexicon) or 10**6) < 10000
    assert rank_of("ๆ", lexicon) is None
    assert rank_of("เชียร์ลีดเดอร์", lexicon) is None
    assert lexicon.status("กิน") == "unknown"  # ranked, but not known without the deck
    assert not LANGUAGES["th"].counts_common


def test_japanese_is_ranked_by_the_dictionary_form() -> None:
    lexicon = lexicon_from([], "ja")
    assert rank_of("行きました", lexicon) == rank_of("行く", lexicon)
    assert rank_of("行く", lexicon) is not None


def test_an_entry_is_ranked_without_its_article_or_gender_word() -> None:
    pl = lexicon_from([], "pl")
    assert entry_place("ten mężczyzna", pl) == entry_place("mężczyzna", pl)
    assert entry_place("ten mężczyzna", pl).rank is not None
    es = lexicon_from([], "es")
    assert entry_place("la casa", es) == EntryPlace(common_lemmas("es").index("casa") + 1)
    # A reflexive marker goes too (bać się), and the better of two alternatives is the place.
    assert entry_place("bać się", pl) == entry_place("bać", pl)
    de = lexicon_from([], "de")
    assert entry_place("der/die Kollege", de).rank == entry_place("Kollege", de).rank


def test_an_entry_of_several_words_is_a_phrase_and_a_single_word_never_is() -> None:
    assert entry_place("mantener a raya", lexicon_from([], "es")) == EntryPlace(None, phrase=True)
    assert entry_place("dzień dobry", lexicon_from([], "pl")) == EntryPlace(None, phrase=True)
    assert entry_place("ornitorrinco", lexicon_from([], "es")) == EntryPlace(None, phrase=False)


def test_a_thai_entry_the_dictionary_cuts_into_words_is_a_phrase() -> None:
    th = lexicon_from([], "th")
    assert entry_place("ยินดีที่ได้รู้จัก", th) == EntryPlace(None, phrase=True)
    assert entry_place("ที่", th) == EntryPlace(1)


def test_thai_words_written_with_a_leading_vowel_and_one_letter_are_on_the_list() -> None:
    # ไป and ใน were dropped as broken words when the list was built.
    th = lexicon_from([], "th")
    assert (rank_of("ไป", th) or 10**6) < 100
    assert (rank_of("ใน", th) or 10**6) < 100
