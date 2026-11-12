"""The languages texts can be written in, and what differs between them (docs/read-and-listen/architecture.md,
Languages): the Anki deck (a setting, defaulting to the owner's decks), the voices, how a line is
written, and how known words are counted.

Thai counts only deck words as known, segmented with the deck as the dictionary (coverage.py).
Spanish counts the 10,000 most common Spanish words plus deck words, matched by lemma (spanish.py),
because the Spanish deck holds advanced words, not everyday ones.
"""

import re
from dataclasses import dataclass, field, replace
from typing import Literal

Code = Literal["th", "es"]


@dataclass(frozen=True)
class Language:
    code: Code
    name: str  # in English, as the prompt and the app say it
    # The deck whose notes are the word list. A setting (`decks` in store.Settings) can name
    # another; `with_deck` makes the language with it.
    deck: str
    voices: dict[str, str] = field(default_factory=dict)  # speaker -> Azure voice
    # Written with spaces between words. Thai isn't, so spaces the model adds there are dropped.
    spaced: bool = False
    # Subdecks of the deck whose notes aren't vocabulary, by their name under it.
    skip: tuple[str, ...] = ()

    @property
    def notes_query(self) -> str:
        """Anki's search for the word list: the deck and its subdecks, less the ones skipped."""
        deck = _escape(self.deck)
        return " ".join([f'"deck:{deck}"', *(f'-"deck:{deck}::{_escape(s)}"' for s in self.skip)])


def _escape(name: str) -> str:
    """A deck name as Anki's search reads it literally: `*` and `_` are wildcards there, and `"` and
    `\\` would end or escape the quoted term. Matches what Anki's own `build_search_string` writes
    for a deck (checked in test_lexicon.py), so a chosen deck named a_b doesn't also read axb."""
    return re.sub(r'([\\*_"])', r"\\\1", name)


_THAI_DECK = "👅 Languages::🐘 ภาษาไทย"
_SPANISH_DECK = "👅 Languages::🌮 Español"

LANGUAGES: dict[Code, Language] = {
    "th": Language(
        code="th",
        name="Thai",
        deck=_THAI_DECK,
        voices={"A": "th-TH-NiwatNeural", "B": "th-TH-PremwadeeNeural"},
        # The Thai consonant classes: letters, not words.
        skip=("🏛 Consonant Classes",),
    ),
    "es": Language(
        code="es",
        name="Spanish",
        deck=_SPANISH_DECK,
        # Mexican Spanish, as the owner chose (26 October 2026).
        voices={"A": "es-MX-JorgeNeural", "B": "es-MX-DaliaNeural"},
        spaced=True,
    ),
}


def with_deck(code: Code, deck: str | None) -> Language:
    """The language, reading its word list from `deck` when one is chosen (the decks setting)."""
    language = LANGUAGES[code]
    return replace(language, deck=deck) if deck else language
