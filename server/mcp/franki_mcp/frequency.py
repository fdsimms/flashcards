"""
Ordering a deck's new cards by how common their word is, so the most useful words come up first.

This is Anki's own new-card order (a card's position), so it holds on every device and changes
nothing about scheduling: no interval, no memory state, no review is touched. The ranks come from
Read & Listen's server (`/api/ranks`, its lists of each language's 10,000 most common words), which
is why this needs it running. An entry is ranked as the deck writes it, without its article or
gender word, and a phrase (an entry of several words, which the lists don't rank) is taken as
important, since it wouldn't have been added otherwise. A word with no place goes after the ranked
ones, in the order it already had.
"""

from __future__ import annotations

import re
from typing import Any

from anki.collection import Collection  # first: the anki package's modules import each other
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .collection import CollectionManager
from .reader import ReaderClient

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


async def entry_ranks(client: ReaderClient, language: str, words: list[str]) -> tuple[dict[str, int | None], set[str]]:
    """Read & Listen's place for each entry, and which of them are phrases."""
    ranks: dict[str, int | None] = {}
    phrases: set[str] = set()
    for i in range(0, len(words), BATCH):
        answer = await client.post("/api/ranks", {"language": language, "words": words[i : i + BATCH]})
        ranks.update(answer["ranks"])
        phrases.update(answer.get("phrases", []))
    return ranks, phrases


def placed(order: list[tuple[int, str, list[int]]], ranks: dict[str, int | None], phrases: set[str]) -> list[tuple[int, str, list[int]]]:
    """`order` (note id, word, its new cards in template order, as they are now) with the phrases
    first, then the ranked notes, most common first, then the rest as they were."""
    first = [n for n in order if n[1] in phrases and ranks.get(n[1]) is None]
    ranked = [(place, n) for n in order if (place := ranks.get(n[1])) is not None]
    rest = [n for n in order if ranks.get(n[1]) is None and n[1] not in phrases]
    return first + [n for _, n in sorted(ranked, key=lambda r: r[0])] + rest


def register(server: MCPServer, cm: CollectionManager, client: ReaderClient) -> None:

    @server.tool(annotations=WRITE)
    async def order_new_by_frequency(
        deck: str, language: str, field: str = "Entry", preview: bool = True
    ) -> dict[str, Any]:
        """Puts a deck's new cards (and its subdecks') in order of how common each note's word is,
        most common first, so the most useful words are introduced first. It sets Anki's new-card
        positions, which every device follows; no schedule, interval or review changes. Cards of one
        note stay together in template order. An entry is ranked without its article or gender word
        (ten mężczyzna as mężczyzna). A phrase (an entry of several words) comes first, as one the
        user added on purpose. Words with no place in the language's list of its 10,000 most common
        go after the ranked ones, in the order they had. Suspended and buried new cards are left alone,
        and `left_alone` says how many of each.
        - `language` is Read & Listen's code: th, es, de, fr, ru, el, pl, nb, ja, en.
        - `field` is the note field that holds the word (Entry, for Omnilanguage).
        - `preview` (the default) changes nothing and returns the first of the new order,
          how many words had a place and how many didn't. Show that to the user, and call
          again with preview=false only once they agree: the old order isn't kept.
        Needs Read & Listen running (it holds the lists). Run it again after adding notes to the
        deck to place the new ones."""

        def gather(col: Collection) -> tuple[list[tuple[int, str, list[int]]], dict[str, int]]:
            did = col.decks.id_for_name(deck)
            if not did:
                names = sorted(n.name for n in col.decks.all_names_and_ids())
                raise ToolError(f'There\'s no deck called "{deck}". Decks: {", ".join(names)}.')
            name = col.decks.name(did)
            escaped = re.sub(r'([\\"*_])', r"\\\1", name)
            cids = list(col.find_cards(f'"deck:{escaped}" is:new -is:suspended -is:buried'))
            # New cards that are left where they are: Anki doesn't offer them today, so they aren't ordered.
            left = {
                "suspended": len(col.find_cards(f'"deck:{escaped}" is:new is:suspended')),
                "buried": len(col.find_cards(f'"deck:{escaped}" is:new is:buried -is:suspended')),
            }
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
            return out, left

        order, left_alone = await cm.read(gather)
        ranks, phrases = await entry_ranks(client, language, list(dict.fromkeys(w for _, w, _ in order if w)))
        new_order = placed(order, ranks, phrases)
        found = sum(1 for _, w, _ in order if ranks.get(w) is not None)
        phrase_notes = sum(1 for _, w, _ in order if w in phrases and ranks.get(w) is None)
        summary: dict[str, Any] = {
            "notes": len(order),
            "ranked": found,
            "phrases": phrase_notes,
            "unranked": len(order) - found - phrase_notes,
            "left_alone": left_alone,
            "first": [{"word": w, "rank": ranks.get(w), **({"phrase": True} if w in phrases and ranks.get(w) is None else {})} for _, w, _ in new_order[:PREVIEW_ROWS]],
        }
        if not found and not phrase_notes:
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
