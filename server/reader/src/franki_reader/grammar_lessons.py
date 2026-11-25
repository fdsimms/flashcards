"""A grammar point's lesson (docs/read-and-listen/architecture.md, Grammar, "Lesson"): what meets the
owner when a point starts being practiced, opened from the shelf's rotation card or the point's
page. The explanation is the catalog's; Claude writes the example lines, once a point, from the
known words, and they're kept.

Generate, then verify: an example is kept only if it passes Your topics' checks (no markup, its
`words` in the line in order, at most `grammar_topics.MAX_UNKNOWN` unknown words), the point's own
finder finds the point in it, and in Thai it fits the woman's voice that reads it
(`gender.thai_fits`). Fewer than `MIN_EXAMPLES` left fails the write, with a note to show.

Nothing here schedules or grades a card: the lesson is read and listened to, and its practice
questions are the drills'.
"""

import json
import logging
import sqlite3
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any, Final, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam, BetaTextBlockParam

from franki_reader import grammar, grammar_topics, store
from franki_reader.claude_errors import spend_limit_message
from franki_reader.coverage import Checker, is_word, parse_line
from franki_reader.gender import thai_fits
from franki_reader.generator import MODEL, Usage, system_prompt, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry

log = logging.getLogger(__name__)

EXAMPLES = 4  # shown
ASKED = 6  # asked for, so a few can fail the checks
MIN_EXAMPLES = 3
MAX_TOKENS = 4000
# The voice the examples are read in: Thai lines are checked to fit it.
VOICE_GENDER: Final = "female"

TOO_FEW = "Couldn't write enough examples from words you know. Try again."
FAILED = "Couldn't write this lesson. Try again."

_REQUEST = """\
Write {count} short, natural {language} sentences of 4 to 10 words that use this grammar point, \
for a learner meeting it for the first time: {name} ({note}, e.g. {example}).

How the point works:
{explanation}

Use only words from the list above, and make each sentence show the point plainly, in a different \
everyday situation from the others.{voice} Give each its `line`, its `english`, and `words`: the \
part or parts of `line` that are the point, copied exactly from it and in the order they appear.

Plain text only: no `|`, no tildes, no asterisks and no em dashes. Use American English for the \
English."""

_THAI_VOICE = (
    " Each sentence is read aloud in a woman's voice, so where one needs a polite ending or a word "
    "for I, use ค่ะ, คะ and ฉัน, never ครับ or ผม."
)

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "examples": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "line": {"type": "string"},
                    "english": {"type": "string"},
                    "words": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["line", "english", "words"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["examples"],
    "additionalProperties": False,
}


class LessonFailed(Exception):
    """Claude couldn't write; the message is shown as it is. `usage` is what a failed call that
    Claude answered was billed for."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Writes a point's examples as raw JSON ({examples}), and what it cost.
WriteLesson = Callable[[list[Entry], grammar.Point], Awaitable[tuple[dict[str, Any], Usage]]]


def request_message(point: grammar.Point) -> str:
    return _REQUEST.format(
        count=ASKED,
        language=LANGUAGES[point.language].name,
        name=point.name,
        note=point.note,
        example=point.example,
        explanation=point.explanation,
        voice=_THAI_VOICE if point.language == "th" else "",
    )


def check_examples(raw: object, checker: Checker, point: grammar.Point) -> list[dict[str, Any]]:
    """The examples that pass (see the module's docstring), at most `EXAMPLES`."""
    out: list[dict[str, Any]] = []
    for kept in grammar_topics.check_examples(raw, checker):
        if not grammar.find_in_lines([kept["line"]], checker, (point.id,))[point.id]:
            continue
        if point.language == "th":
            plain, _ = parse_line(kept["line"], checker.spaced)
            words = [t for t in checker.segment(plain) if is_word(t)]
            if not thai_fits(words, VOICE_GENDER):
                continue
        out.append(kept)
    return out[:EXAMPLES]


async def write_lesson(
    conn: sqlite3.Connection,
    snapshot: Callable[[Code], tuple[list[Entry], Checker]],
    write: WriteLesson,
    point_id: str,
    now: datetime,
) -> None:
    """Writes a point's examples and keeps them; the caller has marked the lesson writing. Never
    raises: a failure is kept on the lesson, with what to tell the owner."""
    point = grammar.POINTS.get(point_id)
    if point is None:
        store.fail_grammar_lesson(conn, point_id, FAILED)
        return
    cost = 0.0
    try:
        entries, checker = snapshot(point.language)
        try:
            raw, used = await write(entries, point)
        except LessonFailed as e:
            cost = e.usage.cost_usd()
            log.warning("Couldn't write the lesson on %s: %s", point_id, e)
            store.fail_grammar_lesson(conn, point_id, str(e))
            return
        cost = used.cost_usd()
        examples = check_examples(raw.get("examples"), checker, point)
        if len(examples) < MIN_EXAMPLES:
            store.fail_grammar_lesson(conn, point_id, TOO_FEW)
            return
        store.save_grammar_lesson(conn, point_id, examples)
    except Exception:
        # A background task: the lesson must not be left writing.
        log.exception("Writing the lesson on %s failed", point_id)
        store.fail_grammar_lesson(conn, point_id, FAILED)
    finally:
        store.save_call_cost(conn, "grammar_lessons", point.language if point else "", now, cost)


def claude_lessons(client: anthropic.AsyncAnthropic) -> WriteLesson:
    output: BetaOutputConfigParam = {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(entries: list[Entry], point: grammar.Point) -> tuple[dict[str, Any], Usage]:
        # The texts' own word list, cached, as the drills and Your topics use it.
        system: list[BetaTextBlockParam] = [
            {
                "type": "text",
                "text": system_prompt(entries, point.language),
                "cache_control": {"type": "ephemeral"},
            }
        ]
        messages = [{"role": "user", "content": request_message(point)}]
        try:
            response = await client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=cast(list[BetaMessageParam], messages),
                output_config=output,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            raise LessonFailed(
                spend_limit_message(e) or "Claude didn't answer. Try again in a moment."
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise LessonFailed(FAILED, used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise LessonFailed(FAILED, used) from e
        if not isinstance(answer, dict):
            raise LessonFailed(FAILED, used)
        return answer, used

    return write
