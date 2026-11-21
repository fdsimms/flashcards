"""
Filling the Omnilanguage note type's Stress field: a Russian word written with its stress mark
(говори́ть), which Franki shows on a card's answer side.

Russian stress is on no fixed syllable, moves between a word's forms and isn't written, so a word
learned from its spelling alone is often learned with the wrong one. The mark comes from kaikki.org
(Wiktextract, Wiktionary's data, CC BY-SA 4.0), the word's own page there, as forms.py reads noun
tables: the entry's canonical form.

Only where it's certain: a single word of two or more vowels with no ё (ё is always the stressed
vowel, and a one-vowel word has no choice to make), whose page gives one stress. A word spelled
like another with a different stress (за́мок, замо́к) is left empty and listed, since nothing here
knows which the note means. A field that already holds anything is never overwritten.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from collections.abc import Callable
from typing import Any

import anyio

from anki.collection import Collection  # first: the anki package's modules import each other
from anki.errors import NotFoundError
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .collection import CollectionManager
from .forms import STRESS_MARK, UniMorph, _plain
from .pronunciation import code_of

NOTE_TYPE = "Omnilanguage"
FIELD = "Stress"
MAX_PER_CALL = 100
SHOWN = 50
VOWELS = frozenset("аеиоуыэюяё")


class MissingField(Exception):
    MESSAGE = (
        "The Omnilanguage note type has no Stress field yet. Add it with add_field (note_type "
        "Omnilanguage, field Stress). That makes every device download the whole collection, so "
        "ask the user to sync Anki, AnkiMobile and Franki first."
    )


def needs_mark(word: str) -> bool:
    """Whether a Russian entry is one a stress mark can be looked up for: one word, with a choice of vowel to stress."""
    w = word.casefold()
    return bool(w) and not any(ch.isspace() for ch in w) and "ё" not in w and sum(ch in VOWELS for ch in w) >= 2


def stressed_form(page: str, word: str) -> str | None:
    """The word with its stress mark, from its kaikki.org page: the canonical form of every entry
    spelled as `word`. None when the page has none, or its entries stress it differently."""
    want = word.casefold()
    found: set[str] = set()
    for line in page.splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not isinstance(entry, dict):
            continue
        for f in entry.get("forms", []):
            form = str(f.get("form", "")).strip()
            if "canonical" not in (f.get("tags") or []) or STRESS_MARK not in form:
                continue
            if form.replace(STRESS_MARK, "").casefold() == want and form.count(STRESS_MARK) == 1:
                found.add(form.casefold())
    return next(iter(found)) if len(found) == 1 else None


@dataclass
class Candidate:
    note_id: int
    word: str


@dataclass
class Planned:
    note_id: int
    word: str
    stress: str


@dataclass
class FillPlan:
    filled: list[Planned]
    not_found: list[str]
    # Words not looked up yet, once the limit was reached: for the next call.
    remaining: int


def survey(col: Collection, query: str = "") -> list[Candidate]:
    """Russian Omnilanguage notes with an empty Stress field whose word can take a mark, matching `query`."""
    nt = col.models.by_name(NOTE_TYPE)
    if nt is None or FIELD not in col.models.field_names(nt):
        raise MissingField()
    search = f'"note:{NOTE_TYPE}" "{FIELD}:"'
    if query.strip():
        search += f" ({query})"
    found: list[Candidate] = []
    for nid in col.find_notes(search):
        note = col.get_note(nid)
        word = _plain(note["Entry"]) if "Entry" in note else ""
        cards = note.cards()
        deck = col.decks.name(cards[0].did) if cards else ""
        if code_of(note["Language"] if "Language" in note else "", deck) == "ru" and needs_mark(word):
            found.append(Candidate(nid, word))
    return found


def plan(candidates: list[Candidate], page_of: Callable[[str], str], limit: int) -> FillPlan:
    """What filling would write. `limit` counts the notes that have a mark, so words with none never
    use up a batch; a page is read only until the limit is reached, so a call reads a batch's worth."""
    filled: list[Planned] = []
    not_found: list[str] = []
    for i, c in enumerate(candidates):
        if len(filled) == limit:
            return FillPlan(filled, not_found, len(candidates) - i)
        mark = stressed_form(page_of(c.word), c.word)
        if mark:
            # The note's own capitals are kept: the mark goes where the page's form has it.
            at = mark.index(STRESS_MARK)
            filled.append(Planned(c.note_id, c.word, c.word[:at] + STRESS_MARK + c.word[at:]))
        else:
            not_found.append(c.word)
    return FillPlan(filled, not_found, 0)


def apply(col: Collection, fill: FillPlan) -> int:
    """Writes the planned marks into fields still empty."""
    notes = []
    for p in fill.filled:
        try:
            note = col.get_note(p.note_id)
        except NotFoundError:
            continue  # deleted while its page was read: the rest are still written
        if FIELD not in note or _plain(note[FIELD]):
            continue  # filled meanwhile, here or on another device
        note[FIELD] = p.stress
        notes.append(note)
    if notes:
        col.update_notes(notes)
    return len(notes)


def register(server: MCPServer, cm: CollectionManager, unimorph: UniMorph) -> None:
    """The stress tool: fill_stress (a batch, previewed first)."""

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True))
    async def fill_stress(query: str = "", limit: int = 20, dry_run: bool = True) -> dict[str, Any]:
        """Fills the Stress field of Russian Omnilanguage notes that have it empty with the word
        written with its stress mark (говори́ть), for Franki to show on a card's answer side, from
        the word's kaikki.org page (Wiktionary's data). Only single words with a choice of vowel
        to stress: a phrase, a one-vowel word and a word with ё need none and are skipped. A word
        with no page, or spelled like another with a different stress (за́мок, замо́к), is left
        empty and listed in not_found: write its Stress by hand with update_notes once the user
        says which is meant. `query` narrows the notes (Anki's search syntax); `limit` is how many
        notes, up to 100, counting only notes that have a mark to write. With dry_run (the default)
        nothing is written: show the user the first lines and the not_found count, and write only
        once they agree. A field that has anything in it is never changed."""
        if not 1 <= limit <= MAX_PER_CALL:
            raise ToolError(f"limit must be between 1 and {MAX_PER_CALL}.")
        try:
            candidates = await cm.read(lambda col: survey(col, query))
        except MissingField as e:
            raise ToolError(MissingField.MESSAGE) from e
        except ToolError:
            raise  # already says what to change (a sync problem)
        except Exception as e:  # noqa: BLE001 - Anki's search errors
            raise ToolError(f"Anki couldn't read the search: {e}") from e
        planned = await anyio.to_thread.run_sync(plan, candidates, lambda word: unimorph.kaikki_page("Russian", word), limit)
        written = 0 if dry_run or not planned.filled else await cm.write(lambda col: apply(col, planned))
        return {
            "would_fill" if dry_run else "filled": [
                {"note_id": p.note_id, "word": p.word, "stress": p.stress} for p in planned.filled[:SHOWN]
            ],
            "written": written,
            "not_found_count": len(planned.not_found),
            "not_found": planned.not_found[:SHOWN],
            "remaining": planned.remaining,
            "source": "kaikki.org (Wiktextract of Wiktionary, CC BY-SA 4.0)",
        }
