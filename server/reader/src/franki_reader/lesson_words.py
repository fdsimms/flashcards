"""The words an audio lesson could mean by what the learner typed, written by Claude when they tap
Find word in Add a phrase.

A tutor's or a book's word is often written in romanization (Thai, Russian, Greek, Japanese), which
the voice would read as if it were the language's own script, or in English, or spelled by ear. So the
learner types what they have, Claude lists the words in the language it could be, and the learner
picks the one they mean: the picked word, in the language's own script, is what the lesson speaks,
and its meaning comes with it. Asked only on that tap, once. Nothing here reads or writes the
collection or grades a card.
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
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lesson import MAX_CHARS

MAX_TOKENS = 1500
MAX_CANDIDATES = 5

# What a word of each language is written with. A candidate whose text has none of it is dropped, and
# in a language not written in Latin letters one with a Latin letter is too: that is the romanization
# handed back as the word.
SCRIPTS: dict[str, re.Pattern[str]] = {
    "th": re.compile("[\u0e01-\u0e3a\u0e40-\u0e4e]"),
    "ru": re.compile("[\u0400-\u04ff]"),
    "el": re.compile("[\u0370-\u03ff\u1f00-\u1fff]"),
    "ja": re.compile("[\u3040-\u30ff\u4e00-\u9fff]"),
}
LATIN_LETTER = re.compile("[A-Za-z\u00c0-\u024f]")
ASCII_LETTER = re.compile("[A-Za-z]")

# How a language's `reading` is written, for the ones where a word's spelling doesn't show how it
# sounds. Left out, the reading is empty.
READINGS = {
    "th": "the romanization with tone marks (for example mâi, máai)",
    "ru": "the romanization with the stressed vowel marked (for example хорошо́ as khoroshó)",
    "el": "the romanization (for example ευχαριστώ as efcharistó)",
    "ja": "the reading in hiragana",
}


def is_written(text: str, language: Code) -> bool:
    """Whether `text` is written the way `language` is: in its own script, and for Thai, Russian,
    Greek and Japanese with no Latin letter (that is romanization handed back as the text); in a
    Latin-script language, with a Latin letter."""
    script = SCRIPTS.get(language)
    if script:
        return script.search(text) is not None and ASCII_LETTER.search(text) is None
    return LATIN_LETTER.search(text) is not None


SYSTEM = """\
A learner of {language} typed a word or phrase to be taught in an audio lesson. It may be in \
{language} spelled correctly or by ear, romanization (any scheme, tones and accents often missing), \
or English. List the {language} words or phrases it could be, most likely first, so the learner can \
pick the one they mean. For each: text, written the way {language} is written (never romanization, \
never English); reading, {reading}; english, the meaning in a few plain words. Give different \
words, not spellings of one word. Words that are written differently but sound alike, or differ \
only in tone or accent, are separate candidates, each with its own meaning. Prefer common everyday \
words, and never invent a word: when nothing real fits, return no candidates. If the input is \
already a {language} word, return it first (with its spelling corrected if it was a typo), and add \
others only when it could mean more than one. Do not add or drop a polite ending or article the \
learner did not type. At most five candidates. Write the english in American English, without em \
dashes."""

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


# The candidates for what was typed in a language, and what asking cost.
FindWords = Callable[[Code, str], Awaitable[tuple[list[Candidate], Usage]]]


def clean(answer: dict[str, Any], language: Code) -> list[Candidate]:
    """The candidates the app may offer: written in the language's own script (a Latin letter in a
    Thai, Russian, Greek or Japanese one means Claude handed the romanization back), each word once,
    each with a meaning, none too long to send as a lesson phrase. One that doesn't pass is dropped,
    not repaired."""
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
        if not is_written(text, language) or text in seen:
            continue
        seen.add(text)
        out.append(Candidate(text, reading[:MAX_CHARS], english))
    return out[:MAX_CANDIDATES]


def claude_find_words(client: anthropic.AsyncAnthropic) -> FindWords:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def find(language: Code, typed: str) -> tuple[list[Candidate], Usage]:
        system = SYSTEM.format(
            language=LANGUAGES[language].name,
            reading=READINGS.get(language, "left empty (the spelling already shows the sound)"),
        )
        messages = [{"role": "user", "content": f"Typed by the learner: {typed}"}]
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
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
        return clean(answer, language), used

    return find
