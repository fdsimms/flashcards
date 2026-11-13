"""The daily lexicon snapshot: every note's entry, meaning, transliteration and tier in one language's deck. Every
language's deck uses the Omnilanguage note type, so Entry and Meaning are read the same way.

The deck is read by `ReadDeck`: the real one is `AnkiDeck.read` (collection.py), which reads the
reader's own copy of the collection, kept in step with the sync server; tests pass fakes. Cards are
joined to notes by note id, so a card whose note isn't in the language's query (Thai's Consonant
Classes subdeck) is ignored.
"""

import html
import re
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from functools import lru_cache

from franki_reader.coverage import Checker, Lexicon
from franki_reader.japanese import JapaneseLexicon
from franki_reader.languages import LANGUAGES, Code, Language
from franki_reader.spaced import SpacedLexicon
from franki_reader.tiers import Tier, note_tier

THAI_NOTES_QUERY = LANGUAGES["th"].notes_query

_TAG = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class Entry:
    note_id: int
    text: str
    meaning: str
    tier: Tier
    due: bool = False  # a card of this note is due in Anki today
    # The note's pronunciation (Language.translit_field: Thai's Transliteration, Japanese's
    # KanaReading), empty when it has none
    translit: str = ""


@dataclass(frozen=True)
class NoteRow:
    """A note as stored: its Entry, Meaning and pronunciation (Language.translit_field) as HTML."""

    note_id: int
    entry: str
    meaning: str
    translit: str = ""


@dataclass(frozen=True)
class CardRow:
    """A card's Anki type (0 new, 1 learning, 2 review, 3 relearning), interval in days, whether
    it's due today, and whether it's suspended (queue -1)."""

    note_id: int
    type: int
    ivl: int
    due: bool = False
    # A suspended card doesn't count toward its note's tier (`note_tier`): the owner's presets
    # suspend leeches, the words they keep failing, which shouldn't count as known or be stretched on.
    suspended: bool = False


# Reads one language's deck. Raises AnkiUnavailable (gateway.py) when it can't, so the caller keeps
# the last snapshot.
ReadDeck = Callable[[Language], Awaitable[list[Entry]]]


def build_entries(notes: Iterable[NoteRow], cards: Iterable[CardRow]) -> list[Entry]:
    cards_by_note: dict[int, list[tuple[int, int]]] = {}
    due_notes: set[int] = set()
    for card in cards:
        if not card.suspended:
            cards_by_note.setdefault(card.note_id, []).append((card.type, card.ivl))
        if card.due:
            due_notes.add(card.note_id)

    entries = []
    for note in notes:
        text = clean(note.entry)
        if not text:
            continue
        entries.append(
            Entry(
                note_id=note.note_id,
                text=text,
                meaning=clean(note.meaning),
                tier=note_tier(cards_by_note.get(note.note_id, [])),
                due=note.note_id in due_notes,
                translit=clean(note.translit),
            )
        )
    return entries


def lexicon_from(
    entries: list[Entry],
    language: Code = "th",
    common: int | None = None,
    extra: Iterable[str] = (),
) -> Checker:
    """Mature and young both count as known for coverage; unreviewed notes don't. `common` is how
    many of the language's most common words count too (the setting), its default if None. `extra`
    is words known from outside the deck, which aren't deck words (Japanese's from WaniKani)."""
    known = frozenset(e.text for e in entries if e.tier != "unreviewed")
    count = LANGUAGES[language].common if common is None else common
    return _lexicon(language, known, count, frozenset(extra))


@lru_cache(maxsize=4)
def _lexicon(language: Code, known: frozenset[str], common: int, extra: frozenset[str]) -> Checker:
    # Building one costs about a second (the segmenter's dictionary), so the same set of known
    # words reuses it: once per snapshot in production, once per test module in tests.
    if language == "ja":
        return JapaneseLexicon(known, common, extra)
    if LANGUAGES[language].spaced:
        return SpacedLexicon(language, known, common)
    return Lexicon(known)


def clean(value: str) -> str:
    return " ".join(html.unescape(_TAG.sub(" ", value)).split())
