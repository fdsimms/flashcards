"""
Filling the Omnilanguage note type's Pronunciation field, which Franki shows as a card's IPA.

The IPA is Read & Listen's (`/api/pronunciations`, ipa.py there): Wiktionary's tables (CC BY-SA 4.0),
Japanese written by rule from the note's KanaReading, and the IPA Claude wrote for texts where a
table has none. So a card shows what the reader's word popup shows for the same word. The server
does the lookup; this module finds the notes with an empty field and writes what comes back.

A field that already holds anything is never overwritten: a correction made in Anki stays. A note
whose IPA was written by Claude gets the tag `ipa-unverified`, so it can be found and checked.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from anki.collection import Collection  # first: the anki package's modules import each other
from anki.errors import NotFoundError
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .collection import CollectionManager
from .forms import _plain
from .reader import ReaderClient

NOTE_TYPE = "Omnilanguage"
FIELD = "Pronunciation"
UNVERIFIED_TAG = "ipa-unverified"
MAX_PER_CALL = 100
SHOWN_NOT_FOUND = 50

# Read & Listen's language codes, by the names the Language field uses (`LANG_TAGS` in src/core/cards.ts).
# A language with no pronunciation table there (English) is left out and counted under `other_languages`.
LANGUAGE_CODES = {
    "thai": "th", "ภาษาไทย": "th",
    "spanish": "es", "español": "es", "espanol": "es",
    "german": "de", "deutsch": "de",
    "french": "fr", "français": "fr", "francais": "fr",
    "russian": "ru", "русский": "ru",
    "greek": "el", "ελληνικά": "el",
    "polish": "pl", "polski": "pl",
    "norwegian": "nb", "norsk": "nb",
    "japanese": "ja", "日本語": "ja",
}  # fmt: skip


class MissingField(Exception):
    MESSAGE = (
        "The Omnilanguage note type has no Pronunciation field yet. Add it with add_field (note_type "
        "Omnilanguage, field Pronunciation). That makes every device download the whole collection, so "
        "ask the user to sync Anki, AnkiMobile and Franki first."
    )


@dataclass
class Candidate:
    note_id: int
    word: str
    code: str
    reading: str = ""  # a Japanese word's KanaReading


@dataclass
class Survey:
    candidates: list[Candidate]
    # Notes with an empty field in a language Read & Listen has no table for, by the name the note gives.
    unsupported: dict[str, int]


@dataclass
class Planned:
    note_id: int
    word: str
    ipa: str
    source: str


@dataclass
class FillPlan:
    filled: list[Planned]
    not_found: list[str]
    unsupported: dict[str, int]
    # Words that have IPA beyond the limit, for the next call.
    remaining: int


def code_of(language: str, deck: str) -> str:
    """Read & Listen's code for a note: its Language field, else a language named in its deck, as the app does."""
    name = _plain(language).lower()
    if name in LANGUAGE_CODES:
        return LANGUAGE_CODES[name]
    deck = deck.lower()
    return next((code for key, code in LANGUAGE_CODES.items() if key in deck), "")


def survey(col: Collection, query: str = "") -> Survey:
    """Omnilanguage notes with an empty Pronunciation field, matching `query` (Anki's search syntax)."""
    nt = col.models.by_name(NOTE_TYPE)
    if nt is None or FIELD not in col.models.field_names(nt):
        raise MissingField()
    search = f'"note:{NOTE_TYPE}" "{FIELD}:"'
    if query.strip():
        search += f" ({query})"
    candidates: list[Candidate] = []
    unsupported: dict[str, int] = {}
    for nid in col.find_notes(search):
        note = col.get_note(nid)
        word = _plain(note["Entry"]) if "Entry" in note else ""
        if not word:
            continue
        language = note["Language"] if "Language" in note else ""
        cards = note.cards()
        deck = col.decks.name(cards[0].did) if cards else ""
        code = code_of(language, deck)
        if not code:
            name = _plain(language).lower() or "(no language)"
            unsupported[name] = unsupported.get(name, 0) + 1
            continue
        reading = _plain(note["KanaReading"]) if code == "ja" and "KanaReading" in note else ""
        candidates.append(Candidate(nid, word, code, reading))
    return Survey(candidates, unsupported)


async def lookup(reader: ReaderClient, candidates: list[Candidate]) -> list[dict[str, str] | None]:
    """Read & Listen's IPA for each candidate, in order (None where it has none to show)."""
    found: list[dict[str, str] | None] = []
    for start in range(0, len(candidates), MAX_PER_CALL):
        batch = candidates[start : start + MAX_PER_CALL]
        body = {"entries": [{"language": c.code, "entry": c.word, "reading": c.reading} for c in batch]}
        found += (await reader.post("/api/pronunciations", body))["pronunciations"]
    return found


def plan(survey_: Survey, found: list[dict[str, str] | None], limit: int | None) -> FillPlan:
    """What filling would write. `limit` counts the notes that have IPA, so words the tables lack
    (which stay empty and would come first every time) never use up a batch."""
    filled: list[Planned] = []
    not_found: list[str] = []
    for c, answer in zip(survey_.candidates, found, strict=True):
        if answer and answer.get("ipa"):
            filled.append(Planned(c.note_id, c.word, answer["ipa"], answer.get("source", "")))
        else:
            not_found.append(c.word)
    chosen = filled if limit is None else filled[:limit]
    return FillPlan(chosen, not_found, survey_.unsupported, len(filled) - len(chosen))


def apply(col: Collection, fill: FillPlan) -> int:
    """Writes the planned IPA into fields still empty, tagging what Claude wrote."""
    notes = []
    for p in fill.filled:
        try:
            note = col.get_note(p.note_id)
        except NotFoundError:
            continue  # deleted while its IPA was looked up: the rest are still written
        if FIELD not in note or _plain(note[FIELD]):
            continue  # filled meanwhile, here or on another device
        note[FIELD] = p.ipa
        if p.source == "ai":
            note.add_tag(UNVERIFIED_TAG)
        notes.append(note)
    if notes:
        col.update_notes(notes)
    return len(notes)


def register(server: MCPServer, cm: CollectionManager, reader: ReaderClient) -> None:
    """The pronunciation tool: fill_pronunciation (a batch, previewed first)."""

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def fill_pronunciation(query: str = "", limit: int = 20, dry_run: bool = True) -> dict[str, Any]:
        """Fills the Pronunciation field (IPA) of Omnilanguage notes that have it empty, for Franki to
        show on a card, from Read & Listen's server: Wiktionary's pronunciations (Thai, Spanish,
        German, French, Russian, Greek, Polish, Norwegian), Japanese written by rule from the note's
        KanaReading (approximate: no pitch accent), and IPA Claude wrote for a text where Wiktionary
        has none, which is tagged ipa-unverified. Phrases and words with no entry are left empty and
        listed in not_found. Needs Read & Listen running. `query` narrows the notes (Anki's search
        syntax, e.g. "deck:Polski"); `limit` is how many notes, up to 100, counting only notes that
        have IPA to write. With dry_run (the default) nothing is written: show the user the first
        lines and the not_found count, and write only once they agree. A field that has anything in
        it is never changed. Languages with no table (English) come back in other_languages."""
        if not 1 <= limit <= MAX_PER_CALL:
            raise ToolError(f"limit must be between 1 and {MAX_PER_CALL}.")
        try:
            found_notes = await cm.read(lambda col: survey(col, query))
        except MissingField as e:
            raise ToolError(MissingField.MESSAGE) from e
        except ToolError:
            raise  # already says what to change (a sync problem, for one)
        except Exception as e:  # noqa: BLE001 - Anki's search errors
            raise ToolError(f"Anki couldn't read the search: {e}") from e
        answers = await lookup(reader, found_notes.candidates)
        planned = plan(found_notes, answers, limit)
        written = 0
        if not dry_run and planned.filled:
            written = await cm.write(lambda col: apply(col, planned))
        return {
            "would_fill" if dry_run else "filled": [
                {"note_id": p.note_id, "word": p.word, "ipa": p.ipa, "source": p.source} for p in planned.filled
            ],
            "written": written,
            "not_found_count": len(planned.not_found),
            "not_found": planned.not_found[:SHOWN_NOT_FOUND],
            "other_languages": planned.unsupported,
            "remaining": planned.remaining,
            "source": "Wiktionary (CC BY-SA 4.0) via Read & Listen; Japanese by rule from the kana reading; "
            f"IPA written by Claude is tagged {UNVERIFIED_TAG}",
        }
