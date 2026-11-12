"""A line's grammar and vocabulary explained in English, when the owner taps Explain on it, and a
phrase the owner selected in a line, when they select one.

Asked only on that tap, once per line or phrase (the answer is kept in `explanations` and
`phrase_explanations`), never ahead of time. Reading and listening still never grade or write
cards: this only shows text.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.generator import MODEL, Usage
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


PHRASE_SYSTEM = (
    "The learner selected a phrase in one line of a short text and wants to know what it means "
    "there. Answer for an adult learner of the language, in plain English. Give `meaning`: what "
    "the phrase means in this line, as a short natural English rendering, not a list of "
    f"dictionary senses. Then at most {MAX_POINTS - 2} points (`points`), most useful first, each "
    "naming part of the phrase (`phrase`, copied exactly from it) and what to know about it "
    f"(`note`, one to three short sentences, under {MAX_CHARS} characters): whether it is a set "
    "expression or idiom and how it is used, how its words work together where that isn't word "
    "for word, and its tone or register when that matters. If the selection is part of a longer "
    "set expression in the line, name the whole expression. If it isn't a set phrase, say so "
    "briefly and explain how the words combine. Give a literal translation only when it shows "
    "how the phrase works. Do not use em dashes."
)

PHRASE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"meaning": {"type": "string"}, "points": SCHEMA["properties"]["points"]},
    "required": ["meaning", "points"],
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


# The points, and what asking for them cost.
Explain = Callable[[ExplainRequest], Awaitable[tuple[list[dict[str, str]], Usage]]]


@dataclass(frozen=True)
class PhraseRequest:
    language: Code
    phrase: str  # as it appears in the line
    line: str
    english: str
    context: tuple[str, ...] = ()
    simple: bool = False


# {meaning, points}, and what asking for it cost.
ExplainPhrase = Callable[[PhraseRequest], Awaitable[tuple[dict[str, Any], Usage]]]


def request_message(request: ExplainRequest) -> str:
    lines = [f"Language: {LANGUAGES[request.language].name}", f"Line: {request.line}"]
    lines.append(f"English: {request.english}")
    if request.context:
        lines.append("The text around it:")
        lines.extend(f"- {c}" for c in request.context)
    return "\n".join(lines)


def phrase_message(request: PhraseRequest) -> str:
    base = ExplainRequest(
        request.language, request.line, request.english, request.context, request.simple
    )
    return f"Selected phrase: {request.phrase}\n" + request_message(base)


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


async def _ask(
    client: anthropic.AsyncAnthropic,
    system: str,
    message: str,
    schema: dict[str, Any],
    what: str,
) -> tuple[dict[str, Any], Usage]:
    """One structured answer from Claude, or ExplainFailed saying `what` it couldn't explain."""
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": schema},
    }
    messages = [{"role": "user", "content": message}]
    try:
        response = await client.beta.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
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
        raise ExplainFailed(f"Claude didn't explain {what}. Try again in a moment.")
    try:
        answer = json.loads(text)
    except json.JSONDecodeError as e:
        raise ExplainFailed("Claude's answer couldn't be read. Try again.") from e
    if not isinstance(answer, dict):
        raise ExplainFailed("Claude's answer couldn't be read. Try again.")
    u = response.usage
    used = Usage(
        u.input_tokens,
        u.output_tokens,
        u.cache_read_input_tokens or 0,
        u.cache_creation_input_tokens or 0,
        response.model,
    )
    return answer, used


def claude_explain(client: anthropic.AsyncAnthropic) -> Explain:
    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        system = SYSTEM + (SIMPLE if request.simple else "")
        answer, used = await _ask(client, system, request_message(request), SCHEMA, "this line")
        points = clean(answer.get("points"))
        if not points:
            raise ExplainFailed("Claude didn't explain this line. Try again in a moment.")
        return points, used

    return explain


def clean_phrase(answer: dict[str, Any]) -> dict[str, Any] | None:
    """The meaning and points the model gave, trimmed; None without a meaning."""
    meaning = answer.get("meaning")
    if not isinstance(meaning, str) or not meaning.strip():
        return None
    return {"meaning": meaning.strip()[:MAX_CHARS], "points": clean(answer.get("points"))}


def claude_explain_phrase(client: anthropic.AsyncAnthropic) -> ExplainPhrase:
    async def explain(request: PhraseRequest) -> tuple[dict[str, Any], Usage]:
        system = PHRASE_SYSTEM + (SIMPLE if request.simple else "")
        answer, used = await _ask(
            client, system, phrase_message(request), PHRASE_SCHEMA, "this phrase"
        )
        cleaned = clean_phrase(answer)
        if cleaned is None:
            raise ExplainFailed("Claude didn't explain this phrase. Try again in a moment.")
        return cleaned, used

    return explain
