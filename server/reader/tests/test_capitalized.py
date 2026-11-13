from typing import Any

from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.reader import render_sentence

EAT = ("essen", "to eat")
FOOD = ("Essen", "food")


def words(sentence: str, *entries: tuple[str, str]) -> dict[str, dict[str, Any]]:
    deck = [Entry(i, text, meaning, "mature") for i, (text, meaning) in enumerate(entries)]
    meanings = {e.text: e.meaning for e in deck}
    out = render_sentence(sentence, lexicon_from(deck, "de", common=0), meanings, {})
    return {w["text"]: w for w in out if w["text"].strip()}


def test_a_noun_spelled_like_a_deck_verb_does_not_take_the_verbs_meaning() -> None:
    noun = words("Das Essen ist gut.", EAT)["Essen"]
    assert noun["gloss"] is None and noun["deck"] is False and noun["status"] == "unknown"
    # the verb itself is still the deck word
    verb = words("Wir essen gern.", EAT)["essen"]
    assert verb["gloss"] == "to eat" and verb["deck"] is True and verb["status"] == "known"


def test_a_noun_and_a_verb_in_the_deck_each_find_their_own_entry() -> None:
    both = words("Das Essen ist gut. Wir essen gern.", EAT, FOOD)
    assert both["Essen"]["gloss"] == "food"
    assert both["essen"]["gloss"] == "to eat"


def test_a_noun_written_with_its_article_is_still_a_noun_entry() -> None:
    assert words("Das Essen ist gut.", ("das Essen", "food"))["Essen"]["gloss"] == "food"


def test_a_capitalized_first_word_of_a_sentence_still_matches_a_verb() -> None:
    assert words("Essen ist gut.", EAT)["Essen"]["gloss"] == "to eat"
    # and the next sentence starts again
    assert words("Es ist gut. Essen ist schön.", EAT)["Essen"]["gloss"] == "to eat"


def test_the_polite_sie_is_left_alone() -> None:
    assert words("Wie geht es Ihnen und Sie?", ("sie", "she"))["Sie"]["deck"] is True


def test_another_language_is_left_alone() -> None:
    deck = [Entry(1, "essen", "to eat", "mature")]
    out = render_sentence("The Essen.", lexicon_from(deck, "en"), {"essen": "to eat"}, {})
    assert next(w for w in out if w["text"] == "Essen")["deck"] is True
