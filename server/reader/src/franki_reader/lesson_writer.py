"""Claude's part of an audio lesson (lesson.py): the content, and only the content. It's asked for a
short dialogue and a few phrases to teach, each split into parts; how the lesson runs is code.

Generate, then verify: `lesson.clean_plan` keeps only phrases whose parts put back together are the
phrase, and a plan with fewer than `lesson.MIN_PHRASES` of them is asked for again, once, with the
reason. The second answer is kept or the lesson isn't made.
"""

import json
from collections.abc import Awaitable, Callable
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader import lesson
from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

MAX_TOKENS = 4000
MAX_ATTEMPTS = 2
MAX_SCENE = 200
# How many unknown words a retry names.
MAX_NAMED_WORDS = 12

_REQUEST = """\
Write the content of a short spoken {language} lesson for a beginner, set in this situation:
{scene}

It will be recorded as audio: an English narrator and native {language} voices, with pauses for the
learner to say each phrase aloud. You choose what is taught; the lesson's structure is built from
what you give. Give:

- title: a short English title for the lesson (two to five words)
- dialogue: {low} to {high} lines of natural, spoken conversation in {language} in that situation,
  between A (a man) and B (a woman). Each line: speaker (A or B), text ({language}), english. The
  phrases below should come up in it. The learner hears it first and acts it out last, so build it
  from the phrases taught and very basic everyday words, with no rarer vocabulary.
- phrases: {few} to {many} phrases the learner will practice saying, simplest first, each one
  something a person would really say in that situation. Each: text ({language}), english (what it
  means, in natural English), and parts.
- mixes: {mixes} new {language} sentences the learner has never heard whole, made only of words that
  appear in the phrases above (a word may be reused, none may be new), for example the first piece
  of one phrase with the last piece of another. Each: text and english.

Rules for the phrases:
- 2 to 8 words each, and not a lone "Yes." or "Thanks."
- `parts` are the phrase split in order into 1 to {parts} pieces at natural breaks, so that the
  learner can build it up from its end (the last piece first). Put back together, the parts must be
  the phrase exactly: the same words in the same order, nothing added or left out. A short phrase
  can be one part.
- Polite, everyday register (use the formal "you" where the language has one), unless the situation
  is between friends.
- The learner may be a man or a woman, so use no form that changes with the speaker's gender.
- The phrases are a ladder, in the order they come up in the dialogue: each one reuses words or a
  piece from an earlier phrase (a word, a verb, a polite ending) and adds only one or two new
  things, so the lesson builds on itself instead of teaching separate phrases.

Plain text only: no `|`, asterisks, tildes or em dashes.{note}"""

# What a language needs said beyond the rest of the request.
_NOTES: dict[Code, str] = {
    "th": (
        "\n\nThai: write Thai script only, with spaces only between clauses, never between words, and"
        " cut `parts` where a person would pause. Thai's polite particles depend on the speaker's"
        " gender, so leave ครับ and ค่ะ out of the phrases taught; in the dialogue, A (a man) ends"
        " polite lines with ครับ and B (a woman) with ค่ะ."
    )
}

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "dialogue": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "speaker": {"type": "string", "enum": ["A", "B"]},
                    "text": {"type": "string"},
                    "english": {"type": "string"},
                },
                "required": ["speaker", "text", "english"],
                "additionalProperties": False,
            },
        },
        "mixes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"text": {"type": "string"}, "english": {"type": "string"}},
                "required": ["text", "english"],
                "additionalProperties": False,
            },
        },
        "phrases": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "english": {"type": "string"},
                    "parts": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "english", "parts"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "dialogue", "phrases", "mixes"],
    "additionalProperties": False,
}


class LessonFailed(Exception):
    """A lesson couldn't be written; the message is shown as it is. `usage` is what the calls were
    billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Asks Claude for a lesson's content: the language, the scene, and what to say about the last
# attempt (empty the first time). Returns Claude's raw answer and what the call cost.
WritePlan = Callable[[Code, str, str], Awaitable[tuple[Any, Usage]]]

_RETRY = (
    "That answer had fewer than {n} usable phrases. A phrase is dropped when its parts, put back"
    " together, aren't the phrase exactly, or it is repeated. Write the lesson again."
)

_RETRY_WORDS = (
    "The learner doesn't know these words from the dialogue: {words}. The dialogue is played first and"
    " acted out last, so it may use only the phrases taught and very basic everyday words. Write the"
    " lesson again with simpler dialogue lines, replacing those words or teaching them in a phrase."
)


def request_message(language: Code, scene: str) -> str:
    return _REQUEST.format(
        language=LANGUAGES[language].name,
        scene=scene,
        low=4,
        high=lesson.MAX_DIALOGUE,
        few=lesson.MIN_PHRASES,
        many=lesson.MAX_PHRASES,
        mixes=lesson.MAX_MIXES,
        parts=lesson.MAX_PARTS,
        note=_NOTES.get(language, ""),
    )


async def write_plan(
    write: WritePlan, language: Code, scene: str, lexicon: Checker | None = None
) -> tuple[lesson.Plan, Usage]:
    """The plan for a lesson on `scene`, asked for up to `MAX_ATTEMPTS` times; what the calls cost
    comes back with it, or on the failure. With the learner's `lexicon`, a dialogue with words
    they don't know (`lesson.unfamiliar_words`) is asked for again naming them; when no attempt gets
    clear of them, the usable plan with the fewest is kept rather than no lesson."""
    used = Usage()
    feedback = ""
    closest: tuple[int, lesson.Plan] | None = None
    for _ in range(MAX_ATTEMPTS):
        try:
            raw, spent = await write(language, scene, feedback)
        except LessonFailed as e:
            raise LessonFailed(str(e), used + e.usage) from e
        used = used + spent
        plan = lesson.clean_plan(raw, scene)
        if plan is None:
            feedback = _RETRY.format(n=lesson.MIN_PHRASES)
            continue
        strangers = lesson.unfamiliar_words(plan, lexicon) if lexicon is not None else []
        if not strangers:
            return plan, used
        if closest is None or len(strangers) < closest[0]:
            closest = (len(strangers), plan)
        feedback = _RETRY_WORDS.format(words=", ".join(strangers[:MAX_NAMED_WORDS]))
    if closest is not None:
        return closest[1], used
    raise LessonFailed("Claude didn't write a usable lesson. Try again.", used)


def claude_plan(client: anthropic.AsyncAnthropic) -> WritePlan:
    async def write(language: Code, scene: str, feedback: str) -> tuple[Any, Usage]:
        messages: list[dict[str, Any]] = [
            {"role": "user", "content": request_message(language, scene)}
        ]
        if feedback:
            messages.append({"role": "user", "content": feedback})
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
            raise LessonFailed(didnt_answer(e, ". Try again in a moment.")) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise LessonFailed("Claude didn't answer. Try again in a moment.", used)
        try:
            return json.loads(text), used
        except json.JSONDecodeError as e:
            raise LessonFailed("Claude's answer couldn't be read. Try again.", used) from e

    return write
