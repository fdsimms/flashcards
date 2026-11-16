"""Which words of a text the app hides behind a fill-in slot, to type the form of (docs/read-and-listen/
architecture.md, Form quiz).

Chosen in code from what the text already carries, with no call to Claude: a word that is a form of
another word (it has a dictionary form) and whose form the text's forms pass named (forms.py), so the
sheet can say why it is that form. Only a word the reader already knows (never a practice word, a
name or one outside the deck and common words, which the reader can't be expected to inflect), and only
its first appearance in the text, since that is the line the form was picked for: the same spelling in
a later line may be another form.

A few a text, spread down it, one to a line and in different forms where the text has them. The same
text always gets the same words, so reopening one doesn't move the slots. Reading and listening still
never grade or write cards: this only marks words for the app to draw.
"""

from typing import Any

# The most slots in one text, and how many lines a text needs for each: a short text gets few, so it
# still reads as a text.
MAX_PER_TEXT = 3
LINES_PER_SLOT = 4


def _is_target(word: dict[str, Any]) -> bool:
    """Whether a word could be asked: known, not a practice word, a single word that is a form of a
    single other word, with a form named, and not a contraction (which is two words in one)."""
    text, lemma, form = word.get("text", ""), word.get("lemma"), word.get("form")
    return bool(
        word.get("status") == "known"
        and not word.get("stretch")
        and lemma
        and form
        and not word.get("contraction")
        and text.isalpha()
        and " " not in lemma
        and text.casefold() != lemma.casefold()
    )


def _candidates(lines: list[list[dict[str, Any]]]) -> list[list[int]]:
    """For each line, the indexes of its words that could be asked: not the first word of the line
    (whose capital says nothing about the form), and the first appearance of the word in the text."""
    seen: set[str] = set()
    found: list[list[int]] = []
    for words in lines:
        first = next((i for i, w in enumerate(words) if w.get("status") is not None), None)
        here: list[int] = []
        for i, w in enumerate(words):
            if w.get("status") is None:
                continue
            key = str(w.get("text", "")).casefold()
            fresh = key not in seen
            seen.add(key)
            if fresh and i != first and _is_target(w):
                here.append(i)
        found.append(here)
    return found


def pick(lines: list[list[dict[str, Any]]], text_id: int) -> list[tuple[int, int]]:
    """The (line, word) positions to ask, in the text's order. `text_id` only moves where the
    spread starts, so every text isn't asked in the same places."""
    budget = min(MAX_PER_TEXT, len(lines) // LINES_PER_SLOT)
    candidates = _candidates(lines)
    open_lines = [i for i, c in enumerate(candidates) if c]
    if budget <= 0 or not open_lines:
        return []
    if len(open_lines) > budget:
        step = len(open_lines) / budget
        offset = text_id % max(1, int(step + 0.999))
        open_lines = [
            open_lines[min(len(open_lines) - 1, int(k * step + offset))] for k in range(budget)
        ]
    picked: list[tuple[int, int]] = []
    used: set[str] = set()
    for line in open_lines:
        options = candidates[line]
        # A form not asked yet in this text, if the line has one.
        fresh = [i for i in options if lines[line][i]["form"]["id"] not in used]
        pool = fresh or options
        at = pool[(text_id + line) % len(pool)]
        used.add(lines[line][at]["form"]["id"])
        picked.append((line, at))
    return picked


def mark(lines: list[list[dict[str, Any]]], text_id: int) -> None:
    """Sets `quiz` on the words `pick` chose, in place. A word not chosen has no `quiz` at all."""
    for line, at in pick(lines, text_id):
        lines[line][at]["quiz"] = True
