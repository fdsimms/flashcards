from typing import Any

from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.reader import render_sentence

ENTRIES = [
    Entry(1, "schauen", "to look, to watch", "mature"),
    Entry(2, "anschauen", "to look at", "mature"),
    Entry(3, "Oma", "grandma", "mature"),
    Entry(4, "aufstehen", "to get up", "mature"),
]
MEANINGS = {e.text: e.meaning for e in ENTRIES}


def words(sentence: str, entries: list[Entry] = ENTRIES) -> dict[str, dict[str, Any]]:
    out = render_sentence(sentence, lexicon_from(entries, "de"), MEANINGS, {})
    return {w["text"]: w for w in out if w["text"].strip()}


def test_a_split_verb_shows_the_joined_verb_on_both_parts() -> None:
    w = words("Oma schaut Kalila an.")
    for part in ("schaut", "an"):
        assert w[part]["lemma"] == "anschauen"
        assert w[part]["gloss"] == "to look at"
        assert w[part]["deck"] is True


def test_the_verb_alone_keeps_its_own_dictionary_form() -> None:
    assert words("Oma schaut Kalila.")["schaut"]["lemma"] == "schauen"


def test_the_particle_must_end_its_clause() -> None:
    # "an" here begins a prepositional phrase, so schaut is schauen
    assert words("Oma schaut an der Wand.")["schaut"]["lemma"] == "schauen"
    # a comma ends the clause before the particle can reach back across it
    assert words("Oma schaut, Kalila an.")["schaut"]["lemma"] == "schauen"


def test_a_clause_can_go_on_with_und_after_the_particle() -> None:
    assert words("Er steht auf und geht.")["steht"]["lemma"] == "aufstehen"


def test_a_pairing_needs_the_joined_verb_in_the_deck() -> None:
    w = words("Oma schaut Kalila an.", [Entry(1, "schauen", "to look, to watch", "mature")])
    assert w["schaut"]["lemma"] == "schauen"
    assert w["an"]["lemma"] is None


def test_another_language_is_left_alone() -> None:
    lexicon = lexicon_from(ENTRIES, "pl")
    out = render_sentence("Oma schaut an.", lexicon, MEANINGS, {})
    assert all(w["lemma"] != "anschauen" for w in out)


EN = [
    Entry(1, "look up", "to search for", "mature"),
    Entry(2, "turn off", "to switch off", "mature"),
    Entry(3, "look", "to look", "mature"),
]


def en_words(sentence: str, entries: list[Entry] = EN) -> dict[str, dict[str, Any]]:
    meanings = {e.text: e.meaning for e in entries}
    out = render_sentence(sentence, lexicon_from(entries, "en", common=0), meanings, {})
    return {w["text"]: w for w in out if w["text"].strip()}


def test_an_english_phrasal_verb_is_joined_across_a_pronoun() -> None:
    w = en_words("She looks it up.")
    for part in ("looks", "up"):
        assert w[part]["lemma"] == "look up" and w[part]["gloss"] == "to search for"


def test_an_english_phrasal_verb_is_joined_across_a_short_noun_phrase() -> None:
    w = en_words("He turns the old lamp off.")
    assert w["turns"]["lemma"] == "turn off" and w["off"]["gloss"] == "to switch off"


def test_an_english_phrasal_verb_next_to_its_particle_is_left_to_the_segmenter() -> None:
    out = render_sentence("She looks up.", lexicon_from(EN, "en", common=0), {}, {})
    assert [w["text"] for w in out if w["status"]] == ["She", "looks up"]


def test_an_english_particle_that_starts_another_phrase_is_not_joined() -> None:
    assert en_words("She looks at it up there.")["looks"]["lemma"] != "look up"
    assert en_words("She looks, he sits up.")["looks"]["lemma"] != "look up"
    # no object of the allowed shape between them
    assert en_words("She looks very carefully up.")["looks"]["lemma"] != "look up"


def test_an_english_pairing_needs_the_phrase_in_the_deck() -> None:
    assert (
        en_words("She looks it up.", [Entry(3, "look", "to look", "mature")])["up"]["lemma"] is None
    )


NB = [Entry(1, "å slå opp", "to look up", "mature"), Entry(2, "å skru av", "to turn off", "mature")]


def nb_words(sentence: str, entries: list[Entry] = NB) -> dict[str, dict[str, Any]]:
    meanings = {e.text: e.meaning for e in entries}
    out = render_sentence(sentence, lexicon_from(entries, "nb", common=0), meanings, {})
    return {w["text"]: w for w in out if w["text"].strip()}


def test_a_norwegian_phrasal_verb_is_joined_across_a_pronoun_or_a_definite_noun() -> None:
    for sentence, verb, particle in [
        ("Hun slår det opp.", "slår", "opp"),
        ("Han skrur lyset av.", "skrur", "av"),
        ("Han skrur den gamle lampen av.", "skrur", "av"),
    ]:
        w = nb_words(sentence)
        assert w[verb]["lemma"] == w[particle]["lemma"] and w[verb]["lemma"].startswith("å ")


def test_a_norwegian_particle_that_begins_another_phrase_is_not_joined() -> None:
    assert nb_words("Hun slår på bordet opp.")["slår"]["lemma"] != "å slå opp"
