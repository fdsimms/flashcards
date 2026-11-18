"""Scene ideas for an audio lesson (lesson.py), so a scene doesn't have to be thought up from
nothing. The owner still picks and asks for the lesson; these only fill the scene field.

Claude is given the language, the learner's own words when they chose some, and the scenes of
lessons already made (and the ideas just shown), and writes a few short English scenes. The code
keeps the usable ones: trimmed, within the scene's length, none repeated or already taken.
Nothing here reads the collection, grades a card or makes a lesson.
"""

import json
from collections.abc import Awaitable, Callable
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader import lesson
from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

MAX_TOKENS = 600
# How many ideas are offered at once, and the longest one (a scene reads like "Ordering a coffee").
COUNT = 4
MAX_IDEA = 60
# How many scenes already made or shown are sent, so the request stays small.
MAX_AVOID = 30

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"topics": {"type": "array", "items": {"type": "string"}}},
    "required": ["topics"],
    "additionalProperties": False,
}

_REQUEST = """\
Suggest {count} different situations for a short spoken {language} lesson for a beginner. Each is
a scene a traveler or a learner would really be in, written as a short English phrase of two to six
words, like "Ordering a coffee" or "Asking for directions". Plain text only: no quotes, numbering,
asterisks or em dashes.{words}{avoid}"""

_WORDS = """

The learner has chosen these {language} words and phrases to be taught. Suggest situations where
they would come up naturally, so the lesson is about using them:
{items}"""

_AVOID = """

Do not suggest these, or anything close to them:
{items}"""


class TopicsFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# What Claude wrote and what asking cost: `words` are the learner's own, as "text (meaning)".
WriteTopics = Callable[[Code, tuple[str, ...], tuple[str, ...]], Awaitable[tuple[Any, Usage]]]


def words_of(phrases: tuple[lesson.Phrase, ...]) -> tuple[str, ...]:
    return tuple(f"{p.text} ({p.english})" for p in phrases)


def request_message(language: Code, words: tuple[str, ...], avoid: tuple[str, ...]) -> str:
    return _REQUEST.format(
        count=COUNT,
        language=LANGUAGES[language].name,
        words=_WORDS.format(
            language=LANGUAGES[language].name, items="\n".join(f"- {w}" for w in words)
        )
        if words
        else "",
        avoid=_AVOID.format(items="\n".join(f"- {a}" for a in avoid[:MAX_AVOID])) if avoid else "",
    )


def clean_topics(raw: Any, avoid: tuple[str, ...]) -> list[str]:
    """The ideas worth showing, in order: strings, trimmed of spaces and quotes, with a sentence's
    final full stop dropped, no longer than `MAX_IDEA`, none repeated (ignoring case) or in
    `avoid`, at most `COUNT`."""
    items = raw.get("topics") if isinstance(raw, dict) else None
    seen = {a.casefold() for a in avoid}
    out: list[str] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, str):
            continue
        idea = " ".join(item.split()).strip("\"'“”‘’").rstrip(".").strip()
        if not idea or len(idea) > MAX_IDEA or idea.casefold() in seen:
            continue
        seen.add(idea.casefold())
        out.append(idea)
    return out[:COUNT]


def claude_topics(client: anthropic.AsyncAnthropic) -> WriteTopics:
    async def write(
        language: Code, words: tuple[str, ...], avoid: tuple[str, ...]
    ) -> tuple[Any, Usage]:
        messages = [{"role": "user", "content": request_message(language, words, avoid)}]
        output_config: BetaOutputConfigParam = {
            "effort": "low",
            "format": {"type": "json_schema", "schema": SCHEMA},
        }
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            raise TopicsFailed(
                didnt_answer(e, ". Try again in a moment.", doing="suggest lesson topics")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise TopicsFailed("Claude didn't answer. Try again in a moment.", used)
        try:
            return json.loads(text), used
        except json.JSONDecodeError as e:
            raise TopicsFailed("Claude's answer couldn't be read. Try again.", used) from e

    return write
