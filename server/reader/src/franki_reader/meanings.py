"""English meanings for the words of a text that nothing else glosses.

A common word counts as known without being in the deck (spaced.py), so the model isn't asked to
gloss it, and a tap on it had no meaning to show. After a text is written, the words in it with no
gloss (from the text, the deck, or an earlier batch) are glossed in one Claude call and kept per
language and word (`word_meanings`), so a word is paid for once and a tap never makes a call. The same
pass runs over texts already waiting to be read. Reading and listening still never grade or write
cards: this only fills in text for the reader to show.
"""

import json
import logging
import re
import sqlite3
from collections.abc import Awaitable, Callable, Iterable
from datetime import datetime
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader import store
from franki_reader.coverage import Checker, is_word, segment_line
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.reader import gloss_for
from franki_reader.store import StoredText

log = logging.getLogger(__name__)

# Words asked about in one call; a pass with more waiting leaves the rest for the next.
MAX_WORDS = 150
MAX_MEANING = 40  # characters
MAX_TOKENS = 8000

_SYSTEM = """\
You give English meanings of {language} words for an English-speaking learner reading a short text. \
Each word is listed with the English translation of one line it appears in, so you can tell which \
sense is meant."""

_REQUEST = """\
For each word below, give its meaning in English as it is used in that line, in one to four words \
(a verb as "to go", a past or inflected form as its own meaning: "went", "warm (neuter)"). Give the \
word exactly as listed. Plain text only: no `|`, no asterisks, no em dashes.

Words, each followed by the English of a line it is in:
{words}"""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"word": {"type": "string"}, "meaning": {"type": "string"}},
                "required": ["word", "meaning"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["words"],
    "additionalProperties": False,
}


class MeaningsFailed(Exception):
    """Claude couldn't write the meanings; logged, and tried again later. `usage` is what the failed
    call was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Writes the meanings for (word, line in English) pairs, and what that cost.
WriteMeanings = Callable[[Code, list[tuple[str, str]]], Awaitable[tuple[list[Any], Usage]]]


def key(word: str) -> str:
    """How a word is kept and looked up: lower case, so a sentence's first word shares its meaning."""
    return word.casefold()


def missing(
    texts: Iterable[StoredText], lexicon: Checker, meanings: dict[str, str]
) -> list[tuple[str, str]]:
    """The words in `texts` with no gloss and no stored answer, as (word, English of the first line
    it's in), in the order they first appear. Names are left out: the model glosses those itself."""
    found: dict[str, str] = {}
    for text in texts:
        for line in text.lines:
            for piece, is_name in segment_line(line.text, lexicon):
                if is_name or not is_word(piece) or key(piece) in found or key(piece) in meanings:
                    continue
                if gloss_for(piece, text.glosses, lexicon, meanings) is None:
                    found[key(piece)] = line.english
    return list(found.items())


def _clean(value: object) -> str:
    """A meaning as the reader shows it, or "" when there's nothing usable."""
    if not isinstance(value, str):
        return ""
    value = re.sub(r"\s*—\s*", ", ", value.replace("|", " ").replace("*", ""))
    value = " ".join(value.split())
    return value if value and len(value) <= MAX_MEANING else ""


def request_message(language: Code, asked: list[tuple[str, str]]) -> str:
    return _REQUEST.format(words="\n".join(f"{word} | {english}" for word, english in asked))


async def fill(
    conn: sqlite3.Connection,
    write: WriteMeanings,
    language: Code,
    texts: Iterable[StoredText],
    lexicon: Checker,
    meanings: dict[str, str],
    now: Callable[[], datetime],
) -> int:
    """Has Claude gloss the words in `texts` that have none, up to `MAX_WORDS`, and keeps what comes
    back. A word it gives nothing usable for is kept without a meaning, so it isn't asked again.
    Returns how many words were asked about; raises `MeaningsFailed` when the call fails, after
    keeping what a paid answer cost as a batch with no words in it, so they're all asked again."""
    asked = missing(texts, lexicon, meanings)[:MAX_WORDS]
    if not asked:
        return 0
    try:
        raw, used = await write(language, asked)
    except MeaningsFailed as e:
        if e.usage != Usage():
            store.save_meaning_batch(conn, language, {}, now(), e.usage.cost_usd())
        raise
    wanted = {word for word, _ in asked}
    answered: dict[str, str] = {}
    for item in raw:
        if isinstance(item, dict) and isinstance(item.get("word"), str):
            word = key(item["word"])
            if word in wanted:
                answered.setdefault(word, _clean(item.get("meaning")))
    store.save_meaning_batch(
        conn, language, {word: answered.get(word, "") for word in wanted}, now(), used.cost_usd()
    )
    return len(asked)


def claude_meanings(client: anthropic.AsyncAnthropic) -> WriteMeanings:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(language: Code, asked: list[tuple[str, str]]) -> tuple[list[Any], Usage]:
        messages = [{"role": "user", "content": request_message(language, asked)}]
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
            raise MeaningsFailed(f"Claude didn't answer ({type(e).__name__})") from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise MeaningsFailed(f"No meanings ({response.stop_reason})", used)
        try:
            words = json.loads(text).get("words")
        except (json.JSONDecodeError, AttributeError) as e:
            raise MeaningsFailed("The answer wasn't valid JSON", used) from e
        return (words if isinstance(words, list) else []), used

    return write
