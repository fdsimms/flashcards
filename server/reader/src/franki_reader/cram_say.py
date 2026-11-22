"""Talk it through in English, for a cram (docs/read-and-listen/architecture.md, Talk it through).

The learner works out what they want to say at a lesson by saying it in English first. Two calls
serve it, both to the cheap model:

- `ask`: Claude plays a friend asking about the lesson's topic, one short English question at a time,
  never repeating an earlier one. Plain text out, nothing to check beyond its length.
- `lines`: from what the learner said (their answers, or one free write), Claude writes each thing
  they'd want to say as a line in the language, built from the learner's own words. Every line is
  kept only when written in the language's own script (`lesson_words.is_written`), and a Thai line
  only when it is in the learner's gender (`gender.thai_fits`). The code then segments each line
  against what the learner knows (`unknown_in`'s rule) so the words they reached for and don't have
  come back marked, glossed from the deck's meanings or Claude's own.

Nothing here reads a card's schedule, writes a note or grades anything: a missing word is only named,
and the app adds it through the note queue, where saving is the approval.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam, BetaTextBlockParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker, is_word
from franki_reader.cram_themes import (
    THAI_MAN,
    THAI_WOMAN,
    Candidate,
    PoolWord,
    Seeds,
    _new_words,
    _plain,
    _said,
    deck_block,
)
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lesson import MAX_CHARS
from franki_reader.reader import gloss_for
from franki_reader.register import Register, instruction

MAX_TOKENS = 4000
ASK_TOKENS = 300
# How much the learner's English may be (their answers together, or one free write), and the most
# turns of a chat the next question is asked from.
MAX_SAID = 3000
MAX_TURNS = 20
MAX_TURN_CHARS = 600
# The most lines, words a line may name as missing, and characters of the summary kept as the cram's
# "What really happened" (the cram's `MAX_FACTS`).
MAX_LINES = 8
MAX_NEW = 4
MAX_SUMMARY = 300
MAX_QUESTION = 200

Asker = Literal["claude", "you"]


@dataclass(frozen=True)
class Turn:
    asker: Asker
    text: str


@dataclass(frozen=True)
class Said:
    """One thing the learner wants to say: their English, the line in the language, how many of its
    words they know, and the words in it they don't (named by Claude or found by the check)."""

    english: str
    text: str
    known: int
    missing: tuple[Candidate, ...]


class SayFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# What Claude wrote and what asking cost: the next question, or the lines (raw, for `clean_lines`).
WriteQuestion = Callable[[Code, str, tuple[Turn, ...]], Awaitable[tuple[str, Usage]]]
WriteLines = Callable[[Code, Seeds], Awaitable[tuple[Any, Usage]]]


class WriteSay:
    """Both calls, so the app wires one thing."""

    def __init__(self, question: WriteQuestion, lines: WriteLines) -> None:
        self.question = question
        self.lines = lines


ASK_SYSTEM = """\
You are a friendly person helping someone get ready to talk about something at a {language} \
lesson, by first talking it through with them in English. The message gives what the lesson is \
for and what has been said so far. Ask the one next question a curious friend would ask about it: \
what happened, how it went, how they felt, who was there, what was hard or funny, or what they \
would tell their tutor. Make it a different question from any asked already. Ask in English, in \
one short sentence, and answer with the question only. Write American English, without em dashes."""

LINE: dict[str, Any] = {
    "type": "object",
    "properties": {
        "english": {"type": "string"},
        "text": {"type": "string"},
        "new_words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"word": {"type": "string"}, "english": {"type": "string"}},
                "required": ["word", "english"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["english", "text", "new_words"],
    "additionalProperties": False,
}
SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"summary": {"type": "string"}, "lines": {"type": "array", "items": LINE}},
    "required": ["summary", "lines"],
    "additionalProperties": False,
}

LINES_SYSTEM = """\
A learner of {language} has a lesson with a tutor soon. They talked about it in English first, and \
the message holds what they said. Find up to {max_lines} different things they would want to say \
at the lesson, in the order they came up, and write each as a short line the learner can say in \
{language}:

- english: what they meant, in one short plain English sentence in the first person, close to \
their own words.
- text: that sentence in {language}, written in {language}'s own writing, never romanization, with \
no translations in brackets. Build it from the learner's words in the numbered list and the full \
list of words they have studied, and very common words. {register}
- new_words: up to {max_new} words the line needs that are in neither list, each in {language}'s \
own writing as a flashcard would show it, with its meaning in a few plain English words. None when \
the line needs none. Never leave a word out of the lists unnamed here.

Never add a fact about the learner's life that they did not say. Also write summary: what they said, \
as two or three short first-person English sentences of at most {max_summary} characters in all, \
for the learner to keep. Write American English, without em dashes.{thai}"""


def ask_message(topic: str, turns: tuple[Turn, ...]) -> str:
    parts = [f"What the lesson is for: {topic}" if topic else "The lesson has no set topic.", ""]
    if not turns:
        parts.append("Nothing has been said yet. Open with the first question.")
    for t in turns:
        parts.append(f"{'Friend' if t.asker == 'claude' else 'Learner'}: {t.text}")
    return "\n".join(parts)


def lines_message(seeds: Seeds) -> str:
    parts = [f"What the lesson is for: {seeds.topic}", ""] if seeds.topic else []
    parts += [
        "What the learner said, in English:",
        seeds.facts,
        "",
        "The learner's words:",
        *(f"[{n}] {w.text} ({w.english})" for n, w in enumerate(seeds.pool)),
    ]
    return "\n".join(parts)


def lines_system(language: Code, register: Register, learner: str) -> str:
    return LINES_SYSTEM.format(
        language=LANGUAGES[language].name,
        max_lines=MAX_LINES,
        max_new=MAX_NEW,
        max_summary=MAX_SUMMARY,
        register=instruction(register),
        thai=(THAI_MAN if learner == "male" else THAI_WOMAN) if language == "th" else "",
    )


def clean_question(raw: str) -> str:
    """The question as shown: one line, without quotes around it, short enough to read at a glance."""
    q = _plain(raw).strip("\"'“”‘’")
    return q if q and len(q) <= MAX_QUESTION else ""


def clean_lines(
    raw: Any, seeds: Seeds, language: Code, checker: Checker | None, meanings: dict[str, str]
) -> tuple[str, list[Said]]:
    """The summary and the lines worth showing, in order. A line keeps only when both parts are
    there, short, and the text is written in the language (in Thai, in the learner's gender); a
    duplicate of an earlier line is dropped. Its missing words are the ones Claude named (written in
    the language, not already in the deck) plus any the check finds the learner doesn't know,
    glossed from the deck's meanings first."""
    summary = _plain(raw.get("summary")) if isinstance(raw, dict) else ""
    items = raw.get("lines") if isinstance(raw, dict) else None
    deck_keys = {w.text.casefold() for w in seeds.pool} | {w.text.casefold() for w in seeds.deck}
    out: list[Said] = []
    seen: set[str] = set()
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        english = _plain(item.get("english"))
        line = _said({"text": item.get("text"), "english": english}, seeds, language)
        if not line or len(english) > MAX_CHARS or line.text.casefold() in seen:
            continue
        seen.add(line.text.casefold())
        named = _new_words(item.get("new_words"), seeds, language, set(deck_keys))[:MAX_NEW]
        missing = list(named)
        known = 0
        if checker is not None:
            offered = {c.text.casefold() for c in named}
            for token in checker.segment(line.text):
                if not is_word(token):
                    continue
                if checker.status(token) == "known":
                    known += 1
                elif token.casefold() not in offered and token not in [m.text for m in missing]:
                    missing.append(Candidate(token, gloss_for(token, {}, checker, meanings) or ""))
        out.append(Said(english, line.text, known, tuple(missing)))
    return summary[:MAX_SUMMARY], out[:MAX_LINES]


def _blocks(language: Code, seeds: Seeds, text: str) -> list[BetaTextBlockParam]:
    blocks: list[BetaTextBlockParam] = []
    if seeds.deck:
        blocks.append(
            {
                "type": "text",
                "text": deck_block(language, seeds.deck),
                "cache_control": {"type": "ephemeral"},
            }
        )
    blocks.append({"type": "text", "text": text})
    return blocks


def claude_say(client: anthropic.AsyncAnthropic) -> WriteSay:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def question(language: Code, topic: str, turns: tuple[Turn, ...]) -> tuple[str, Usage]:
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=ASK_TOKENS,
                system=ASK_SYSTEM.format(language=LANGUAGES[language].name),
                messages=cast(
                    list[BetaMessageParam],
                    [{"role": "user", "content": ask_message(topic, turns)}],
                ),
            )
        except anthropic.APIError as e:
            raise SayFailed(
                didnt_answer(e, ". Try again in a moment.", doing="ask a question")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or not text:
            raise SayFailed("Claude didn't answer. Try again in a moment.", used)
        return text, used

    async def lines(language: Code, seeds: Seeds) -> tuple[Any, Usage]:
        system = _blocks(language, seeds, lines_system(language, seeds.register, seeds.learner))
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=cast(
                    list[BetaMessageParam], [{"role": "user", "content": lines_message(seeds)}]
                ),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            raise SayFailed(
                didnt_answer(e, ". Try again in a moment.", doing="find what you'd want to say")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise SayFailed("Claude didn't answer. Try again in a moment.", used)
        try:
            return json.loads(text), used
        except json.JSONDecodeError as e:
            raise SayFailed("Claude's answer couldn't be read. Try again.", used) from e

    return WriteSay(question, lines)


__all__ = [
    "PoolWord",
    "Said",
    "SayFailed",
    "Turn",
    "WriteSay",
    "claude_say",
    "clean_lines",
    "clean_question",
]
