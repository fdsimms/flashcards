"""Pictures for a note's Icon field that are a Tabler icon (MIT, tabler_icons.json), never a drawing
Claude made up.

A picture has to show exactly the thing, and a freehand drawing never did (a stadium ring for a
running track). So an Icon is one emoji that shows exactly it, or an icon from this set whose own
name is the thing (`umbrella`, `key`, `bike`), or empty. The icon is stored as its path data, which
is what src/core/noteIcon.ts draws, so the app needs nothing from this module. The set is built by
scripts/build_tabler_icons.py; TABLER_LICENSE is Tabler's license, kept beside the data.

Shared by the MCP and Read & Listen, which both check an Icon the same way.
"""

import json
from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).with_name("tabler_icons.json")


@lru_cache(maxsize=1)
def _icons() -> dict[str, str]:
    data: dict[str, str] = json.loads(_DATA.read_text())
    return data


@lru_cache(maxsize=1)
def _names_by_drawing() -> dict[str, str]:
    return {drawing: name for name, drawing in _icons().items()}


def normalize_name(name: str) -> str:
    """A Tabler icon name as the set spells it: lowercase, words joined by hyphens, with a leading
    `tabler:` taken off."""
    name = name.strip().lower().removeprefix("tabler:").strip()
    return "-".join(name.replace("_", " ").split())


def icon_drawing(name: str) -> str | None:
    """The path data of the Tabler icon called `name`, or None when the set has no such icon."""
    return _icons().get(normalize_name(name))


def tabler_name_of(drawing: str) -> str | None:
    """The name of the Tabler icon whose path data is exactly `drawing`, or None when it is any
    other drawing."""
    return _names_by_drawing().get(drawing.strip())


def similar_names(name: str, limit: int = 8) -> list[str]:
    """Icon names that contain `name` as a word, or the other way round, for an error that says what
    to try instead of only that the name is unknown."""
    wanted = normalize_name(name)
    if not wanted:
        return []
    words = set(wanted.split("-"))
    found = [n for n in _icons() if words & set(n.split("-")) or wanted in n]
    return sorted(found, key=lambda n: (len(n), n))[:limit]
