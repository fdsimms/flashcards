"""A suggested fix for a card the owner flagged, written by Claude when they tap Fix with Claude now.

Asked only on that tap, once, never ahead of time. The answer is a suggestion: the app shows each
changed field, old above new, and makes the edit itself only when the owner taps Apply. Nothing
here reads or writes the collection, and the rating stays the owner's.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

MAX_TOKENS = 2000
MAX_FIELD = 4000  # characters of one field's new value
MAX_EXPLANATION = 400

SYSTEM = """\
You fix one flashcard a language learner flagged. You get the note's fields as the app stores them \
(HTML), why it was flagged, and sometimes the learner's own words about what is wrong: when they \
wrote something, that is the request, so do exactly that. Change only the fields that need it, and \
give each one's complete new value. Keep everything else in a field as it is: HTML tags, bold \
marks around the word in an example sentence, and any [sound:...] or <img> reference. Never add or \
remove a media reference. Never rewrite a field that was fine. If the fix needs a new recording or a \
new image, or you are not sure what is wrong, change nothing and say so. Explain the change in one \
or two plain sentences, for the learner, without em dashes. If you change nothing, say why."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"field": {"type": "string"}, "value": {"type": "string"}},
                "required": ["field", "value"],
                "additionalProperties": False,
            },
        },
        "explanation": {"type": "string"},
    },
    "required": ["changes", "explanation"],
    "additionalProperties": False,
}


class FixCardFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class FlaggedCard:
    # The note's language when Read & Listen writes in it; other note types may not say.
    language: Code | None
    # Field name to its HTML, in the note type's order.
    fields: dict[str, str]
    # The learner's reason for flagging (typo, audio, translation, other), as a sentence.
    reason: str
    # What they typed, or "".
    note: str


@dataclass(frozen=True)
class Fix:
    # Field name to its complete new HTML. Empty when there is nothing to change.
    changes: dict[str, str]
    explanation: str


# The fix, and what asking cost.
FixCard = Callable[[FlaggedCard], Awaitable[tuple[Fix, Usage]]]


def request_message(card: FlaggedCard) -> str:
    lines = []
    if card.language:
        lines.append(f"Language: {LANGUAGES[card.language].name}")
    lines.append(f"Flagged because: {card.reason}")
    if card.note:
        lines.append(f"What the learner wrote: {card.note}")
    lines.append("Fields:")
    lines += [f"{name}: {value}" for name, value in card.fields.items()]
    return "\n".join(lines)


def clean(answer: dict[str, Any], fields: dict[str, str]) -> Fix:
    """The fix as the app should get it: only fields the note has, only ones that change, each
    once, and none too long to be a field. A field that doesn't pass is dropped, not trimmed."""
    changes: dict[str, str] = {}
    raw = answer.get("changes")
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        field, value = item.get("field"), item.get("value")
        if not isinstance(field, str) or not isinstance(value, str):
            continue
        if field not in fields or field in changes or value == fields[field]:
            continue
        if len(value) > MAX_FIELD:
            continue
        changes[field] = value
    explanation = answer.get("explanation")
    text = " ".join(explanation.split())[:MAX_EXPLANATION] if isinstance(explanation, str) else ""
    return Fix(changes, text)


def claude_fix_card(client: anthropic.AsyncAnthropic) -> FixCard:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def fix(card: FlaggedCard) -> tuple[Fix, Usage]:
        messages = [{"role": "user", "content": request_message(card)}]
        try:
            response = await client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM,
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            raise FixCardFailed(
                didnt_answer(e, ". Try again in a moment.", doing="suggest a fix for a card")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise FixCardFailed("Claude didn't suggest a fix. Try again in a moment.", used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise FixCardFailed("Claude's answer couldn't be read. Try again.", used) from e
        if not isinstance(answer, dict):
            raise FixCardFailed("Claude's answer couldn't be read. Try again.", used)
        return clean(answer, card.fields), used

    return fix
