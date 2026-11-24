"""Phrases for a cram, written by Claude when the learner opens Suggest words on its Phrases mode.

A phrase is a short line the learner could say to their tutor about what the cram is for (telling
it, not acting it out), built from the cram's own
words and words they already know, in the way an ordinary person talks (the register setting). It is
kept on the cram in the app and is never a note. Claude writes the lines; the code keeps only those
written in the language's own script, in the learner's gender for Thai (`gender.thai_fits`), and
using few words the learner doesn't know, since a phrase to practice should be one they can say.
Asked only when the screen opens in that mode, on a typed focus and on More phrases. It reads and
writes nothing in the collection and grades nothing.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker, is_word
from franki_reader.gender import thai_fits
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lesson import Learner, tokens
from franki_reader.lesson_words import (
    READINGS,
    SCHEMA,
    Candidate,
    LessonWordsFailed,
    clean,
)
from franki_reader.register import DEFAULT, Register, instruction

MAX_TOKENS = 2500
# How many phrases one ask returns, how many of the cram's words and earlier phrases are sent, and
# how many words a phrase may use that the learner doesn't know.
MAX_PHRASES_ASKED = 6
MAX_WORDS = 40
MAX_EXCLUDED = 100
MAX_UNKNOWN = 2

SYSTEM = """\
A learner of {language} is preparing for a conversation lesson with a tutor and named what they \
want to be able to talk about. Write {count} short phrases in {language} that the learner could \
say to the tutor to tell them about it, each one or two short sentences: what happened, how it \
went, how they felt, what they thought, what they plan next, what was hard or good about it. \
Most are statements about their own experience, mostly in the past tense when something already \
happened. They are not lines said inside the situation (a question to a race official, an order \
at a counter), unless the name says it is for a trip or an errand. {register} Build them from the \
learner's own words listed in the message and from very common words, using two or three of the \
learner's words in each; nothing else should be unfamiliar. Make the phrases different from each \
other: say different things about it, not one sentence reworded. When the message says what \
really happened, base the phrases on it and never invent a fact about the learner's life. For \
each: text, written the way {language} is written (never romanization, never English); reading, \
{reading}; english, the meaning in plain American English without em dashes. Also give \
commonness and register as empty strings. Leave out every phrase listed as already taken.{thai}"""

THAI_MAN = (
    ' The learner is a man: write "I" as ผม and end polite sentences with ครับ, never ฉัน, '
    "ดิฉัน, ค่ะ or คะ."
)
THAI_WOMAN = (
    ' The learner is a woman: write "I" as ดิฉัน or ฉัน, end statements with ค่ะ and questions '
    "with คะ, never ผม or ครับ."
)


@dataclass(frozen=True)
class PhraseSeeds:
    # What the cram is for, as the learner named it; empty for one with no subject yet.
    topic: str = ""
    # What really happened, in the learner's words.
    facts: str = ""
    # What the learner typed to steer the phrases.
    focus: str = ""
    # The cram's words, each with its meaning, for the phrases to use.
    words: tuple[tuple[str, str], ...] = ()
    # Phrases already on the cram or already shown, which are left out.
    exclude: tuple[str, ...] = ()
    register: Register = DEFAULT
    learner: Learner = "male"


# The phrases Claude wrote for the seeds, and what asking cost.
WritePhrases = Callable[[Code, PhraseSeeds], Awaitable[tuple[list[Candidate], Usage]]]


def request_message(seeds: PhraseSeeds) -> str:
    lines = [
        f"What it is for: {seeds.topic}" if seeds.topic else "What it is for: general conversation"
    ]
    if seeds.facts:
        lines.append(f"What really happened, in the learner's words: {seeds.facts}")
    if seeds.focus:
        lines.append(f"The learner wants the phrases to lean toward: {seeds.focus}")
    if seeds.words:
        lines.append("The learner's words:")
        lines.extend(f"- {text} ({english})" for text, english in seeds.words)
    if seeds.exclude:
        lines.append("Phrases already taken (leave these out):")
        lines.extend(f"- {text}" for text in seeds.exclude)
    return "\n".join(lines)


def claude_phrases(client: anthropic.AsyncAnthropic) -> WritePhrases:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(language: Code, seeds: PhraseSeeds) -> tuple[list[Candidate], Usage]:
        thai = (THAI_MAN if seeds.learner == "male" else THAI_WOMAN) if language == "th" else ""
        system = SYSTEM.format(
            language=LANGUAGES[language].name,
            count=MAX_PHRASES_ASKED,
            register=instruction(seeds.register),
            reading=READINGS.get(language, "left empty (the spelling already shows the sound)"),
            thai=thai,
        )
        messages = [{"role": "user", "content": request_message(seeds)}]
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
                didnt_answer(e, ". Try again in a moment.", doing="suggest phrases")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise LessonWordsFailed("Claude didn't suggest any phrases. Try again.", used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise LessonWordsFailed("Claude's answer couldn't be read. Try again.", used) from e
        if not isinstance(answer, dict):
            raise LessonWordsFailed("Claude's answer couldn't be read. Try again.", used)
        return clean(answer, language, MAX_PHRASES_ASKED), used

    return write


def unknown_words(text: str, checker: Checker, offered: set[str]) -> list[str]:
    """The words of a phrase the learner doesn't know, each once, leaving out the cram's own words
    (they are there to be learned)."""
    out: list[str] = []
    for token in checker.segment(text):
        if (
            is_word(token)
            and checker.status(token) != "known"
            and token.casefold() not in offered
            and token not in out
        ):
            out.append(token)
    return out


async def suggest_phrases(
    write: WritePhrases, language: Code, seeds: PhraseSeeds, checker: Checker | None = None
) -> tuple[list[Candidate], Usage]:
    """The phrases for `seeds`, kept only when they are new, in the learner's gender (Thai), and use
    at most `MAX_UNKNOWN` words the learner doesn't know; the ones with fewest unknown come first."""
    found, used = await write(language, seeds)
    taken = {" ".join(t.split()) for t in seeds.exclude}
    offered = {text.casefold() for text, _ in seeds.words}
    kept: list[tuple[int, Candidate]] = []
    for phrase in found:
        if phrase.text in taken:
            continue
        if language == "th" and not thai_fits(tokens(phrase.text), seeds.learner):
            continue
        unknown = len(unknown_words(phrase.text, checker, offered)) if checker else 0
        if unknown > MAX_UNKNOWN:
            continue
        kept.append((unknown, phrase))
    kept.sort(key=lambda pair: pair[0])
    return [phrase for _, phrase in kept], used
