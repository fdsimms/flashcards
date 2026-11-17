"""A line's grammar and vocabulary explained in English, when the owner taps Explain on it, a
phrase the owner selected in a line, when they select one, why a word has the form it has in the
form quiz, and whether a line sounds natural, when they ask.

Asked only on that tap, once per line, phrase or word (the answer is kept in `explanations`,
`phrase_explanations`, `form_explanations` and `naturalness`), never ahead of time. Reading and listening still never
grade or write cards: this only shows text.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import CHEAP_MODEL, REGISTERS, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

log = logging.getLogger(__name__)

MAX_POINTS = 6
MAX_TOKENS = 1500
MAX_CHARS = 400

# You can't measure how common a phrase is, and a confident "common" is the claim most likely to be
# wrong, so both prompts keep frequency, naturalness and register to what the model is sure of.
CALIBRATION = (
    " Call something common, natural, neutral or formal only when you are confident native "
    "speakers use it that way. If you are not, explain how it works and say nothing about how "
    "common it is or what register it has. Never say a phrase is common just because it is "
    "grammatical."
)

# The notes are read by an English speaker learning the language, and a model asked about a line in
# the language tends to answer in it, so every prompt says so outright.
ENGLISH = (
    " Write every explanation in English, never in the language of the line, even when the line "
    "and the whole text are in another language. Only the part of the line you quote, and short "
    "examples in the language, stay in it."
)

# For a learner who asked to read the notes in the language itself (Settings, Read & Listen): the
# notes are in it, in simple words, while the English renderings stay English.
IN_LANGUAGE = (
    " Write each `note` in the language of the line, in simple words and short sentences a "
    "learner can follow, never in English. Keep every English rendering in English."
)


def in_language(system: str) -> str:
    """`system` with its English-only instructions swapped for IN_LANGUAGE."""
    return system.replace(", in plain English", "").replace(ENGLISH, IN_LANGUAGE)


SYSTEM = (
    "You explain one line of a short text to an adult learner of the language, in plain English. "
    "Say what the learner is most likely to be unsure of: grammar (tense, mood, agreement, word "
    "order, particles, reflexive or separable verbs), a phrase that isn't word for word, an idiom "
    "or register. Skip words and structures a learner at this level would already know. "
    f"Give at most {MAX_POINTS} points, most useful first, each naming the part of the line "
    "(`phrase`, copied exactly from the line) and what to know about it (`note`, one to three "
    f"short sentences, under {MAX_CHARS} characters). Give a literal translation only when it "
    "shows how the phrase works. Do not use em dashes. Do not repeat the whole line's translation: "
    "the learner can already see it. The whole text is there only so you can see what the line "
    "refers to. Use it only when it changes or sharpens a point (what a pronoun points to, what a "
    "reply answers, the speaker's tone); never retell or summarize the text."
    + ENGLISH
    + CALIBRATION
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
    "dictionary senses. It translates only the selected words: add no clause, detail or "
    "explanation that the phrase doesn't say, and never describe the situation, who is doing "
    "what to whom, or why. Context may only decide which English word renders a pronoun or an "
    "omitted subject. Give `literal`: a word-for-word English rendering that keeps the "
    "phrase's own word order and structure, even where that sounds odd in English (leave out "
    "articles the language doesn't have). Give an empty string when it would read the same as "
    f"`meaning`. Give `register`: how formal the phrase is when a native speaker says it, one of "
    f"{', '.join(REGISTERS)}, or an empty string when you are not confident. Give `register_note`: "
    "one short sentence on where it fits (with friends, in writing, in a polite request), or an "
    f"empty string when `register` is empty. Then at most {MAX_POINTS - 2} points (`points`), most useful first, each "
    "naming part of the phrase (`phrase`, copied exactly from it) and what to know about it "
    f"(`note`, one to three short sentences, under {MAX_CHARS} characters): whether it is a set "
    "expression or idiom and how it is used, how its words work together where that isn't word "
    "for word, and its tone when that matters. If the selection is part of a longer "
    "set expression in the line, name the whole expression. If it isn't a set phrase, say so "
    "briefly and explain how the words combine. Give a literal translation only when it shows "
    "how the phrase works. The whole text is there only so you can see what the phrase refers to. "
    'Use it only when it changes or sharpens the meaning (what a pronoun or "one thing" points '
    "to, what a reply answers, the speaker's tone). If the phrase can be explained from its own "
    "line, say nothing about the rest of the text, and never retell or summarize it. "
    "Do not use em dashes." + ENGLISH + CALIBRATION
)

PHRASE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "meaning": {"type": "string"},
        "literal": {"type": "string"},
        "register": {"type": "string", "enum": [*REGISTERS, ""]},
        "register_note": {"type": "string"},
        "points": SCHEMA["properties"]["points"],
    },
    "required": ["meaning", "literal", "register", "register_note", "points"],
    "additionalProperties": False,
}


MAX_FORM_PARAGRAPHS = 3

FORM_SYSTEM = (
    "The learner is practicing word forms: a word of a line was hidden, they were shown its "
    "dictionary form and asked to type the form that fits, and they want to know why the line "
    "has the form it has. Explain for an adult learner of the language, in plain English. Give "
    "`explanation`: one to three short paragraphs (each under "
    f"{MAX_CHARS} characters). Say which word of the line decides the form (a verb that takes a "
    "case, a preposition, an auxiliary, the subject it agrees with) and what that does to the "
    "word. If the word's form is irregular (a stem change, a moved stress, an ending that is "
    "not the usual one for its kind), say so and give the few forms that show the pattern. If a "
    "learner would likely confuse it with a nearby form, say how to tell them apart in this line. "
    "The form's name is given; trust it. Skip anything the learner would already know at this "
    "level, and do not retell the line's translation. The whole text is there only so you can "
    "see what the line refers to. Do not use em dashes." + CALIBRATION
)

FORM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"explanation": {"type": "array", "items": {"type": "string"}}},
    "required": ["explanation"],
    "additionalProperties": False,
}

VERDICTS = ("natural", "stiff", "unusual")

CHECK_SYSTEM = (
    "You are a native speaker of the language, reviewing one line of a short text written for "
    "learners. Judge whether a native speaker would actually say or write this line in this "
    "situation, given who is speaking and the whole text, which is there so you can judge whether the line fits what came before it. Answer with `verdict`: "
    '"natural" (a native speaker would say it), "stiff" (correct, but too formal, too literal or '
    'too written for this situation) or "unusual" (grammatical, but a native speaker would '
    "hardly say it this way). Give `reason`, one or two short plain English sentences naming "
    "what is off, or why it works when it is natural. Give `alternative`: what a native speaker "
    "would more likely say, in the language and as plain text with no markup, or an empty "
    'string when the verdict is "natural". Judge only naturalness and register, not whether the '
    "words are easy for a learner. Do not use em dashes."
)

CHECK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": list(VERDICTS)},
        "reason": {"type": "string"},
        "alternative": {"type": "string"},
    },
    "required": ["verdict", "reason", "alternative"],
    "additionalProperties": False,
}


class ExplainFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all: the caller keeps it (store.save_call_cost), since nothing goes in the cache."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class ExplainRequest:
    language: Code
    line: str  # plain text, as shown
    english: str
    # The whole text, every line in order as "Speaker: text (English)" (this line too), so a
    # pronoun or a reply makes sense. `index` is this line's place in it.
    context: tuple[str, ...] = ()
    simple: bool = False
    title: str = ""
    index: int = 0
    in_language: bool = False  # the notes in the line's language rather than English


# The points, and what asking for them cost.
Explain = Callable[[ExplainRequest], Awaitable[tuple[list[dict[str, str]], Usage]]]


@dataclass(frozen=True)
class PhraseRequest:
    language: Code
    phrase: str  # as it appears in the line
    line: str
    english: str
    # The whole text, every line in order as "Speaker: text (English)" (the selected line too),
    # so the model can see what the phrase refers to. `index` is the selected line's place in it.
    context: tuple[str, ...] = ()
    simple: bool = False
    title: str = ""
    index: int = 0
    in_language: bool = False  # the notes in the line's language rather than English


# {meaning, points}, and what asking for it cost.
ExplainPhrase = Callable[[PhraseRequest], Awaitable[tuple[dict[str, Any], Usage]]]


@dataclass(frozen=True)
class FormRequest:
    language: Code
    word: str  # as it appears in the line
    lemma: str
    form: str  # the form's name, as the app shows it ("accusative plural")
    helper: str  # the word of the line that goes with it, or ""
    line: str
    english: str
    context: tuple[str, ...] = ()
    title: str = ""
    index: int = 0


# The paragraphs of the explanation, and what asking for them cost.
ExplainForm = Callable[[FormRequest], Awaitable[tuple[list[str], Usage]]]


@dataclass(frozen=True)
class CheckRequest:
    language: Code
    line: str  # plain text, as shown
    english: str
    speaker: str = ""  # who says it, e.g. "A (Waiter)"; empty for a narrator
    register: str = ""  # what the text was written as, when it says
    # The whole text as for ExplainRequest (this line too); `index` is this line's place in it.
    context: tuple[str, ...] = ()
    title: str = ""
    index: int = 0


# {verdict, reason, alternative}, and what asking for it cost.
CheckNatural = Callable[[CheckRequest], Awaitable[tuple[dict[str, str], Usage]]]


def whole_text(context: tuple[str, ...], title: str, index: int) -> list[str]:
    """The text as numbered lines, the selected one marked, for a prompt; none without context."""
    if not context:
        return []
    out = [f"The whole text{f' ({title})' if title else ''}:"]
    out.extend(
        f"{i + 1}. {c}" + ("   <- the selected line" if i == index else "")
        for i, c in enumerate(context)
    )
    return out


def request_message(request: ExplainRequest) -> str:
    lines = [f"Language: {LANGUAGES[request.language].name}"]
    lines.extend(whole_text(request.context, request.title, request.index))
    lines.append(f"Line {request.index + 1}: {request.line}")
    lines.append(f"English: {request.english}")
    return "\n".join(lines)


def phrase_message(request: PhraseRequest) -> str:
    base = ExplainRequest(
        request.language,
        request.line,
        request.english,
        request.context,
        request.simple,
        request.title,
        request.index,
    )
    return request_message(base) + f"\nSelected phrase: {request.phrase}"


def form_message(request: FormRequest) -> str:
    base = ExplainRequest(
        request.language,
        request.line,
        request.english,
        request.context,
        False,
        request.title,
        request.index,
    )
    lines = [request_message(base), f"Word: {request.word}", f"Dictionary form: {request.lemma}"]
    lines.append(f"Its form in the line: {request.form}")
    if request.helper:
        lines.append(f"The word that goes with it: {request.helper}")
    return "\n".join(lines)


def clean_form(answer: dict[str, Any]) -> list[str]:
    """The paragraphs the model gave, trimmed, without blanks, at most MAX_FORM_PARAGRAPHS."""
    paragraphs = answer.get("explanation")
    if not isinstance(paragraphs, list):
        return []
    out = [p.strip()[:MAX_CHARS] for p in paragraphs if isinstance(p, str) and p.strip()]
    return out[:MAX_FORM_PARAGRAPHS]


def check_message(request: CheckRequest) -> str:
    lines = [f"Language: {LANGUAGES[request.language].name}"]
    lines.extend(whole_text(request.context, request.title, request.index))
    lines.append(f"Line {request.index + 1}: {request.line}")
    if request.speaker:
        lines.append(f"Spoken by: {request.speaker}")
    if request.register:
        lines.append(f"The text was written as: {request.register}")
    lines.append(f"English: {request.english}")
    return "\n".join(lines)


def clean_check(answer: dict[str, Any]) -> dict[str, str] | None:
    """The verdict, reason and alternative the model gave, trimmed; None without a verdict from
    the list or a reason. A natural line has no alternative."""
    verdict, reason, alternative = (answer.get(k) for k in ("verdict", "reason", "alternative"))
    if verdict not in VERDICTS or not isinstance(reason, str) or not reason.strip():
        return None
    alt = alternative.strip()[:MAX_CHARS] if isinstance(alternative, str) else ""
    return {
        "verdict": verdict,
        "reason": reason.strip()[:MAX_CHARS],
        "alternative": "" if verdict == "natural" else alt,
    }


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
            model=CHEAP_MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=cast(list[BetaMessageParam], messages),
            output_config=output_config,
        )
    except anthropic.APIError as e:
        # The person sees only the class name; the API's own message (what a 400 objected to)
        # is what says why, so it goes in the server log.
        log.warning("Claude couldn't explain %s: %s: %s", what, type(e).__name__, e)
        raise ExplainFailed(didnt_answer(e, ". Try again in a moment.")) from e
    used = usage_of(response)
    text = next((b.text for b in response.content if b.type == "text"), None)
    if response.stop_reason in ("refusal", "max_tokens") or text is None:
        raise ExplainFailed(f"Claude didn't explain {what}. Try again in a moment.", used)
    try:
        answer = json.loads(text)
    except json.JSONDecodeError as e:
        raise ExplainFailed("Claude's answer couldn't be read. Try again.", used) from e
    if not isinstance(answer, dict):
        raise ExplainFailed("Claude's answer couldn't be read. Try again.", used)
    return answer, used


def claude_explain(client: anthropic.AsyncAnthropic) -> Explain:
    async def explain(request: ExplainRequest) -> tuple[list[dict[str, str]], Usage]:
        system = SYSTEM + (SIMPLE if request.simple else "")
        if request.in_language:
            system = in_language(system)
        answer, used = await _ask(client, system, request_message(request), SCHEMA, "this line")
        points = clean(answer.get("points"))
        if not points:
            raise ExplainFailed("Claude didn't explain this line. Try again in a moment.", used)
        return points, used

    return explain


def claude_check(client: anthropic.AsyncAnthropic) -> CheckNatural:
    async def check(request: CheckRequest) -> tuple[dict[str, str], Usage]:
        answer, used = await _ask(
            client, CHECK_SYSTEM, check_message(request), CHECK_SCHEMA, "this line"
        )
        cleaned = clean_check(answer)
        if cleaned is None:
            raise ExplainFailed("Claude didn't check this line. Try again in a moment.", used)
        return cleaned, used

    return check


def clean_phrase(answer: dict[str, Any]) -> dict[str, Any] | None:
    """The meaning, literal rendering, register and points the model gave, trimmed; None without a
    meaning. The register is "" unless it is one of REGISTERS. The literal is "" when it was left out or only repeats the meaning, so the app shows it only
    when it adds something."""
    meaning = answer.get("meaning")
    if not isinstance(meaning, str) or not meaning.strip():
        return None
    meaning = meaning.strip()[:MAX_CHARS]
    literal = answer.get("literal")
    literal = literal.strip()[:MAX_CHARS] if isinstance(literal, str) else ""

    def same(a: str) -> str:
        return "".join(ch for ch in a.casefold() if ch.isalnum())

    if same(literal) == same(meaning):
        literal = ""
    register = answer.get("register")
    register = register if register in REGISTERS else ""
    note = answer.get("register_note")
    # A reason without a register has nothing to explain, so it isn't kept.
    note = note.strip()[:MAX_CHARS] if register and isinstance(note, str) else ""
    return {
        "meaning": meaning,
        "literal": literal,
        "register": register,
        "register_note": note,
        "points": clean(answer.get("points")),
    }


def claude_explain_phrase(client: anthropic.AsyncAnthropic) -> ExplainPhrase:
    async def explain(request: PhraseRequest) -> tuple[dict[str, Any], Usage]:
        system = PHRASE_SYSTEM + (SIMPLE if request.simple else "")
        if request.in_language:
            system = in_language(system)
        answer, used = await _ask(
            client, system, phrase_message(request), PHRASE_SCHEMA, "this phrase"
        )
        cleaned = clean_phrase(answer)
        if cleaned is None:
            raise ExplainFailed("Claude didn't explain this phrase. Try again in a moment.", used)
        return cleaned, used

    return explain


def claude_explain_form(client: anthropic.AsyncAnthropic) -> ExplainForm:
    async def explain(request: FormRequest) -> tuple[list[str], Usage]:
        answer, used = await _ask(
            client, FORM_SYSTEM, form_message(request), FORM_SCHEMA, "this form"
        )
        paragraphs = clean_form(answer)
        if not paragraphs:
            raise ExplainFailed("Claude didn't explain this form. Try again in a moment.", used)
        return paragraphs, used

    return explain
