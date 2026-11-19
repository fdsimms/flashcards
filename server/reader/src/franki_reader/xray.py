"""X-Ray: what a story's characters are, as far as the reader has got (docs/read-and-listen/
architecture.md, X-Ray).

Each episode's reply lists the characters it adds or changes, each with a short English fact. The
story keeps them as one entry per character with its facts tagged by the episode that gave them, so
a card shown for episode N uses only facts from episodes up to N and never gives away what happens
later. Pure: no clock, no database.
"""

from typing import Any

MAX_FACT = 140  # characters in one fact
MAX_FACTS = 8  # facts kept for a character; the oldest go first
SHOWN_FACTS = 3  # facts joined into the one-line description, the latest ones
MAX_CHARACTERS = 30


def _fold(name: str) -> str:
    return name.strip().casefold()


def parse_characters(raw: Any) -> tuple[tuple[str, str, int | None], ...]:
    """The characters an episode's reply listed, as (name, fact, first episode or None). One with no
    name or no fact is left out, and each name counts once (the first fact given wins)."""
    seen: dict[str, tuple[str, str, int | None]] = {}
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        fact = " ".join(str(item.get("fact") or "").split())[:MAX_FACT]
        since = item.get("since")
        if name and fact and _fold(name) not in seen:
            seen[_fold(name)] = (name, fact, since if isinstance(since, int) else None)
    return tuple(seen.values())


def merge(
    known: list[dict[str, Any]],
    new: tuple[tuple[str, str, int | None], ...],
    episode: int,
) -> list[dict[str, Any]]:
    """`known` (one {"name", "facts": [{"episode", "text"}]} per character) with `new` added as
    facts of `episode`. A character already there, whatever its capitals, gets the fact (unless it's
    already said); a new one is added. A story with no characters yet takes each one's own first
    episode, which is how a story already running is filled in by its next episode."""
    out = [{"name": c["name"], "facts": list(c["facts"])} for c in known]
    first_fill = not known
    for name, fact, since in new:
        at = min(max(since, 1), episode) if first_fill and since else episode
        found = next((c for c in out if _fold(c["name"]) == _fold(name)), None)
        if found is None:
            if len(out) >= MAX_CHARACTERS:
                continue
            found = {"name": name, "facts": []}
            out.append(found)
        if any(_fold(f["text"]) == _fold(fact) for f in found["facts"]):
            continue
        found["facts"].append({"episode": at, "text": fact})
        found["facts"].sort(key=lambda f: f["episode"])
        del found["facts"][:-MAX_FACTS]
    return out


def visible(known: list[dict[str, Any]], episode: int) -> list[dict[str, Any]]:
    """The characters as of `episode`: only those first given a fact by then, each described by its
    latest facts up to then. Ordered by the episode they first appear in."""
    out = []
    for c in known:
        facts = [f for f in c["facts"] if f["episode"] <= episode]
        if not facts:
            continue
        out.append(
            {
                "name": c["name"],
                "description": " ".join(f["text"] for f in facts[-SHOWN_FACTS:]),
                "first_episode": facts[0]["episode"],
            }
        )
    out.sort(key=lambda c: c["first_episode"])
    return out


def matches(name: str, word: str) -> bool:
    """Whether a word of a text is the character's name. A name can be inflected (Russian Аня is
    Ане, Аню; Дмитрий is Дмитрию), so a word also counts when it keeps the name's stem, which is
    the name less its last letter (two for a name of six or more letters), and is no longer than
    the name plus two letters. A name under four letters must match whole."""
    a, b = _fold(name), _fold(word)
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) < 4:
        return False
    stem = a[: len(a) - (2 if len(a) >= 6 else 1)]
    return b.startswith(stem) and len(b) <= len(a) + 2


def tag_names(lines: list[dict[str, Any]], characters: list[dict[str, Any]]) -> set[str]:
    """Marks each name word in rendered lines that is one of `characters` with its name
    (`word["character"]`), and returns the names that turned up. Only a word the text marks as a
    name counts, so an ordinary word that spells a name isn't taken for one."""
    names = [c["name"] for c in characters]
    here: set[str] = set()
    for line in lines:
        for word in line["words"]:
            if word.get("status") != "name":
                continue
            hit = next((n for n in names if matches(n, word["text"])), None)
            if hit is not None:
                word["character"] = hit
                here.add(hit)
    return here
