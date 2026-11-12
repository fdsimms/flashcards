"""A line's grammar and vocabulary explained in English, when the owner taps Explain on it.

Asked only on that tap, once per line (the answer is kept in `explanations`), never ahead of time.
Reading and listening still never grade or write cards: this only shows text.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.generator import MODEL
from franki_reader.languages import LANGUAGES, Code

MAX_POINTS = 6
MAX_TOKENS = 1500
MAX_CHARS = 400

SYSTEM = (
    "You explain one line of a short text to an adult learner of the language, in plain English. "
    "Say what the learner is most likely to be unsure of: grammar (tense, mood, agreement, word "
    "order, particles, reflexive or separable verbs), a phrase that isn't word for word, an idiom "
    "or register. Skip words and structures a learner at this level would already know. "
    f"Give at most {MAX_POINTS} points, most useful first, each naming the part of the line "
    "(`phrase`, copied exactly from the line) and what to know about it (`note`, one to three "
    f"short sentences, under {MAX_CHARS} characters). Give a literal translation only when it "
    "shows how the phrase works. Do not use em dashes. Do not repeat the whole line's translation: "
    "the learner can already see it."
)

SIMPLE = (
    " The learner found a first explanation too hard. Use everyday words, no grammar terms "
    "unless you explain them in the same note, and give at most three points."
)

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "points": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"phrase": {"type": "string"}, "note": {"type": "string"}},
                "required": ["phrase", "note"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["points"],
    "additionalProperties": False,
}


class ExplainFailed(Exception):
    """Written to be shown as it is."""


@dataclass(frozen=True)
class ExplainRequest:
    language: Code
    line: str  # plain text, as shown
    english: str
    # The lines around it, plain text, so a pronoun or a reply makes sense.
    context: tuple[str, ...] = ()
    simple: bool = False


Explain = Callable[[ExplainRequest], Awaitable[list[dict[str, str]]]]


def request_message(request: ExplainRequest) -> str:
    lines = [f"Language: {LANGUAGES[request.language].name}", f"Line: {request.line}"]
    lines.append(f"English: {request.english}")
    if request.context:
        lines.append("The text around it:")
        lines.extend(f"- {c}" for c in request.context)
    return "\n".join(lines)


def clean(points: object) -> list[dict[str, str]]:
    """The points the model gave, trimmed, without blanks, at most MAX_POINTS."""
    if not isinstance(points, list):
        return []
    out: list[dict[str, str]] = []
    for p in points:
        if not isinstance(p, dict):
            continue
        phrase, note = p.get("phrase"), p.get("note")
        if isinstance(phrase, str) and isinstance(note, str) and phrase.strip() and note.strip():
            out.append({"phrase": phrase.strip(), "note": note.strip()[:MAX_CHARS]})
    return out[:MAX_POINTS]


def claude_explain(client: anthropic.AsyncAnthropic) -> Explain:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def explain(request: ExplainRequest) -> list[dict[str, str]]:
        messages = [{"role": "user", "content": request_message(request)}]
        try:
            response = await client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM + (SIMPLE if request.simple else ""),
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            raise ExplainFailed(
                f"Claude didn't answer ({type(e).__name__}). Try again in a moment."
            ) from e
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise ExplainFailed("Claude didn't explain this line. Try again in a moment.")
        try:
            points = clean(json.loads(text).get("points"))
        except (json.JSONDecodeError, AttributeError) as e:
            raise ExplainFailed("Claude's answer couldn't be read. Try again.") from e
        if not points:
            raise ExplainFailed("Claude didn't explain this line. Try again in a moment.")
        return points

    return explain
