"""Verbs split by other words in a rendered line. In German, "Oma schaut Kalila an" is anschauen, not
schauen, but the words are segmented one at a time, so schaut alone would be shown as a form of
schauen with schauen's meaning. In English, "She looks it up" is look up (a deck phrase), though the
segmenter only joins a phrase whose words are next to each other.

German: a particle that ends its clause is joined to the nearest word before it in that clause whose
dictionary form with the particle in front is a studied deck entry (an + schauen = anschauen).
English: a particle after a short object (a pronoun, or a determiner and up to two more words) is
joined to the verb before the object when "verb particle" is a studied deck phrase.

Only a verb that is really in the deck is joined, so no pairing is guessed: a line that has no such
entry is left as segmented. Both words then show the entry's dictionary form and meaning, and a
practice word is marked on both, as a reflexive verb's pronoun is (reader.mark_reflexive_pronouns)."""

from typing import Any

from franki_reader.coverage import Checker, is_word
from franki_reader.spaced import fold

# Separable prefixes. Listing one that no deck verb uses costs nothing, since a pairing needs the
# deck to have the joined verb.
PARTICLES = frozenset(
    {
        *("ab", "an", "auf", "aus", "bei", "dabei", "dazu", "davon", "durch", "ein", "empor"),
        *("entgegen", "entlang", "fest", "fort", "frei", "her", "heran", "herauf", "heraus"),
        *("herbei", "herein", "herum", "herunter", "hervor", "herüber", "hin", "hinauf"),
        *("hinaus", "hinein", "hinunter", "hinüber", "hoch", "los", "mit", "nach", "nieder"),
        *("raus", "rein", "rüber", "runter", "um", "vor", "voran", "voraus", "vorbei"),
        *("vorüber", "weg", "weiter", "wieder", "zu", "zurecht", "zurück", "zusammen"),
    }
)

# Words that can follow the particle with the clause still ending: "steht auf und geht".
_CLAUSE_JOINERS = frozenset({"und", "oder", "aber", "sondern", "denn"})


def join_split_verbs(
    words: list[dict[str, Any]],
    lexicon: Checker,
    meanings: dict[str, str],
    deck_translits: dict[str, str],
    stretch: set[str],
) -> None:
    """Join each split verb in `words` (a line's words as `reader.word_out` made them) in place."""
    code = getattr(lexicon, "code", "")
    if code == "en":
        _join_phrasal_verbs(words, lexicon, meanings, deck_translits, stretch)
    if code != "de":
        return
    for at, particle in enumerate(words):
        text = fold(particle["text"], "de")
        if text not in PARTICLES or not is_word(particle["text"]) or not _ends_clause(words, at):
            continue
        for before in _clause_words_before(words, at):
            verb = words[before]
            entry = lexicon.entry_of(text + (verb["lemma"] or fold(verb["text"], "de")))
            if entry is None:
                continue
            _join(verb, particle, entry, meanings, deck_translits, stretch)
            break


def _join(
    verb: dict[str, Any],
    particle: dict[str, Any],
    entry: str,
    meanings: dict[str, str],
    deck_translits: dict[str, str],
    stretch: set[str],
) -> None:
    for word in (verb, particle):
        word["lemma"] = entry
        word["gloss"] = meanings.get(entry) or word["gloss"]
        word["translit"] = deck_translits.get(entry) or word["translit"]
        word["deck"] = True
        word["stretch"] = word["stretch"] or entry in stretch
        if word["status"] in ("unknown", "partial"):
            word["status"] = "known"


# English particles of a phrasal verb, and the words that begin an object between verb and particle.
_EN_PARTICLES = frozenset(
    {"up", "down", "out", "off", "on", "in", "over", "away", "back", "around", "through", "along"}
    | {"apart", "together", "aside", "ahead"}
)
_EN_PRONOUNS = frozenset(
    {"it", "them", "him", "her", "me", "us", "you", "this", "that", "these", "those"}
)
_EN_DETERMINERS = frozenset(
    {
        "the",
        "a",
        "an",
        "my",
        "your",
        "his",
        "her",
        "its",
        "our",
        "their",
        "this",
        "that",
        "these",
        "those",
    }
)
_EN_OBJECT_MAX = 3  # a determiner and up to two more words (the old red lamp)


def _join_phrasal_verbs(
    words: list[dict[str, Any]],
    lexicon: Checker,
    meanings: dict[str, str],
    deck_translits: dict[str, str],
    stretch: set[str],
) -> None:
    """Join a verb to a particle that has a short object between them ("looks it up"). A verb and
    particle that sit together are already one token (the deck phrase), so those aren't touched."""
    for at, particle in enumerate(words):
        text = particle["text"].lower()
        if text not in _EN_PARTICLES:
            continue
        before = _clause_words_before(words, at)
        for gap in range(1, _EN_OBJECT_MAX + 1):
            if len(before) <= gap or not _is_object(
                [words[i]["text"].lower() for i in before[:gap][::-1]]
            ):
                continue
            verb = words[before[gap]]
            if " " in verb["text"].strip():
                continue
            entry = lexicon.entry_of(f"{verb['lemma'] or verb['text'].lower()} {text}")
            if entry is not None:
                _join(verb, particle, entry, meanings, deck_translits, stretch)
                break


def _is_object(gap: list[str]) -> bool:
    """A pronoun, or a determiner and then words, as the thing a phrasal verb is done to."""
    if len(gap) == 1:
        return gap[0] in _EN_PRONOUNS
    return gap[0] in _EN_DETERMINERS


def _ends_clause(words: list[dict[str, Any]], at: int) -> bool:
    """Whether nothing but a joiner (und, aber...) or punctuation follows the word in its clause."""
    for word in words[at + 1 :]:
        if not word["text"].strip():
            continue
        return not is_word(word["text"]) or fold(word["text"], "de") in _CLAUSE_JOINERS
    return True


def _clause_words_before(words: list[dict[str, Any]], at: int) -> list[int]:
    """The indexes of the words before `at` in its clause (punctuation ends one), nearest first."""
    found = []
    for i in range(at - 1, -1, -1):
        text = words[i]["text"]
        if not text.strip():
            continue
        if not is_word(text):
            break
        found.append(i)
    return found
