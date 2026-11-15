"""The helper words of each language (helpers.py): the files are well formed, name only forms the
language has, and the contractions are right."""

import pytest

from franki_reader import form_primers, helpers
from franki_reader.languages import LANGUAGES

HAS = [c for c in LANGUAGES if helpers.helpers(c)]


def test_every_language_with_cases_or_compound_tenses_has_helpers() -> None:
    assert set(HAS) == {"ru", "pl", "de", "el", "es", "fr", "nb"}


@pytest.mark.parametrize("code", HAS)
def test_a_helper_file_only_names_forms_its_language_has(code: str) -> None:
    data = helpers.helpers(code)
    assert set(data) == {"prepositions", "governs", "with", "contractions"}, code
    names = form_primers.names(code)
    for form in data["with"]:
        assert form in names, (code, form)
    for case in data["governs"].values():
        assert names.get(case, "").endswith(" case"), (code, case)
    # A preposition only helps a case, so a language with none has no cases to put one after.
    if data["prepositions"] or data["governs"]:
        assert any(n.endswith(" case") for n in names.values()), code


@pytest.mark.parametrize("code", HAS)
def test_helper_words_are_lower_case_single_words_without_dashes(code: str) -> None:
    data = helpers.helpers(code)
    words = [
        *data["prepositions"],
        *(w for ws in data["with"].values() for w in ws),
        *data["contractions"],
    ]
    for w in words:
        assert w == w.casefold() and w.isalpha(), (code, w)
    for parts in data["contractions"].values():
        assert "—" not in parts and " + " in parts, (code, parts)


def test_contractions_are_found_by_word_whatever_its_case() -> None:
    assert helpers.contraction("el", "στο") == "σε + το"
    assert helpers.contraction("es", "Al") == "a + el"
    assert helpers.contraction("de", "zum") == "zu + dem"
    assert helpers.contraction("fr", "au") == "à + le"
    # Greek final sigma and German eszett fold the way a line's words do.
    assert helpers.contraction("el", "στους") == "σε + τους"
    assert "προς" not in helpers.helpers("el")["prepositions"]
    assert "προσ" in helpers.helpers("el")["prepositions"]
    assert "ausser" in helpers.helpers("de")["prepositions"]


def test_contractions_that_are_also_plain_words_are_left_out() -> None:
    # French des and du are the plain articles too, German am is the superlative's marker.
    assert helpers.contraction("fr", "des") is None and helpers.contraction("fr", "du") is None
    assert helpers.contraction("de", "am") is None
    assert helpers.contraction("ru", "в") is None and helpers.contraction("th", "x") is None


def test_a_contracted_word_carries_its_parts_to_the_app() -> None:
    from franki_reader.lexicon import Entry, lexicon_from
    from franki_reader.reader import render_sentence

    lexicon = lexicon_from([Entry(1, "σπίτι", "house", "mature")], "el", 1000)
    words = render_sentence("Πάω στο σπίτι.", lexicon, {}, {})
    by_text = {w["text"]: w for w in words}
    assert by_text["στο"]["contraction"] == "σε + το"
    assert by_text["σπίτι"]["contraction"] is None and by_text[" "]["contraction"] is None
