"""
Ordering a deck's new cards by how common their word is, so the most useful words come up first.

This is Anki's own new-card order (a card's position), so it holds on every device and changes
nothing about scheduling: no interval, no memory state, no review is touched. The ranks come from
Read & Listen's server (`/api/ranks`, its lists of each language's 10,000 most common words), which
is why this needs it running. A word with no place (past the list, or a phrase it can't rank) goes
after the ranked ones, in the order it already had.
"""

from __future__ import annotations

import re
from typing import Any

import httpx
from anki.collection import Collection  # first: the anki package's modules import each other
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .collection import CollectionManager
from .reader import ReaderClient, ReaderSettings

WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)

MAX_CARDS = 5000
# Read & Listen's /api/ranks takes this many words a request.
BATCH = 1000
PREVIEW_ROWS = 25

TAG = re.compile(r"<[^>]+>")
# "vengarse de", "internarse (en)": the word as it's looked up, without a bracketed note.
BRACKETED = re.compile(r"\s*[(\[].*?[)\]]")


def entry_word(html: str) -> str:
    """The word an Entry field holds, as it's ranked: tags and a bracketed note taken out."""
    text = re.sub(r"\s+", " ", TAG.sub(" ", html.replace("&nbsp;", " "))).strip()
    return BRACKETED.sub("", text).strip()


def placed(order: list[tuple[int, str, list[int]]], ranks: dict[str, int | None]) -> list[tuple[int, str, list[int]]]:
    """`order` (note id, word, its new cards in template order, as they are now) with the ranked
    notes first, most common first, then the rest as they were."""
    ranked = [(place, n) for n in order if (place := ranks.get(n[1])) is not None]
    rest = [n for n in order if ranks.get(n[1]) is None]
    return [n for _, n in sorted(ranked, key=lambda r: r[0])] + rest


def register(server: MCPServer, cm: CollectionManager, settings: ReaderSettings | None, http: httpx.AsyncClient | None = None) -> None:
    client = ReaderClient(settings, http)

    @server.tool(annotations=WRITE)
    async def order_new_by_frequency(
        deck: str, language: str, field: str = "Entry", preview: bool = True
    ) -> dict[str, Any]:
        """Puts a deck's new cards (and its subdecks') in order of how common each note's word is,
        most common first, so the most useful words are introduced first. It sets Anki's new-card
        positions, which every device follows; no schedule, interval or review changes. Cards of one
        note stay together in template order. Words with no place in the language's list of its
        10,000 most common (rarer ones, phrases) go after the ranked ones, in the order they had.
        Suspended cards are left alone.
        - `language` is Read & Listen's code: th, es, de, fr, ru, el, pl, nb, ja, en.
        - `field` is the note field that holds the word (Entry, for Omnilanguage).
        - `preview` (the default) changes nothing and returns the first of the new order,
          how many words had a place and how many didn't. Show that to the user, and call
          again with preview=false only once they agree: the old order isn't kept.
        Needs Read & Listen running (it holds the lists). Run it again after adding notes to the
        deck to place the new ones."""

        def gather(col: Collection) -> list[tuple[int, str, list[int]]]:
            did = col.decks.id_for_name(deck)
            if not did:
                names = sorted(n.name for n in col.decks.all_names_and_ids())
                raise ToolError(f'There\'s no deck called "{deck}". Decks: {", ".join(names)}.')
            name = col.decks.name(did)
            escaped = re.sub(r'([\\"*_])', r"\\\1", name)
            cids = list(col.find_cards(f'"deck:{escaped}" is:new -is:suspended -is:buried'))
            if not cids:
                raise ToolError(f'"{deck}" has no new cards to order.')
            if len(cids) > MAX_CARDS:
                raise ToolError(f"{len(cids)} new cards is more than the {MAX_CARDS} this orders at once. Order a subdeck.")
            # Cards in the order they are now, by new-card position then template, then grouped by note.
            cards = sorted((col.get_card(c) for c in cids), key=lambda c: (c.due, c.ord, c.id))
            by_note: dict[int, list[int]] = {}
            for c in cards:
                by_note.setdefault(c.nid, []).append(c.id)
            out = []
            for nid, ids in by_note.items():
                note = col.get_note(nid)
                if field not in note:
                    raise ToolError(f'The note type "{note.note_type()["name"]}" has no field "{field}". Pass the field that holds the word.')
                out.append((nid, entry_word(note[field]), ids))
            return out

        order = await cm.read(gather)
        words = list(dict.fromkeys(w for _, w, _ in order if w))
        ranks: dict[str, int | None] = {}
        for i in range(0, len(words), BATCH):
            answer = await client.post("/api/ranks", {"language": language, "words": words[i : i + BATCH]})
            ranks.update(answer["ranks"])
        new_order = placed(order, ranks)
        found = sum(1 for _, w, _ in order if ranks.get(w) is not None)
        summary: dict[str, Any] = {
            "notes": len(order),
            "ranked": found,
            "unranked": len(order) - found,
            "first": [{"word": w, "rank": ranks.get(w)} for _, w, _ in new_order[:PREVIEW_ROWS]],
        }
        if not found:
            raise ToolError(f'None of "{deck}"\'s new words has a place in the {language} list, so there\'s nothing to order by. Check `language` and `field`.')
        if preview:
            return {"preview": True, **summary}

        def save(col: Collection) -> dict[str, Any]:
            # Anki's reposition keeps the cards it's given in their current order, so each note is
            # placed on its own, one position after the last, starting where the deck's own begin.
            current = {nid: ids for nid, _, ids in order}
            ids_now = [i for ids in current.values() for i in ids]
            start = min(col.get_card(i).due for i in ids_now)
            position = start
            moved = 0
            for nid, _, ids in new_order:
                still_new = [i for i in ids if col.get_card(i).queue == 0]
                if not still_new:
                    continue
                moved += col.sched.reposition_new_cards(still_new, position, 1, False, False).count
                position += len(still_new)
            return {"moved": moved}

        return {"preview": False, **summary, **await cm.write(save)}
