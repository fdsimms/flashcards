"""A stand-in for the deck: notes and cards as the collection holds them, read through the same
`build_entries` as the real `AnkiDeck` (collection.py)."""

from franki_reader.languages import Language
from franki_reader.lexicon import CardRow, Entry, NoteRow, build_entries


def note(note_id: int, entry: str, meaning: str) -> NoteRow:
    return NoteRow(note_id, entry, meaning)


def card(
    nid: int,
    card_type: int,
    ivl: int,
    due: bool = False,
    suspended: bool = False,
    rated: bool = False,
    due_in: int | None = None,
) -> CardRow:
    """`due`: Anki's is:due; `rated`: answered today (rated:1); `due_in`: study days until due."""
    return CardRow(nid, card_type, ivl, due, suspended, rated, due_in)


class FakeDeck:
    def __init__(self, notes: list[NoteRow], cards: list[CardRow]) -> None:
        self.notes = notes
        self.cards = cards
        self.reads: list[Language] = []

    async def __call__(self, language: Language) -> list[Entry]:
        self.reads.append(language)
        return build_entries(self.notes, self.cards)
