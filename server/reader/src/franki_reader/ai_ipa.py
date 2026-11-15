"""IPA written by Claude for the words of a text that Wiktionary's tables have none for
(docs/read-and-listen/architecture.md, IPA).

Wiktionary has most lemmas, and most forms in Russian, Polish and Thai, but an inflected German,
Spanish, French, Greek or Norwegian form often has no entry (ipa.py). After a text is written, the
words in it with no table IPA are sent to Claude in one call, each with the line it's in (so a
homograph and its stress can be told apart), and the answers are kept for the language
(`word_ipa`). A tap never makes a call. Nothing checks the answer against anything, so the app always
says it's written by AI and may be wrong (`ipa_source` "ai"): stress is where it goes wrong most.

Like the meanings pass (meanings.py), a word Claude gives nothing usable for is kept with none, so it
isn't asked about again, and a call that fails after Claude answered is kept as a cost with no words.
Reading and listening still never grade or write cards: this only fills in text for the reader to show.
"""

import json
import logging
import re
import sqlite3
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader import store
from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker, is_word, segment_line
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.ipa import ipa_of, table
from franki_reader.languages import LANGUAGES, Code
from franki_reader.store import StoredText

log = logging.getLogger(__name__)

# Words asked about in one call; a pass with more waiting leaves the rest for the next.
MAX_WORDS = 150
MAX_IPA = 60  # characters
MAX_TOKENS = 8000

_SYSTEM = """\
You write IPA for {language} words, for a learner reading a short text. Each word is listed with the line \
it appears in, so you can tell which word it is (a homograph, where the stress falls)."""

# What each language's IPA looks like, as its Wiktionary entries write it.
_STYLE = {
    "ru": "in square brackets, with stress marked (ˈ) and vowels reduced as spoken, like [ˈdomʲɪ]",
    "pl": "in slashes, with syllable dots, like /ˈkɔ.ʂu.la/",
    "de": "standard German, in slashes, like /ˈʁuːm/",
    "es": "neutral Latin American Spanish, in slashes, like /toɾˈniʝo/",
    "fr": "standard French, in slashes, with syllable dots, like /tʁɑ̃.pe/",
    "el": "standard Modern Greek, in slashes, like /puθeˈna/",
    "nb": "East Norwegian (Bokmål), in slashes, like /kɾɔpː/",
    "th": "in slashes, with tone marks as Wiktionary's Thai entries have, like /tʰɔːn˧/",
}

_REQUEST = """\
For each numbered word below, write its IPA {style}. Write the word as it is pronounced in the line, \
stress marked where the language has stress. If you aren't sure of the stress, give your best guess \
rather than leaving the word out. Give each word's number, and the word exactly as listed. Plain text \
only: no `|`, no asterisks, no spaces inside the IPA, no explanation.

Words, each numbered and followed by the line it is in:
{words}"""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "n": {"type": "integer"},
                    "word": {"type": "string"},
                    "ipa": {"type": "string"},
                },
                "required": ["n", "word", "ipa"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["words"],
    "additionalProperties": False,
}


class IpaFailed(Exception):
    """Claude couldn't write the IPA; logged, and tried again later. `usage` is what the failed call
    was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Writes the IPA for (word, line) pairs, numbered from 1 in the request, and what that cost.
WriteIpa = Callable[[Code, list[tuple[str, str]]], Awaitable[tuple[list[Any], Usage]]]


def key(word: str) -> str:
    """How a word is kept and looked up: lower case, as ipa.ipa_for looks it up."""
    return word.casefold()


@dataclass(frozen=True)
class Wanted:
    """A word to write IPA for, as it was written in the text, with the line it's first in."""

    word: str
    line: str


def has_table(language: Code) -> bool:
    """Whether the language has Wiktionary tables, which is what makes a missing word worth asking
    about: Japanese is read from its kana by rule, and English has no IPA here at all."""
    return bool(table(language))


def missing(texts: Iterable[StoredText], lexicon: Checker, kept: dict[str, str]) -> list[Wanted]:
    """The words in each of `texts` that have no IPA from Wiktionary's table and none written
    already (`kept`, by lower-case word, an empty one for a word Claude gave nothing for), each with
    the first line it's in, in the order they appear. Names, phrases and numbers are left out."""
    found: list[Wanted] = []
    seen: set[str] = set()
    for text in texts:
        if not has_table(text.language):
            continue
        for line in text.lines:
            for piece, is_name in segment_line(line.text, lexicon):
                word = key(piece)
                if is_name or not is_word(piece) or " " in piece.strip() or word in seen:
                    continue
                seen.add(word)
                if word in kept or any(c.isdigit() for c in piece):
                    continue
                if ipa_of(piece, text.language) is None:
                    found.append(Wanted(piece, line.text))
    return found


def _clean(value: object) -> str:
    """An IPA as the reader shows it, or "" when there's nothing usable: text with a space or a
    marker inside, or too long. It is wrapped in slashes when it carries no brackets of its own."""
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if not value or len(value) > MAX_IPA or re.search(r"[\s|*—\d]", value):
        return ""
    if value[0] in "/[" and value[-1] in "/]" and len(value) > 1:
        inner = value[1:-1]
    else:
        inner = value.strip("/[]")
        value = f"/{inner}/"
    return value if inner else ""


def request_message(language: Code, asked: list[tuple[str, str]]) -> str:
    return _REQUEST.format(
        style=_STYLE.get(language, "in slashes"),
        words="\n".join(f"{n}. {word} | {line}" for n, (word, line) in enumerate(asked, 1)),
    )


async def fill(
    conn: sqlite3.Connection,
    write: WriteIpa,
    language: Code,
    words: list[Wanted],
    now: Callable[[], datetime],
) -> dict[str, str]:
    """Has Claude write IPA for the first `MAX_WORDS` of `words` in one call and keeps what comes
    back for the language. Each answer is matched to its word by number, so a miscount keeps
    nothing. A word it gives nothing usable for is kept with none, so it isn't asked again. Returns
    the IPA written, by lower-case word; raises `IpaFailed` when the call fails, after keeping what a
    paid answer cost."""
    asked = words[:MAX_WORDS]
    if not asked:
        return {}
    try:
        raw, used = await write(language, [(w.word, w.line) for w in asked])
    except IpaFailed as e:
        if e.usage != Usage():
            store.save_word_ipa(conn, language, {}, now(), e.usage.cost_usd())
        raise
    answered: dict[int, str] = {}
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("word"), str):
            continue
        n = item.get("n")
        if (
            isinstance(n, int)
            and 1 <= n <= len(asked)
            and key(item["word"]) == key(asked[n - 1].word)
        ):
            answered.setdefault(n - 1, _clean(item.get("ipa")))
    kept = {key(w.word): answered.get(i, "") for i, w in enumerate(asked)}
    store.save_word_ipa(conn, language, kept, now(), used.cost_usd())
    return {w: ipa for w, ipa in kept.items() if ipa}


def claude_ipa(client: anthropic.AsyncAnthropic) -> WriteIpa:
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
            raise IpaFailed(didnt_answer(e)) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise IpaFailed(f"No IPA ({response.stop_reason})", used)
        try:
            words = json.loads(text).get("words")
        except (json.JSONDecodeError, AttributeError) as e:
            raise IpaFailed("The answer wasn't valid JSON", used) from e
        return (words if isinstance(words, list) else []), used

    return write
