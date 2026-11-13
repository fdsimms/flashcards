"""The languages texts can be written in, and what differs between them (docs/read-and-listen/architecture.md,
Languages): the Anki deck (a setting, defaulting to the owner's decks), the voices, how a line is
written, and how known words are counted.

Thai counts only deck words as known, segmented with the deck as the dictionary (coverage.py).
Japanese is split into words by Sudachi and matched by dictionary form (japanese.py). Every other
language is written with spaces and matched by lemma (spaced.py). Every language but Thai counts
its studied deck words plus as many of its most common words as the `common` setting says, since
most of the owner's decks hold advanced words, not everyday ones; Japanese also counts the
vocabulary learned in WaniKani (wanikani.py).
"""

import re
from dataclasses import dataclass, field, replace
from typing import Literal

from franki_speech import locale_of

Code = Literal["th", "es", "de", "fr", "ru", "el", "pl", "nb", "ja"]

# Languages kept out of what the app is shown, for a build of the app from before they were added
# (its language table has no entry for them, and the Read & Listen screen crashes on one). Empty
# this once the app is rebuilt with the language.
HIDDEN_LANGUAGES: frozenset[Code] = frozenset({"ja"})

# How many of a language's most common words can be counted as known (the `common` setting).
CommonCount = Literal[0, 250, 500, 1000, 2000, 3000, 5000, 10000]

# A speaker is a man or a woman. Each language has a voice for each, and a second of each for a
# dialogue between two men or two women (gender.py picks which one speaks).
Gender = Literal["male", "female"]
VoiceSlot = Literal["male", "male2", "female", "female2"]
VOICE_SLOTS: tuple[VoiceSlot, ...] = ("male", "male2", "female", "female2")


@dataclass(frozen=True)
class Language:
    code: Code
    name: str  # in English, as the prompt and the app say it
    # The deck whose notes are the word list. A setting (`decks` in store.Settings) can name
    # another; `with_deck` makes the language with it.
    deck: str
    # VoiceSlot -> Azure voice. A slot left out reads in the same gender's first voice, as a
    # language with only one voice of a gender has to (gender.py).
    voices: dict[str, str] = field(default_factory=dict)
    # Written with spaces between words. Thai isn't: its spaces mark clause breaks (coverage.parse_line).
    # Nor is Japanese, which has none.
    spaced: bool = False
    # Subdecks of the deck whose notes aren't vocabulary, by their name under it.
    skip: tuple[str, ...] = ()
    # How many of the language's most common words count as known by default (COMMON_CHOICES).
    # Thai has no list: only its deck counts.
    common: int = 0
    # What the prompt says about which variety to write, if anything.
    variety: str = ""
    # A line as the model writes it, for the prompt (every language but Thai).
    example: str = ""
    # How the prompt says to split a line into words (every language but Thai).
    writing: str = "put | between words instead of spaces, keep punctuation on its word"
    # The note field holding a word's pronunciation, shown behind the reader's reveal.
    translit_field: str = "Transliteration"

    @property
    def locale(self) -> str:
        """The locale its texts are written in, as its own voices speak it (th-TH, es-MX): what a
        Multilingual voice chosen for it is told to read them as (franki_speech's `ssml`)."""
        return locale_of(next(iter(self.voices.values())))

    @property
    def counts_common(self) -> bool:
        """Whether some of its most common words count as known (data/<code>_common.txt). Thai's
        list (data/th_common.txt) only ranks words for the popup (frequency.py): only its deck
        counts as known."""
        return self.code != "th"

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
        # Azure's standard Thai voices have one man's and two women's.
        voices={
            "male": "th-TH-NiwatNeural",
            "female": "th-TH-PremwadeeNeural",
            "female2": "th-TH-AcharaNeural",
        },
        # The Thai consonant classes: letters, not words.
        skip=("🏛 Consonant Classes",),
    ),
    "es": Language(
        code="es",
        name="Spanish",
        deck=_LANGUAGES + "🌮 Español",
        # Mexican Spanish, as the owner chose (26 October 2026).
        voices={
            "male": "es-MX-JorgeNeural",
            "male2": "es-MX-CecilioNeural",
            "female": "es-MX-DaliaNeural",
            "female2": "es-MX-BeatrizNeural",
        },
        spaced=True,
        example="¿Lograron|*mantener|a|raya*|al|enemigo?",
        common=10000,
        variety="Write Mexican Spanish: ustedes, never vosotros.",
    ),
    # Added on 12 November 2026, by the owner's decision. Each default `common` is a first guess at
    # the owner's level from the deck, to be moved on the topics screen: Polish's deck is a
    # beginner's (its 250 most common words, mostly the small ones); German, French, Russian and
    # Greek hold advanced words; Norwegian's are everyday ones.
    "de": Language(
        code="de",
        name="German",
        deck=_LANGUAGES + "🥨 Deutsch",
        voices={
            "male": "de-DE-ConradNeural",
            "male2": "de-DE-BerndNeural",
            "female": "de-DE-KatjaNeural",
            "female2": "de-DE-AmalaNeural",
        },
        spaced=True,
        example="Hast|du|dich|in|sie|*verliebt*?",
        common=3000,
    ),
    "fr": Language(
        code="fr",
        name="French",
        deck=_LANGUAGES + "🥐 Français",
        voices={
            "male": "fr-FR-HenriNeural",
            "male2": "fr-FR-AlainNeural",
            "female": "fr-FR-DeniseNeural",
            "female2": "fr-FR-BrigitteNeural",
        },
        spaced=True,
        example="Il|a|enfin|*craché|le|morceau*.",
        common=3000,
    ),
    "ru": Language(
        code="ru",
        name="Russian",
        deck=_LANGUAGES + "🐻 Русский",
        voices={
            "male": "ru-RU-DmitryNeural",
            "female": "ru-RU-SvetlanaNeural",
            "female2": "ru-RU-DariyaNeural",
        },
        spaced=True,
        example="Он|*нехотя*|открыл|дверь.",
        common=3000,
        variety="Write ё where it belongs, as a learner's text does.",
    ),
    "el": Language(
        code="el",
        name="Greek",
        deck=_LANGUAGES + "🏝️ Ελληνικά",
        voices={"male": "el-GR-NestorasNeural", "female": "el-GR-AthinaNeural"},
        spaced=True,
        example="Γιατί|*φοβάσαι*|το|σκοτάδι;",
        common=3000,
        variety="Write Modern Greek, with accents (monotonic).",
    ),
    "pl": Language(
        code="pl",
        name="Polish",
        deck=_LANGUAGES + "💈 Polski",
        voices={
            "male": "pl-PL-MarekNeural",
            "female": "pl-PL-ZofiaNeural",
            "female2": "pl-PL-AgnieszkaNeural",
        },
        spaced=True,
        example="Ta|kobieta|*je*|zupę.",
        # Its subdecks drill verb endings, cases and verb government, not words.
        common=250,
        skip=("🔤 Odmiana Polski", "🔤 Przypadki Polski", "🔤 Rekcja Polski"),
    ),
    "nb": Language(
        code="nb",
        name="Norwegian",
        deck=_LANGUAGES + "🐟 Norsk",
        voices={
            "male": "nb-NO-FinnNeural",
            "female": "nb-NO-PernilleNeural",
            "female2": "nb-NO-IselinNeural",
        },
        spaced=True,
        example="Jeg|må|*skynde|meg*!",
        common=1000,
        variety="Write Bokmål.",
    ),
    # Added on 13 November 2026, by the owner's decision. The deck holds intermediate words, and
    # WaniKani's words count too, so 2,000 common words is a first guess at the owner's level.
    "ja": Language(
        code="ja",
        name="Japanese",
        deck=_LANGUAGES + "🍥 日本語",
        voices={
            "male": "ja-JP-KeitaNeural",
            "male2": "ja-JP-DaichiNeural",
            "female": "ja-JP-NanamiNeural",
            "female2": "ja-JP-AoiNeural",
        },
        example="明日|は|*劇団*|の|公演|を|見|に|行く|よ。",
        writing=(
            "put | between words and never a space, since Japanese is written without them, and "
            "keep punctuation on its word"
        ),
        common=2000,
        variety=(
            "Write standard Japanese, with kanji wherever a native speaker would use them and kana "
            "elsewhere, never romaji: the learner's app shows each word's reading."
        ),
        # The owner's Japanese notes keep the reading in KanaReading, not Transliteration.
        translit_field="KanaReading",
    ),
}


def speech_locale(language: str) -> str | None:
    """A text's language as the speech client takes it, a locale: a language here by its code
    ("ja") is its own (ja-JP), and a locale ("th-TH", "th_TH") is passed on for the client to read
    or refuse. Any other bare code ("ko") has no region to name, so it's None, and a Multilingual
    voice guesses the language as it did before the language was sent."""
    code = language.strip().replace("_", "-")
    for known in LANGUAGES.values():
        if known.code == code.lower():
            return known.locale
    return code if "-" in code else None


def with_deck(code: Code, deck: str | None) -> Language:
    """The language, reading its word list from `deck` when one is chosen (the decks setting)."""
    language = LANGUAGES[code]
    return replace(language, deck=deck) if deck else language
