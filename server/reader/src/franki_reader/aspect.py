"""A verb's aspect and its aspect partner, written by Claude when the owner adds the verb to the
deck from the reader (Russian and Polish).

Asked only on that tap of Add to deck, once, never ahead of time and never on a plain tap of a word.
The answer is a suggestion for the note editor, which shows it for the owner to check before saving
(`aspect_source` "ai": nothing verifies it against Wiktionary or anything else). Reading and
listening still never grade or write cards: this only fills in text for the editor.
"""

import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

log = logging.getLogger(__name__)

# The languages whose verbs come in aspect pairs that the deck keeps as two linked notes.
ASPECT_LANGUAGES: tuple[Code, ...] = ("ru", "pl")

Aspect = Literal["perfective", "imperfective"]

MAX_TOKENS = 600
MAX_WORD = 40  # characters
MAX_MEANING = 120

_SYSTEM = """\
You are a {language} dictionary for an adult learner. You are given one {language} verb, and the \
sentence it was read in. Say whether the verb is perfective or imperfective, and give its aspect \
partner: the other-aspect verb that is its ordinary counterpart (for a pair like wyjść / wychodzić). \
Give the partner's infinitive, a short English meaning for it as a dictionary would (starting with \
"to"), and nothing else. If the word is not a verb, or has no aspect partner (a verb of one aspect \
only), give an empty partner. If it has several partners, give the most common one. Plain text only: \
no asterisks, no `|`, no explanation. Do not use em dashes."""

_REQUEST = """\
Verb: {word}
Sentence it was read in: {line}"""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "aspect": {"type": "string", "enum": ["perfective", "imperfective", ""]},
        "partner": {"type": "string"},
        "partner_meaning": {"type": "string"},
    },
    "required": ["aspect", "partner", "partner_meaning"],
    "additionalProperties": False,
}


class AspectFailed(Exception):
    """Claude couldn't answer; the person is told and can try again. `usage` is what the failed
    call was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class AspectRequest:
    language: Code
    word: str
    line: str


@dataclass(frozen=True)
class AspectPair:
    """The verb's own aspect and its partner. Every field is None for a word that has none to
    suggest (not a verb, one aspect only, or an answer that couldn't be used)."""

    aspect: Aspect | None
    partner: str | None
    partner_meaning: str | None

    def as_json(self) -> dict[str, Any]:
        return {
            "aspect": self.aspect,
            "partner": self.partner,
            "partner_meaning": self.partner_meaning,
            # Nothing checks it, so the app always says it was written by AI.
            "aspect_source": "ai" if self.partner else None,
        }


NONE = AspectPair(None, None, None)

# Writes the pair for one verb, and what that cost.
WriteAspect = Callable[[AspectRequest], Awaitable[tuple[AspectPair, Usage]]]


def _text(value: object, limit: int) -> str:
    """A short plain-text answer, or "" when it's missing, too long or carries a marker."""
    if not isinstance(value, str):
        return ""
    value = " ".join(value.split())
    if not value or len(value) > limit or re.search(r"[|*<>\d—]", value):
        return ""
    return value


def clean(answer: dict[str, Any], word: str) -> AspectPair:
    """The pair as the editor should get it. A partner that is the word itself, or an aspect that
    isn't one of the two, gives nothing: a wrong link is worse than none."""
    aspect = answer.get("aspect")
    partner = _text(answer.get("partner"), MAX_WORD)
    if aspect not in ("perfective", "imperfective") or not partner:
        return NONE
    if partner.casefold() == word.strip().casefold():
        return NONE
    meaning = _text(answer.get("partner_meaning"), MAX_MEANING)
    return AspectPair(cast(Aspect, aspect), partner, meaning or None)


def request_message(request: AspectRequest) -> str:
    return _REQUEST.format(word=request.word, line=request.line or "(none)")


def claude_aspect(client: anthropic.AsyncAnthropic) -> WriteAspect:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(request: AspectRequest) -> tuple[AspectPair, Usage]:
        messages = [{"role": "user", "content": request_message(request)}]
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=_SYSTEM.format(language=LANGUAGES[request.language].name),
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            log.warning("Claude couldn't give an aspect pair: %s: %s", type(e).__name__, e)
            raise AspectFailed(didnt_answer(e, ". Try again in a moment.")) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise AspectFailed("Claude didn't give an aspect pair. Try again in a moment.", used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise AspectFailed("Claude's answer couldn't be read. Try again.", used) from e
        if not isinstance(answer, dict):
            raise AspectFailed("Claude's answer couldn't be read. Try again.", used)
        return clean(answer, request.word), used

    return write
