"""Thai words an audio lesson could mean by what the learner typed, written by Claude when they tap
Find Thai in Add a phrase.

A tutor's or a book's word is often written in romanization, which the Thai voice would read as if it
were Thai script. So the learner types what they have (romanization, Thai or English), Claude lists
the Thai words it could be, and the learner picks the one they mean: the picked Thai script is what
the lesson speaks. Asked only on that tap, once. Nothing here reads or writes the collection or
grades a card.
"""

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.lesson import MAX_CHARS

MAX_TOKENS = 1500
MAX_CANDIDATES = 5
# The languages a typed word is looked up in: where romanization is how a word is often written down.
LOOKUP_LANGUAGES = ("th",)

THAI_LETTER = re.compile("[ก-ฺเ-๎]")
LATIN_LETTER = re.compile("[A-Za-z]")

SYSTEM = """\
A learner of Thai typed a word or phrase to be taught in an audio lesson. It may be romanization \
(any scheme, spelled by ear, tones usually missing), Thai script, or English. List the Thai words or \
phrases it could be, most likely first, so the learner can pick the one they mean. For each: text, \
in Thai script only; reading, the romanization with tone marks (for example mâi, máai) that a \
learner can check the pronunciation against; english, the meaning in a few plain words. Give \
different words, not spellings of one word. Words that are written differently but sound alike, or \
differ only in tone, are separate candidates, each with its own meaning. Prefer common everyday \
words, and never invent a word: when nothing real fits, return no candidates. If the input is \
already Thai script, return that word first (with its spelling corrected if it was a typo), and add \
others only when it could mean more than one. Do not add a polite particle (ครับ, ค่ะ) the learner \
did not type. At most five candidates. Write the english in American English, without em dashes."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "reading": {"type": "string"},
                    "english": {"type": "string"},
                },
                "required": ["text", "reading", "english"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["candidates"],
    "additionalProperties": False,
}


class LessonWordsFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class Candidate:
    # Thai script, the text the lesson speaks.
    text: str
    # Its romanization with tone marks, to show beside it.
    reading: str
    english: str


# The candidates for what was typed, and what asking cost.
FindWords = Callable[[str], Awaitable[tuple[list[Candidate], Usage]]]


def clean(answer: dict[str, Any]) -> list[Candidate]:
    """The candidates the app may offer: Thai script only in `text` (a Latin letter means Claude
    handed the romanization back), each word once, each with a meaning, none too long to send as a
    lesson phrase. One that doesn't pass is dropped, not repaired."""
    out: list[Candidate] = []
    seen: set[str] = set()
    raw = answer.get("candidates")
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        text, reading, english = (
            " ".join(str(item.get(k) or "").split()) for k in ("text", "reading", "english")
        )
        if not text or not english or len(text) > MAX_CHARS or len(english) > MAX_CHARS:
            continue
        if not THAI_LETTER.search(text) or LATIN_LETTER.search(text) or text in seen:
            continue
        seen.add(text)
        out.append(Candidate(text, reading[:MAX_CHARS], english))
    return out[:MAX_CANDIDATES]


def claude_find_words(client: anthropic.AsyncAnthropic) -> FindWords:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def find(typed: str) -> tuple[list[Candidate], Usage]:
        messages = [{"role": "user", "content": f"Typed by the learner: {typed}"}]
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM,
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            raise LessonWordsFailed(
                didnt_answer(e, ". Try again in a moment.", doing="look up that word")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise LessonWordsFailed("Claude didn't find a word. Try again in a moment.", used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise LessonWordsFailed("Claude's answer couldn't be read. Try again.", used) from e
        if not isinstance(answer, dict):
            raise LessonWordsFailed("Claude's answer couldn't be read. Try again.", used)
        return clean(answer), used

    return find
