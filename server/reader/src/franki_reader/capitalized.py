"""German nouns that are spelled like a verb or adjective in a rendered line. Matching folds case, so
in "Das Essen ist gut" the noun Essen took the deck verb essen's meaning (to eat) and counted as the
deck word.

A German noun is always capitalized and a verb or adjective is not, so a capitalized word in the
middle of a sentence that matched only an entry with no capital letter in it isn't that entry. It
loses the entry's meaning and dictionary form, and is known only if it is a common word. A sentence's
first word is left alone, since anything is capitalized there. When the deck has the noun too, the
exact spelling already found it (SpacedLexicon.entry_of) and there is nothing to change.

Display only: the coverage check that decides whether a text is written within the known words still
folds case."""

import re
from typing import Any

from franki_reader.coverage import Checker, is_word
from franki_reader.spaced import SpacedLexicon

# The polite forms are capitalized wherever they stand, and are never nouns.
_POLITE = frozenset({"Sie", "Ihnen", "Ihr", "Ihre", "Ihren", "Ihrem", "Ihrer", "Ihres"})
_SENTENCE_END = re.compile(r"[.!?]")


def demote_capitalized_nouns(
    words: list[dict[str, Any]], lexicon: Checker, glosses: dict[str, str]
) -> None:
    """Take a line's capitalized mid-sentence words off a lowercase deck entry, in place."""
    if not isinstance(lexicon, SpacedLexicon) or lexicon.code != "de":
        return
    starts = True
    for word in words:
        text = word["text"]
        if not is_word(text):
            starts = starts or bool(_SENTENCE_END.search(text))
            continue
        was_start, starts = starts, False
        if was_start or not text[:1].isupper() or text in _POLITE or word["status"] == "name":
            continue
        entry = lexicon.entry_of(text)
        if entry is None or any(w[:1].isupper() for w in entry.split()):
            continue
        word["lemma"] = None
        word["gloss"] = glosses.get(text)
        word["deck"] = False
        word["stretch"] = False
        word["status"] = "known" if lexicon.on_common_list(text) else "unknown"
