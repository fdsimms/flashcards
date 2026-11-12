"""The languages texts can be written in, and what differs between them (docs/read-and-listen/architecture.md,
Languages): the Anki deck (a setting, defaulting to the owner's decks), the voices, how a line is
written, and how known words are counted.

Thai counts only deck words as known, segmented with the deck as the dictionary (coverage.py).
Every other language is written with spaces and matched by lemma (spaced.py): its studied deck
words, plus as many of its most common words as the `common` setting says, since most of the
owner's decks hold advanced words, not everyday ones.
"""

import re
from dataclasses import dataclass, field, replace
from typing import Literal

Code = Literal["th", "es", "de", "fr", "ru", "el", "pl", "nb"]

# How many of a language's most common words can be counted as known (the `common` setting).
CommonCount = Literal[0, 1000, 2000, 3000, 5000, 10000]


@dataclass(frozen=True)
class Language:
    code: Code
    name: str  # in English, as the prompt and the app say it
    # The deck whose notes are the word list. A setting (`decks` in store.Settings) can name
    # another; `with_deck` makes the language with it.
    deck: str
    voices: dict[str, str] = field(default_factory=dict)  # speaker -> Azure voice
    # Written with spaces between words. Thai isn't: its spaces mark clause breaks (coverage.parse_line).
    spaced: bool = False
    # Subdecks of the deck whose notes aren't vocabulary, by their name under it.
    skip: tuple[str, ...] = ()
    # How many of the language's most common words count as known by default (COMMON_CHOICES).
    # Thai has no list: only its deck counts.
    common: int = 0
    # What the prompt says about which variety to write, if anything.
    variety: str = ""
    # A line as the model writes it, for the prompt (spaced languages).
    example: str = ""

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
_LANGUAGES = "👅 Languages::"

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
        deck=_LANGUAGES + "🌮 Español",
        # Mexican Spanish, as the owner chose (26 October 2026).
        voices={"A": "es-MX-JorgeNeural", "B": "es-MX-DaliaNeural"},
        spaced=True,
        example="¿Lograron|*mantener|a|raya*|al|enemigo?",
        common=10000,
        variety="Write Mexican Spanish: ustedes, never vosotros.",
    ),
    # Added on 12 November 2026, by the owner's decision. Each default `common` is a first guess at
    # the owner's level from the deck, to be moved on the topics screen: Polish's deck is a
    # beginner's (deck only, as the owner chose); German, French, Russian and Greek hold advanced
    # words; Norwegian's are everyday ones.
    "de": Language(
        code="de",
        name="German",
        deck=_LANGUAGES + "🥨 Deutsch",
        voices={"A": "de-DE-ConradNeural", "B": "de-DE-KatjaNeural"},
        spaced=True,
        example="Hast|du|dich|in|sie|*verliebt*?",
        common=3000,
    ),
    "fr": Language(
        code="fr",
        name="French",
        deck=_LANGUAGES + "🥐 Français",
        voices={"A": "fr-FR-HenriNeural", "B": "fr-FR-DeniseNeural"},
        spaced=True,
        example="Il|a|enfin|*craché|le|morceau*.",
        common=3000,
    ),
    "ru": Language(
        code="ru",
        name="Russian",
        deck=_LANGUAGES + "🐻 Русский",
        voices={"A": "ru-RU-DmitryNeural", "B": "ru-RU-SvetlanaNeural"},
        spaced=True,
        example="Он|*нехотя*|открыл|дверь.",
        common=3000,
        variety="Write ё where it belongs, as a learner's text does.",
    ),
    "el": Language(
        code="el",
        name="Greek",
        deck=_LANGUAGES + "🏝️ Ελληνικά",
        voices={"A": "el-GR-NestorasNeural", "B": "el-GR-AthinaNeural"},
        spaced=True,
        example="Γιατί|*φοβάσαι*|το|σκοτάδι;",
        common=3000,
        variety="Write Modern Greek, with accents (monotonic).",
    ),
    "pl": Language(
        code="pl",
        name="Polish",
        deck=_LANGUAGES + "💈 Polski",
        voices={"A": "pl-PL-MarekNeural", "B": "pl-PL-ZofiaNeural"},
        spaced=True,
        example="Ta|kobieta|*je*|zupę.",
        # Its subdecks drill verb endings, cases and verb government, not words.
        skip=("🔤 Odmiana Polski", "🔤 Przypadki Polski", "🔤 Rekcja Polski"),
    ),
    "nb": Language(
        code="nb",
        name="Norwegian",
        deck=_LANGUAGES + "🐟 Norsk",
        voices={"A": "nb-NO-FinnNeural", "B": "nb-NO-PernilleNeural"},
        spaced=True,
        example="Jeg|må|*skynde|meg*!",
        common=1000,
        variety="Write Bokmål.",
    ),
}


def with_deck(code: Code, deck: str | None) -> Language:
    """The language, reading its word list from `deck` when one is chosen (the decks setting)."""
    language = LANGUAGES[code]
    return replace(language, deck=deck) if deck else language
