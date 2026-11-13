"""The grammatical forms a word can be marked as in a text ("instrumental case", "past participle"), and
the short primer the app opens for each (data/forms/<code>.json, one file per language).

A form's `id` is what the server stores and what Claude is asked to choose from (forms.py), so a note
can only be one the catalog has a primer for. Its `name` is what the app's chip says. A primer is
`summary`, an optional `table` (a `head` row and `rows`) and `examples`, each with its English. Text in
`*asterisks*` is the part to highlight (an ending), as in the model's lines. Thai has no file: it has no
inflection, so a word is never a form of another. English has none either: it is read by someone
who already knows its grammar.
"""

import json
from functools import cache
from pathlib import Path
from typing import Any

DATA = Path(__file__).parent / "data" / "forms"


@cache
def primers(language: str) -> tuple[dict[str, Any], ...]:
    """A language's forms, in the order its file lists them; none for a language with no file."""
    path = DATA / f"{language}.json"
    if not path.is_file():
        return ()
    return tuple(json.loads(path.read_text(encoding="utf-8")))


def names(language: str) -> dict[str, str]:
    """Each of a language's form ids with the name the app shows."""
    return {p["id"]: p["name"] for p in primers(language)}
