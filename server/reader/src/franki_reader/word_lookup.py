"""Words for a meaning: Quick add's "Don't know the word?" in the app, where the owner types what
they want to say in English and picks the word to add from what comes back.

Asked only when the owner sends a meaning, never ahead of time. It only returns words: a word the
owner picks goes to the note queue like any typed one (note_queue.py), and nothing here reads or
writes the collection.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

# Words returned at most, the likeliest first.
COUNT = 4
MAX_TOKENS = 1000
MAX_WORD = 80
MAX_NOTE = 120

SYSTEM = (
    "A language learner wants to say something in {language} and doesn't know the word. Given "
    "what they mean in English, give the {language} words or short phrases a native speaker would "
    f"use for it, the most common first, at most {COUNT}. Give each word in its dictionary form, "
    "written in {language}'s own alphabet or script, with its meaning in English in a few words, "
    "and a note of a few words that tells it apart from the others (formal, a perfective verb, "
    "used for objects only). Leave the note empty when there is only one word. Give only words "
    "you are sure of. Do not use em dashes."
)

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "entry": {"type": "string"},
                    "meaning": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["entry", "meaning", "note"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["words"],
    "additionalProperties": False,
}


class LookupFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class FoundWord:
    entry: str
    meaning: str
    # What tells it apart from the other words found; empty when there's nothing to say.
    note: str


# The words for a meaning in a language, and what asking cost.
LookUpWords = Callable[[Code, str], Awaitable[tuple[list[FoundWord], Usage]]]


def _line(value: object, limit: int) -> str:
    """One line of plain text, or empty when it isn't one a row can show."""
    if not isinstance(value, str):
        return ""
    value = " ".join(value.split())
    if len(value) > limit or any(c in value for c in "<>|*—"):
        return ""
    return value


def clean(words: object) -> list[FoundWord]:
    """The words the model gave that can be shown, without repeats, at most COUNT. A word with no
    meaning is left out, since the row would offer it with nothing to say what it is."""
    if not isinstance(words, list):
        return []
    found: list[FoundWord] = []
    for w in words:
        if not isinstance(w, dict):
            continue
        entry = _line(w.get("entry"), MAX_WORD)
        meaning = _line(w.get("meaning"), MAX_WORD)
        if not entry or not meaning or any(f.entry == entry for f in found):
            continue
        found.append(FoundWord(entry, meaning, _line(w.get("note"), MAX_NOTE)))
    return found[:COUNT]


def claude_word_lookup(client: anthropic.AsyncAnthropic) -> LookUpWords:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def look_up(language: Code, meaning: str) -> tuple[list[FoundWord], Usage]:
        name = LANGUAGES[language].name
        messages = [{"role": "user", "content": f"What I mean: {meaning}"}]
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM.format(language=name),
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            raise LookupFailed(
                didnt_answer(e, ". Try again in a moment.", doing="look up words")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise LookupFailed(
                f"Claude didn't find a {name} word for that. Try saying it another way.", used
            )
        try:
            words = clean(json.loads(text).get("words"))
        except (json.JSONDecodeError, AttributeError) as e:
            raise LookupFailed("Claude's answer couldn't be read. Try again.", used) from e
        if not words:
            raise LookupFailed(
                f"Claude didn't find a {name} word for that. Try saying it another way.", used
            )
        return words, used

    return look_up
