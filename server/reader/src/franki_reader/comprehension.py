"""Questions about a text, for the check after reading (docs/read-and-listen/architecture.md, Client,
Check what you understood).

Once a text passes its checks, one Claude call writes `QUESTIONS` multiple-choice questions about what
happens in it, each in the text's language with its English, and each answered by one line. They're
kept on the text, so the check at the end costs nothing to open and a text is never asked about
twice. The app adds questions of its own that cost nothing (a line to recognize by ear, the meaning
of a word looked up or practiced), and scores them all.

Generate, then verify: a question is kept only if the code agrees with it. Its line exists, it has
`CHOICES` different choices (in both languages) with one right answer, it has no markup, and the
question and choices together use at most `MAX_UNKNOWN` words that are neither known nor in the text
itself (the text's own words and names were just read). Anything else is dropped, never repaired. A
failed call leaves the text with no questions of this kind; it's still served.

Nothing here grades a card: answers stay with the reading.
"""

import json
import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.coverage import Checker, is_word, line_names, parse_line, segment_line
from franki_reader.generator import MODEL, Line, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

log = logging.getLogger(__name__)

QUESTIONS = 2  # kept for a text
ASKED = 3  # asked for, so one can fail its checks
CHOICES = 4  # a question's choices, the right one among them
MAX_UNKNOWN = 1  # words in a question and its choices that are neither known nor in the text
MAX_TOKENS = 4000

_SYSTEM = """\
You write short reading comprehension questions in {language} for an English-speaking learner \
who has just read a text in {language}."""

_REQUEST = """\
Here is the text, one line per row: its number, the line, and its English.

{lines}

Write {count} multiple-choice questions about what happens in it: who does something, what, \
why, where or when. Each must be answered by one line, and must not be answerable without having \
understood the text. Give:
- line: the number of the line that answers it
- question: the question in {language}, short and plain
- english: the question in English
- choices: {choices} answers, each with its {language} text and its English. Exactly one is right \
by the text; the others are plausible in the situation but clearly wrong by the text. Keep them \
about the same length.
- answer: the position of the right answer in choices, counting from 0

Use only words that are in the text or that a learner at this level surely knows, and keep the \
answers short, a few words each{spacing}. Plain text: no `|`, no asterisks, no tildes, no em \
dashes."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "line": {"type": "integer"},
                    "question": {"type": "string"},
                    "english": {"type": "string"},
                    "choices": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string"},
                                "english": {"type": "string"},
                            },
                            "required": ["text", "english"],
                            "additionalProperties": False,
                        },
                    },
                    "answer": {"type": "integer"},
                },
                "required": ["line", "question", "english", "choices", "answer"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["questions"],
    "additionalProperties": False,
}


class QuestionsFailed(Exception):
    """Claude couldn't write the questions; logged, and the text is served without them. `usage` is
    what the failed call was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class Answer:
    text: str
    english: str


@dataclass(frozen=True)
class Question:
    line: int  # the index of the line that answers it, from 0
    question: str
    english: str
    choices: tuple[Answer, ...]
    answer: int  # the index of the right one in `choices`

    def as_json(self) -> dict[str, Any]:
        return {
            "line": self.line,
            "question": self.question,
            "english": self.english,
            "choices": [{"text": c.text, "english": c.english} for c in self.choices],
            "answer": self.answer,
        }


def from_json(raw: Any) -> Question:
    """A stored question, as `as_json` wrote it."""
    return Question(
        line=raw["line"],
        question=raw["question"],
        english=raw["english"],
        choices=tuple(Answer(c["text"], c["english"]) for c in raw["choices"]),
        answer=raw["answer"],
    )


# Writes raw questions about a text's lines, and what that cost.
WriteQuestions = Callable[[Code, tuple[Line, ...]], Awaitable[tuple[list[Any], Usage]]]


def request_message(language: Code, lines: tuple[Line, ...]) -> str:
    spaced = LANGUAGES[language].spaced
    numbered = "\n".join(
        f"{i + 1} | {parse_line(ln.text, spaced)[0]} | {ln.english}" for i, ln in enumerate(lines)
    )
    return _REQUEST.format(
        lines=numbered,
        count=ASKED,
        language=LANGUAGES[language].name,
        choices=CHOICES,
        spacing="" if spaced else ", with no spaces between words",
    )


def _key(word: str, spaced: bool) -> str:
    return word.casefold() if spaced else word


def _text_words(lines: Iterable[Line], lexicon: Checker) -> tuple[set[str], list[str]]:
    """The words of a text as the checker splits them, and its names (to take out of a question
    before it's split, since a name the text marks can split into unknown pieces)."""
    words: set[str] = set()
    names: list[str] = []
    for line in lines:
        names.extend(line_names(line.text, lexicon.spaced))
        words.update(_key(p, lexicon.spaced) for p, _ in segment_line(line.text, lexicon))
    return words, sorted(set(names), key=len, reverse=True)


def _unknown(text: str, lexicon: Checker, words: set[str], names: list[str]) -> int:
    for name in names:
        text = text.replace(name, " ")
    return sum(
        1
        for t in lexicon.segment(text)
        if is_word(t) and lexicon.status(t) != "known" and _key(t, lexicon.spaced) not in words
    )


def _plain(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    if not value or any(c in value for c in "|*~—"):
        return None
    return value


def check(raw: object, lines: tuple[Line, ...], lexicon: Checker) -> Question | None:
    """A question Claude wrote, kept only if the code agrees with it (see the module's docstring).
    Claude numbers lines from 1; the question keeps the index from 0."""
    if not isinstance(raw, dict):
        return None
    line, answer = raw.get("line"), raw.get("answer")
    if not isinstance(line, int) or isinstance(line, bool) or not 1 <= line <= len(lines):
        return None
    if not isinstance(answer, int) or isinstance(answer, bool) or not 0 <= answer < CHOICES:
        return None
    question, english = _plain(raw.get("question")), _plain(raw.get("english"))
    choices_raw = raw.get("choices")
    if question is None or english is None or not isinstance(choices_raw, list):
        return None
    if len(choices_raw) != CHOICES:
        return None
    choices: list[Answer] = []
    for c in choices_raw:
        if not isinstance(c, dict):
            return None
        text, meaning = _plain(c.get("text")), _plain(c.get("english"))
        if text is None or meaning is None:
            return None
        choices.append(Answer(text, meaning))
    for side in ([c.text for c in choices], [c.english for c in choices]):
        if len({s.casefold() for s in side}) != CHOICES:
            return None
    words, names = _text_words(lines, lexicon)
    unknown = sum(
        _unknown(s, lexicon, words, names) for s in [question, *(c.text for c in choices)]
    )
    if unknown > MAX_UNKNOWN:
        return None
    return Question(line - 1, question, english, tuple(choices), answer)


def keep(raw: Iterable[object], lines: tuple[Line, ...], lexicon: Checker) -> tuple[Question, ...]:
    """The questions that pass `check`, at most `QUESTIONS`, each answered by a different line."""
    kept: list[Question] = []
    for item in raw:
        q = check(item, lines, lexicon)
        if q is not None and all(k.line != q.line for k in kept):
            kept.append(q)
        if len(kept) == QUESTIONS:
            break
    return tuple(kept)


def claude_questions(client: anthropic.AsyncAnthropic) -> WriteQuestions:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(language: Code, lines: tuple[Line, ...]) -> tuple[list[Any], Usage]:
        messages = [{"role": "user", "content": request_message(language, lines)}]
        try:
            response = await client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=_SYSTEM.format(language=LANGUAGES[language].name),
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            raise QuestionsFailed(f"Claude didn't answer ({type(e).__name__})") from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise QuestionsFailed(f"No questions ({response.stop_reason})", used)
        try:
            questions = json.loads(text).get("questions")
        except (json.JSONDecodeError, AttributeError) as e:
            raise QuestionsFailed("The answer wasn't valid JSON", used) from e
        return (questions if isinstance(questions, list) else []), used

    return write
