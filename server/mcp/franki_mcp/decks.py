"""Finding a deck by the name a caller gave.

The collection's deck names carry emoji and their parents ("👅 Languages::🐘 ภาษาไทย"), which a
person, or Claude repeating them, rarely types in full. A name that isn't a deck exactly is matched
against each deck's name with the emoji and symbols that open each level left out, in any case, and
against its last level alone: "ภาษาไทย" and "languages::ภาษาไทย" both find the Thai deck. Only a
name that finds exactly one deck is used; several are refused with their full names, so a write never
lands in a deck the caller didn't mean.
"""

from __future__ import annotations

import unicodedata

from anki.collection import Collection  # first: the anki package's modules import each other
from mcp.server.mcpserver.exceptions import ToolError


def _bare(level: str) -> str:
    """A level's name without the emoji, symbols and spaces before its first letter or digit, case-folded."""
    text = unicodedata.normalize("NFC", level)
    start = 0
    while start < len(text) and not (unicodedata.category(text[start])[0] in "LN"):
        start += 1
    return text[start:].strip().casefold()


def _bare_name(name: str) -> str:
    return "::".join(_bare(level) for level in name.split("::"))


def matching_decks(col: Collection, name: str) -> list[tuple[int, str]]:
    """The decks `name` finds: the one called exactly that, else every deck it names without its emoji
    (whole name, or last level), as (id, full name)."""
    did = col.decks.id_for_name(name)
    if did:
        return [(did, col.decks.name(did))]
    wanted = _bare_name(name)
    if not wanted:
        return []
    found = []
    for d in col.decks.all_names_and_ids():
        if _bare_name(d.name) == wanted or _bare(d.name.split("::")[-1]) == wanted:
            found.append((d.id, d.name))
    return sorted(found, key=lambda x: x[1])


def deck_id(col: Collection, name: str, *, missing: str = "") -> int:
    """The id of the one deck `name` finds (`matching_decks`), or a ToolError naming the decks there are
    (`missing` is added to that message) or the ones it could mean."""
    found = matching_decks(col, name)
    if len(found) == 1:
        return found[0][0]
    if found:
        raise ToolError(f'"{name}" could be any of these decks: {", ".join(n for _, n in found)}. Give its full name.')
    names = sorted(n.name for n in col.decks.all_names_and_ids())
    raise ToolError(f'There\'s no deck called "{name}". Decks: {", ".join(names)}.{" " + missing if missing else ""}')
