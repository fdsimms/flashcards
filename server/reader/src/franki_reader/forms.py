"""Which grammatical form each inflected word of a text is in, so a tap on it can say "instrumental
case" and open a primer (docs/read-and-listen/architecture.md, Word forms).

Once a text is written, one Claude call is given every word in it that is a form of another word (its
dictionary form is shown in the popup: `reader.lemma_for`), each with the line it's in, and picks for
each the form it has *there* from the language's own list (form_primers.py), or none. It's per text, not
per word, because the same spelling can be different forms in different lines (чем is the instrumental
of что, and also "than"). The answers are kept on the text, so a tap never makes a call and a text is
asked about once. The call is Claude's reading of the line; code only checks that the answer is a form on
the list, for a word that was asked about. A form note shown wrongly is worse than none.

A word that occurs more than once is asked about at its first appearance. Reading and listening still
never grade or write cards: this only fills in text for the reader to show.
"""

import json
import logging
from collections.abc import Awaitable, Callable, Iterable
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader import form_primers
from franki_reader.coverage import Checker, is_word, parse_line, segment_line
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.reader import lemma_for
from franki_reader.store import StoredText

log = logging.getLogger(__name__)

# Words asked about in one call; a text has far fewer, so this only stops a runaway one.
MAX_WORDS = 250
MAX_TOKENS = 8000
NONE = "none"

_SYSTEM = """\
You tell an English-speaking learner which grammatical form a {language} word has in the line it \
appears in."""

_REQUEST = """\
Each row below is a word from a {language} text, its dictionary form, the line it is in, and the \
English of that line. For each word, say which of these forms it is in that line:

{forms}

Answer "{none}" when none of them fits: the word is not an inflected form of its dictionary form here \
(a different word that happens to look like one), it is a form this list doesn't have, or you are \
not sure. Judge by the line, not by the spelling alone. Give the word exactly as listed.

Rows, as word | dictionary form | line | English:
{rows}"""


def schema(language: Code) -> dict[str, Any]:
    ids = [*form_primers.names(language), NONE]
    return {
        "type": "object",
        "properties": {
            "words": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"word": {"type": "string"}, "form": {"enum": ids}},
                    "required": ["word", "form"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["words"],
        "additionalProperties": False,
    }


class FormsFailed(Exception):
    """Claude couldn't pick the forms; logged, and the text is served without them. `usage` is what
    the failed call was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# One row asked about: the word, its dictionary form, its line as written (without markup) and the
# English of that line.
Row = tuple[str, str, str, str]

# Picks a form for each row, as raw {"word", "form"} answers, and what the call cost.
WriteForms = Callable[[Code, list[Row]], Awaitable[tuple[list[Any], Usage]]]


def key(word: str) -> str:
    """How a word is kept and looked up: lower case, so a sentence's first word shares its entry."""
    return word.casefold()


def candidates(text: StoredText, lexicon: Checker) -> list[Row]:
    """The words of `text` that are a form of another word, at their first appearance, in order."""
    found: dict[str, Row] = {}
    for line in text.lines:
        plain = parse_line(line.text, lexicon.spaced)[0]
        for piece, is_name in segment_line(line.text, lexicon):
            if is_name or not is_word(piece) or key(piece) in found:
                continue
            if lemma := lemma_for(piece, lexicon):
                found[key(piece)] = (piece, lemma, plain, line.english)
    return list(found.values())[:MAX_WORDS]


def request_message(language: Code, rows: list[Row]) -> str:
    forms = "\n".join(f"- {i}: {n}" for i, n in form_primers.names(language).items())
    return _REQUEST.format(
        language=LANGUAGES[language].name,
        forms=forms,
        none=NONE,
        rows="\n".join(" | ".join(r) for r in rows),
    )


def keep(language: Code, raw: Iterable[object], rows: list[Row]) -> dict[str, str]:
    """The answers that name a form on the language's list for a word that was asked about, by
    lower-case word. `none`, anything else and a word nobody asked about are dropped."""
    ids = form_primers.names(language)
    asked = {key(r[0]) for r in rows}
    kept: dict[str, str] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        word, form = item.get("word"), item.get("form")
        if isinstance(word, str) and isinstance(form, str) and form in ids and key(word) in asked:
            kept.setdefault(key(word), form)
    return kept


def claude_forms(client: anthropic.AsyncAnthropic) -> WriteForms:
    async def write(language: Code, rows: list[Row]) -> tuple[list[Any], Usage]:
        output_config: BetaOutputConfigParam = {
            "effort": "low",
            "format": {"type": "json_schema", "schema": schema(language)},
        }
        messages = [{"role": "user", "content": request_message(language, rows)}]
        try:
            response = await client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=_SYSTEM.format(language=LANGUAGES[language].name),
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            raise FormsFailed(f"Claude didn't answer ({type(e).__name__})") from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise FormsFailed(f"No forms ({response.stop_reason})", used)
        try:
            words = json.loads(text).get("words")
        except (json.JSONDecodeError, AttributeError) as e:
            raise FormsFailed("The answer wasn't valid JSON", used) from e
        return (words if isinstance(words, list) else []), used

    return write
