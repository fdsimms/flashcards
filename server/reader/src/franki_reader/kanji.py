"""What each kanji in a Japanese word means and how it's read, for the word popup
(data/kanji.json, from KANJIDIC2).

KANJIDIC2 is the Electronic Dictionary Research and Development Group's, used under its licence
(CC BY-SA 4.0, https://www.edrdg.org/edrdg/licence.html): the app shows that line under the list.
The file keeps, for each kanji, [English meanings, on readings, kun readings, stroke count], and
leaves out a kanji with none of the first three. Kun readings are as KANJIDIC2 writes them: a dot
before the okurigana (さむ.い) and a hyphen on an affix. Nothing is generated or asked of a model.
"""

import json
from functools import cache
from pathlib import Path
from typing import Any

DATA = Path(__file__).parent / "data" / "kanji.json"

# A word has few kanji, and a popup has room for few meanings: the first ones are the main ones.
MAX_MEANINGS = 4


@cache
def _table() -> dict[str, list[Any]]:
    table: dict[str, list[Any]] = json.loads(DATA.read_text(encoding="utf-8"))
    return table


def kanji_of(word: str) -> list[dict[str, Any]] | None:
    """The kanji of `word`, each once and in the order they appear, with its meanings and on and
    kun readings; None when it has none that KANJIDIC2 lists (kana, Latin letters, 々)."""
    table = _table()
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    for char in word:
        if char in seen or char not in table:
            continue
        seen.add(char)
        meanings, on, kun, strokes = table[char]
        found.append(
            {
                "char": char,
                "meanings": meanings[:MAX_MEANINGS],
                "on": on,
                "kun": kun,
                "strokes": strokes,
            }
        )
    return found or None
