"""A word's IPA for the reader's word popup (docs/read-and-listen/architecture.md, IPA).

The tables (data/ipa/<code>.tsv.gz, built by scripts/build_ipa.py) are Wiktionary's: a word's
pronunciation as its entry gives it, so a word is found by how it's written in the text, never
through its dictionary form. A form's pronunciation isn't its lemma's (hablé is not hablar), and
Russian stress moves between forms (дом, дома), so a form with no entry of its own shows nothing
here rather than a neighbor's IPA. Russian, Polish and Thai have entries for nearly every form;
the other languages mostly have the lemmas, so a form there is found only when it has its own
entry.

Where a word has more than one entry (a homograph) the table keeps the first that has IPA. Only
this looks a word up: the popup shows what it finds, and where it came from (`SOURCE_WIKTIONARY`,
or Japanese's `SOURCE_RULES`), so the app can say so. Nothing here grades or writes anything.
"""

import gzip
import unicodedata
from collections.abc import Mapping
from functools import cache
from pathlib import Path

from franki_reader.coverage import Checker, is_word
from franki_reader.japanese import JapaneseLexicon
from franki_reader.kana_ipa import ipa_of_reading

_DATA = Path(__file__).parent / "data" / "ipa"

SOURCE_WIKTIONARY = "wiktionary"
# Japanese: written from the word's kana reading by rule (kana_ipa.py), approximate.
SOURCE_RULES = "rules"
# Written by Claude where the table has none (ai_ipa.py): the app says so wherever it shows it.
SOURCE_AI = "ai"

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


def ipa_for(
    word: str,
    lexicon: Checker,
    reading: str | None = None,
    ai: Mapping[str, str] | None = None,
) -> tuple[str, str] | None:
    """The IPA for a token and its source, or None when there's none to show: punctuation, a phrase
    (a deck phrase is one token with spaces), a language with no table, or a word with no entry.

    Japanese is read from `reading` (the kana the popup shows: the deck's), else Sudachi's, or from
    the word itself when it's written in kana. `ai` is what Claude wrote for words the table has none
    for (by lower-case word), tried only after the table."""
    if not is_word(word) or " " in word.strip():
        return None
    if isinstance(lexicon, JapaneseLexicon):
        found = ipa_of_reading(reading or lexicon.reading_of(word) or word)
        return (found, SOURCE_RULES) if found else None
    code: str = getattr(lexicon, "code", "th")  # Thai's lexicon has none, as in frequency.rank_of
    return _from_table(word, code, ai)


def _from_table(word: str, code: str, ai: Mapping[str, str] | None) -> tuple[str, str] | None:
    if found := ipa_of(word, code):
        return found, SOURCE_WIKTIONARY
    written = (ai or {}).get(word.strip().casefold())
    return (written, SOURCE_AI) if written else None


def ipa_of_entry(
    entry: str, code: str, reading: str = "", ai: Mapping[str, str] | None = None
) -> tuple[str, str] | None:
    """The IPA and its source for a deck note's Entry, which has no text around it to be a token of:
    what `ipa_for` gives the same word in a text, so a card and the reader never disagree. Japanese
    takes the note's KanaReading, else Sudachi's. The MCP's fill_pronunciation asks for this."""
    if not is_word(entry) or " " in entry.strip():
        return None
    if code == "ja":
        return ipa_for(entry, JapaneseLexicon(()), reading or None, ai)
    return _from_table(entry, code, ai)
