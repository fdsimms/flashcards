"""Checking what the owner wrote in the language (docs/read-and-listen/architecture.md, Using the
language): a sentence with a word just learned (the app's Use today's words), their own way of
saying a Sentences prompt (Check mine), and their retelling of a text just read (Retell it).

Asked only on the owner's tap, one call each, never ahead of time, and the answer isn't kept: what
it cost goes in `call_costs` as "production". Nothing here grades a card. The app shows the answer;
the owner marks a sentence Missed it or Got it themselves, or nothing at all.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

MAX_TOKENS = 2000
MAX_ATTEMPT = 1200  # characters of the owner's writing sent
MAX_CHARS = 400  # a note
MAX_NOTES = 3
MAX_RETELL_NOTES = 4
MAX_WORDS = 4  # words from the text a retelling could have used

VERDICTS = ("right", "almost", "wrong")
Verdict = Literal["right", "almost", "wrong"]
Kind = Literal["sentence", "translate"]

_JUDGE = (
    'Give `verdict`: "right" (correct, and something a native speaker would say), "almost" '
    "(one or two small slips: an ending, an article, a case, word order, a tone or accent mark) or "
    '"wrong" (it doesn\'t make sense, says something else, or has more than two mistakes). Give '
    "`corrected`: the learner's own writing with only the mistakes fixed, keeping their words and "
    "meaning wherever they work; exactly their writing when it is right. Write it as plain text in "
    "the language, with no markup. Give `english`: what `corrected` means, in English. Give "
    f"`notes`: at most {MAX_NOTES} short notes in plain English, each naming one thing that changed "
    f"and why (under {MAX_CHARS} characters, the language's words written as they are), most "
    "important first; for a right answer, one note at most, only when a different wording is "
    "clearly more usual. Never mark the learner down for wording that differs from what you would "
    "have written, as long as it is correct and natural. Do not use em dashes."
)

SENTENCE_SYSTEM = (
    "You are a native-speaker tutor. The learner just learned a word and wrote a sentence of their "
    "own with it, in the language. Judge the sentence, and whether the word is used with its right "
    "meaning (any form of it counts). Give `used_word`: false when the sentence doesn't use the "
    "word or a form of it at all. " + _JUDGE
)

TRANSLATE_SYSTEM = (
    "You are a native-speaker tutor. The learner was asked to say an English sentence in the "
    "language, and wrote their version. A version written for the exercise is given; theirs is "
    "right if it is correct and natural, however different from that one. Give `used_word`: "
    "always true. " + _JUDGE
)

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": list(VERDICTS)},
        "corrected": {"type": "string"},
        "english": {"type": "string"},
        "notes": {"type": "array", "items": {"type": "string"}},
        "used_word": {"type": "boolean"},
    },
    "required": ["verdict", "corrected", "english", "notes", "used_word"],
    "additionalProperties": False,
}

RETELL_SYSTEM = (
    "You are a native-speaker tutor. The learner read a short text in the language and retold it in "
    "a few sentences of their own, in the language. The text is given, line by line with its "
    "English. " + _JUDGE.replace("one or two small slips", "a few small slips") + " Then give "
    f"`words`: up to {MAX_WORDS} words or short phrases from the text that the learner could have "
    "used in their retelling and didn't, each copied exactly as it appears in the text (`word`) with "
    "its English (`english`), most useful first. Give `left_out`: one short English sentence on the "
    "most important thing the retelling leaves out or gets wrong about what happens, or an empty "
    "string when it covers the story."
)

RETELL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": list(VERDICTS)},
        "corrected": {"type": "string"},
        "english": {"type": "string"},
        "notes": {"type": "array", "items": {"type": "string"}},
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"word": {"type": "string"}, "english": {"type": "string"}},
                "required": ["word", "english"],
                "additionalProperties": False,
            },
        },
        "left_out": {"type": "string"},
    },
    "required": ["verdict", "corrected", "english", "notes", "words", "left_out"],
    "additionalProperties": False,
}


class ProductionFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all: the caller keeps it (store.save_call_cost)."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class AttemptRequest:
    language: Code
    kind: Kind
    attempt: str
    word: str = ""  # sentence: the word to use
    meaning: str = ""  # sentence: what it means
    english: str = ""  # translate: the English the learner was asked to say
    reference: str = ""  # translate: the sentence written for it


@dataclass(frozen=True)
class RetellRequest:
    language: Code
    attempt: str
    lines: tuple[tuple[str, str], ...]  # each line's plain text and its English


# The checked answer, and what asking for it cost.
CheckAttempt = Callable[[AttemptRequest], Awaitable[tuple[dict[str, Any], Usage]]]
CheckRetell = Callable[[RetellRequest], Awaitable[tuple[dict[str, Any], Usage]]]


def attempt_message(request: AttemptRequest) -> str:
    lines = [f"Language: {LANGUAGES[request.language].name}"]
    if request.kind == "sentence":
        lines.append(f"The word: {request.word} ({request.meaning})")
    else:
        lines.append(f"Asked to say: {request.english}")
        lines.append(f"Written for the exercise: {request.reference}")
    lines.append(f"The learner wrote: {request.attempt[:MAX_ATTEMPT]}")
    return "\n".join(lines)


def retell_message(request: RetellRequest) -> str:
    lines = [f"Language: {LANGUAGES[request.language].name}", "The text:"]
    lines.extend(f"- {text} ({english})" for text, english in request.lines)
    lines.append(f"The learner's retelling: {request.attempt[:MAX_ATTEMPT]}")
    return "\n".join(lines)


def _notes(raw: object, most: int) -> list[str]:
    if not isinstance(raw, list):
        return []
    out = [n.strip()[:MAX_CHARS] for n in raw if isinstance(n, str) and n.strip()]
    return out[:most]


def _judged(answer: dict[str, Any], attempt: str, most: int) -> dict[str, Any] | None:
    """The verdict, corrected writing, its English and notes, trimmed; None without a verdict from
    the list. A right answer's corrected writing is the learner's own, whatever came back."""
    verdict = answer.get("verdict")
    corrected = answer.get("corrected")
    english = answer.get("english")
    if verdict not in VERDICTS or not isinstance(corrected, str) or not isinstance(english, str):
        return None
    fixed = attempt.strip() if verdict == "right" else corrected.strip()
    if not fixed or "—" in fixed:
        return None
    return {
        "verdict": verdict,
        "corrected": fixed,
        "english": english.strip()[:MAX_CHARS],
        "notes": _notes(answer.get("notes"), most),
    }


def clean_attempt(answer: dict[str, Any], request: AttemptRequest) -> dict[str, Any] | None:
    judged = _judged(answer, request.attempt, MAX_NOTES)
    if judged is None:
        return None
    # A sentence that doesn't use the word isn't right, however good it is otherwise.
    used = answer.get("used_word") is not False or request.kind != "sentence"
    if not used and judged["verdict"] == "right":
        judged["verdict"] = "almost"
    return {**judged, "used_word": used}


def clean_retell(answer: dict[str, Any], request: RetellRequest) -> dict[str, Any] | None:
    """As `clean_attempt`, plus the text's words the retelling could have used, each kept only if it
    is in the text as written (with the line it's in) and not already in the retelling, and what it
    left out."""
    judged = _judged(answer, request.attempt, MAX_RETELL_NOTES)
    if judged is None:
        return None
    retold = request.attempt.casefold()
    words: list[dict[str, Any]] = []
    seen: set[str] = set()
    for w in answer.get("words") or []:
        if not isinstance(w, dict):
            continue
        word, english = w.get("word"), w.get("english")
        if not isinstance(word, str) or not isinstance(english, str):
            continue
        word, english = word.strip(), english.strip()
        key = word.casefold()
        if not word or not english or key in seen or key in retold:
            continue
        line = next(
            (i for i, (text, _) in enumerate(request.lines) if key in text.casefold()), None
        )
        if line is None:
            continue
        seen.add(key)
        words.append({"word": word, "english": english[:MAX_CHARS], "line": line})
    left_out = answer.get("left_out")
    return {
        **judged,
        "words": words[:MAX_WORDS],
        "left_out": left_out.strip()[:MAX_CHARS] if isinstance(left_out, str) else "",
    }


async def _ask(
    client: anthropic.AsyncAnthropic, system: str, message: str, schema: dict[str, Any]
) -> tuple[dict[str, Any], Usage]:
    """One structured answer from Claude, or ProductionFailed."""
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
        raise ProductionFailed(
            f"Claude didn't answer ({type(e).__name__}). Try again in a moment."
        ) from e
    used = usage_of(response)
    text = next((b.text for b in response.content if b.type == "text"), None)
    if response.stop_reason in ("refusal", "max_tokens") or text is None:
        raise ProductionFailed("Claude didn't check this. Try again in a moment.", used)
    try:
        answer = json.loads(text)
    except json.JSONDecodeError as e:
        raise ProductionFailed("Claude's answer couldn't be read. Try again.", used) from e
    if not isinstance(answer, dict):
        raise ProductionFailed("Claude's answer couldn't be read. Try again.", used)
    return answer, used


def claude_attempt(client: anthropic.AsyncAnthropic) -> CheckAttempt:
    async def check(request: AttemptRequest) -> tuple[dict[str, Any], Usage]:
        system = SENTENCE_SYSTEM if request.kind == "sentence" else TRANSLATE_SYSTEM
        answer, used = await _ask(client, system, attempt_message(request), SCHEMA)
        cleaned = clean_attempt(answer, request)
        if cleaned is None:
            raise ProductionFailed("Claude didn't check this. Try again in a moment.", used)
        return cleaned, used

    return check


def claude_retell(client: anthropic.AsyncAnthropic) -> CheckRetell:
    async def check(request: RetellRequest) -> tuple[dict[str, Any], Usage]:
        answer, used = await _ask(client, RETELL_SYSTEM, retell_message(request), RETELL_SCHEMA)
        cleaned = clean_retell(answer, request)
        if cleaned is None:
            raise ProductionFailed(
                "Claude didn't check your retelling. Try again in a moment.", used
            )
        return cleaned, used

    return check
