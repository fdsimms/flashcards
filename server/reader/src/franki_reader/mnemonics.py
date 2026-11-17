"""Memory hints for a word the owner keeps forgetting (a leech in the app's review).

The app asks only after the owner taps "Suggest hints" in the sheet that opens when a card becomes
a leech; nothing is asked ahead of time or for every card. The hints go in the note's Mnemonic
field, which shows on the back of the card, so they may name the meaning freely.
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

COUNT = 3
MAX_TOKENS = 1000
MAX_CHARS = 200

SYSTEM = (
    "You write memory hints (mnemonics) for a flashcard word the learner keeps forgetting. "
    f"Write exactly {COUNT} hints, each a different kind: one that links the word's sound to "
    "an English word or phrase, one that pictures a single everyday scene where the word's "
    "meaning plainly happens, and one that uses the word's structure, its origin, tone or a "
    "related word the learner may know. Keep every hint tied to the word's actual meaning and "
    "form. The picture is ordinary and believable, never a cartoon, a superhero, a villain or "
    "any other far-fetched setup, and it works best when it reuses the sound or part you "
    "already linked. If a kind doesn't fit this word without a stretch, use a plainer hint of "
    "another kind instead of forcing it. Each hint is one or two short "
    f"sentences, under {MAX_CHARS} characters, plain English apart from the foreign word itself, "
    "and says what the word means. Do not use em dashes. The hint will be shown on the back of "
    "the card, after the learner has seen the answer."
)

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"hints": {"type": "array", "items": {"type": "string"}}},
    "required": ["hints"],
    "additionalProperties": False,
}


class MnemonicsFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class MnemonicRequest:
    language: Code
    entry: str
    meaning: str
    transliteration: str = ""
    context: str = ""


# The hints, and what asking for them cost.
MakeMnemonics = Callable[[MnemonicRequest], Awaitable[tuple[list[str], Usage]]]


def request_message(request: MnemonicRequest) -> str:
    lines = [
        f"Language: {LANGUAGES[request.language].name}",
        f"Word: {request.entry}",
    ]
    if request.transliteration:
        lines.append(f"Pronunciation: {request.transliteration}")
    lines.append(f"Meaning: {request.meaning}")
    if request.context:
        lines.append(f"Example sentence: {request.context}")
    return "\n".join(lines)


def clean(hints: object) -> list[str]:
    """The hints the model gave, trimmed, without blanks or repeats, at most COUNT."""
    if not isinstance(hints, list):
        return []
    seen: list[str] = []
    for h in hints:
        if isinstance(h, str) and (text := h.strip()) and text not in seen:
            seen.append(text[:MAX_CHARS] if len(text) > MAX_CHARS else text)
    return seen[:COUNT]


def claude_mnemonics(client: anthropic.AsyncAnthropic) -> MakeMnemonics:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def make(request: MnemonicRequest) -> tuple[list[str], Usage]:
        messages = [{"role": "user", "content": request_message(request)}]
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM,
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            raise MnemonicsFailed(didnt_answer(e, ". Try again in a moment.")) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise MnemonicsFailed(
                "Claude didn't give any hints for this word. Write your own.", used
            )
        try:
            hints = clean(json.loads(text).get("hints"))
        except (json.JSONDecodeError, AttributeError) as e:
            raise MnemonicsFailed("Claude's answer couldn't be read. Try again.", used) from e
        if not hints:
            raise MnemonicsFailed(
                "Claude didn't give any hints for this word. Write your own.", used
            )
        return hints, used

    return make
