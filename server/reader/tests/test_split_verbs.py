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
