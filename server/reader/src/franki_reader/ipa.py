"""A word's IPA for the reader's word popup (docs/read-and-listen/architecture.md, IPA).

The tables (data/ipa/<code>.tsv.gz, built by scripts/build_ipa.py) are Wiktionary's: a word's
pronunciation as its entry gives it, so a word is found by how it's written in the text, never
through its dictionary form. A form's pronunciation isn't its lemma's (hablé is not hablar), and
Russian stress moves between forms (дом, дома), so a form with no entry of its own shows nothing
here rather than a neighbor's IPA. Russian, Polish and Thai have entries for nearly every form;
the other languages mostly have the lemmas, so a form there is found only when it has its own
entry.

Where a word has more than one entry (a homograph) the table keeps the first that has IPA. Only
this looks a word up: the popup shows what it finds, and where it came from (`SOURCE_WIKTIONARY`),
so the app can say so. Nothing here grades or writes anything.
"""

import gzip
import unicodedata
from functools import cache
from pathlib import Path

from franki_reader.coverage import Checker, is_word
from franki_reader.japanese import JapaneseLexicon

_DATA = Path(__file__).parent / "data" / "ipa"

SOURCE_WIKTIONARY = "wiktionary"

# Shown in the app wherever IPA from Wiktionary is.
ATTRIBUTION = "Pronunciations from Wiktionary, under CC BY-SA 4.0."


@cache
def table(code: str) -> dict[str, str]:
    """A language's words and their IPA, or none for a language with no table (Japanese, English)."""
    path = _DATA / f"{code}.tsv.gz"
    if not path.exists():
        return {}
    found: dict[str, str] = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            word, _, ipa = line.rstrip("\n").partition("\t")
            if word and ipa:
                found[word] = ipa
    return found


def ipa_of(word: str, code: str) -> str | None:
    """The IPA Wiktionary gives `word` in language `code`, as written or in lower case (a sentence's
    first word, a capitalized German noun in a line of capitals), else None."""
    words = table(code)
    if not words:
        return None
    word = unicodedata.normalize("NFC", word.strip())
    return words.get(word) or words.get(word.casefold())


def ipa_for(word: str, lexicon: Checker) -> tuple[str, str] | None:
    """The IPA for a token and its source, or None when there's none to show: punctuation, a phrase
    (a deck phrase is one token with spaces), a language with no table, or a word with no entry."""
    if not is_word(word) or " " in word.strip():
        return None
    if isinstance(lexicon, JapaneseLexicon):
        return None
    code: str = getattr(lexicon, "code", "th")  # Thai's lexicon has none, as in frequency.rank_of
    found = ipa_of(word, code)
    return (found, SOURCE_WIKTIONARY) if found else None
