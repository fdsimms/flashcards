"""The words that go with a grammatical form to give a word its meaning in a line, and the check that
a claimed one really is one (data/helpers/<code>.json, one file per language).

A form is only part of what a word means in its line: the instrumental of друг is "with a friend"
after с, a past participle is "has eaten" after a, a Greek subjunctive is "(that) I go" after να.
Claude names the word in the line the form goes with (forms.py); code keeps that only when it is
one of the language's own, for the kind of form:

- `prepositions`: any case, when the preposition comes before the word;
- `governs`: a verb and the one case it takes (помогать, dative), for a case, anywhere in the line;
- `with`: for a form id (a participle, a gerund, a subjunctive), the auxiliaries and triggers that
  go with it (ha, haber, que, να), anywhere in the line, since a verb-final clause puts its
  auxiliary after the participle.

`contractions` is separate and needs no model: a word that is a preposition and an article in one
(στο, al, zum) says what it is made of. Only contractions that are never anything else are listed:
French des and du are also the plain articles, German am is also the superlative.
"""

import json
import re
from collections.abc import Callable
from functools import cache
from pathlib import Path
from typing import Any

DATA = Path(__file__).parent / "data" / "helpers"


@cache
def helpers(language: str) -> dict[str, Any]:
    """A language's helper words, or none for a language with no file."""
    path = DATA / f"{language}.json"
    if not path.is_file():
        return {}
    raw: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    # Folded the way a line's words are (Greek final ς is σ, German ß is ss), so they compare equal.
    return {
        "prepositions": [w.casefold() for w in raw["prepositions"]],
        "governs": {v.casefold(): case for v, case in raw["governs"].items()},
        "with": {f: [w.casefold() for w in ws] for f, ws in raw["with"].items()},
        "contractions": {w.casefold(): parts for w, parts in raw["contractions"].items()},
    }


def contraction(language: str, word: str) -> str | None:
    """What a contracted word is made of ("σε + το" for στο), or None for any other word."""
    parts: str | None = helpers(language).get("contractions", {}).get(word.casefold())
    return parts


def tokens(line: str) -> list[str]:
    """The words of a plain line, lower-cased."""
    return re.findall(r"\w+", line.casefold())


def is_helper(
    language: str,
    form: str,
    is_case: bool,
    helper: str,
    word: str,
    line: str,
    lemma: Callable[[str], str | None],
) -> bool:
    """Whether `helper` is a word of `line`, other than `word`, that goes with `word` in the form `form`
    by the language's lists. `lemma` gives a word's dictionary form, None when it is its own."""
    data = helpers(language)
    found, mine = tokens(line), word.casefold()
    helper = helper.casefold()
    if mine not in found or helper not in found or helper == mine:
        return False
    if helper in data.get("with", {}).get(form, []):
        return True
    if not is_case:
        return False
    if helper in data.get("prepositions", []) and found.index(helper) < found.index(mine):
        return True
    verb = lemma(helper) or helper
    return str(data.get("governs", {}).get(verb.casefold())) == form
