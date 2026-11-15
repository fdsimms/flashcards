"""IPA for the word popup: Wiktionary's tables, looked up by the word as written (ipa.py). The
expected values are what the tables hold, checked against Wiktionary's entries."""

import unicodedata

import pytest

from franki_reader import ipa
from franki_reader.coverage import Lexicon
from franki_reader.japanese import JapaneseLexicon
from franki_reader.reader import word_out
from franki_reader.spaced import SpacedLexicon


def test_a_form_has_its_own_ipa_not_its_lemmas() -> None:
    # Russian stress moves between forms, so доме isn't дом's pronunciation.
    assert ipa.ipa_of("дом", "ru") != ipa.ipa_of("доме", "ru")
    assert ipa.ipa_of("доме", "ru") is not None


def test_a_word_is_found_in_lower_case() -> None:
    assert ipa.ipa_of("Подобный", "ru") == ipa.ipa_of("подобный", "ru")


def test_the_word_is_matched_in_one_unicode_form() -> None:
    # й typed as и and a combining breve is the same word.
    decomposed = unicodedata.normalize("NFD", "подобный")
    assert decomposed != "подобный"
    assert ipa.ipa_of(decomposed, "ru") == ipa.ipa_of("подобный", "ru") is not None


@pytest.mark.parametrize("code", ["ru", "pl", "de", "es", "fr", "el", "nb", "th"])
def test_every_table_is_words_and_ipa(code: str) -> None:
    words = ipa.table(code)
    assert len(words) > 5000
    assert all(w and " " not in w and v for w, v in words.items())


def test_a_language_with_no_table_has_none() -> None:
    assert ipa.table("en") == {} and ipa.table("ja") == {}
    assert ipa.ipa_of("house", "en") is None


def test_a_token_shows_its_ipa_and_where_it_is_from() -> None:
    lexicon = SpacedLexicon("ru", [])
    out = word_out("доме", lexicon, {}, {})
    assert out["ipa"] == ipa.ipa_of("доме", "ru") and out["ipa_source"] == "wiktionary"


def test_thai_is_looked_up_with_no_language_code_on_its_lexicon() -> None:
    out = word_out("ทอน", Lexicon([]), {}, {})
    assert out["ipa"] and out["ipa_source"] == "wiktionary"


def test_punctuation_and_phrases_show_none() -> None:
    lexicon = SpacedLexicon("es", [])
    assert ipa.ipa_for(".", lexicon) is None
    assert ipa.ipa_for("a raya", lexicon) is None


def test_japanese_is_written_from_the_reading_by_rule() -> None:
    lexicon = JapaneseLexicon.__new__(JapaneseLexicon)
    assert ipa.ipa_for("劇団", lexicon, "げきだん") == ("/ɡekidaɴ/", "rules")
    # A word in kana is its own reading; a word with neither has none.
    assert ipa.ipa_for("ありがとう", lexicon) == ("/aɾiɡatoː/", "rules")
