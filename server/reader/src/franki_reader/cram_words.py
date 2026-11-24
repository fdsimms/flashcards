"""Words for a cram's topic, suggested by Claude when the learner opens Suggest words on a cram.

The learner names a cram for what it is for ("Talking about the 5k race I ran today"), and the
words they would need for it are what this lists: about eight, in the language's own script, each
with its reading and a short meaning. The phone says which the deck already has (it holds the
notes) and sends the rest to the note queue, so this knows nothing of the deck beyond the words
the learner already has in the cram, which it is told to leave out. Asked only when the screen
opens, on a focus typed there, and on More words. It reads and writes nothing and grades nothing.
"""

import json
from collections.abc import Awaitable, Callable
from typing import cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import CHEAP_MODEL, REGISTERS, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lesson_words import (
    COMMONNESS,
    READINGS,
    SCHEMA,
    Candidate,
    LessonWordsFailed,
    clean,
)

MAX_TOKENS = 2000
# How many words one ask returns, and how many already-known words the app may send to leave out.
MAX_SUGGESTED = 8
MAX_EXCLUDED = 150
MAX_TEXT = 200

SYSTEM = """\
A learner of {language} is preparing for a conversation lesson with a tutor and named what they \
want to be able to talk about. List the {language} words they will most need to tell the tutor \
about it (what happened, how it went, how they felt), the ones a person would actually say when \
talking about it afterward, most useful first. For each: text, the word written the way \
{language} is written (never romanization, never English), a single word or a short fixed \
expression and not a sentence; reading, {reading}; english, the meaning in a few plain words. \
Also give commonness, how common the word is in everyday speech ({commonness}), and register, \
how it is said ({registers}), each an empty string when you are not confident. Prefer common \
everyday words over rare or technical ones, include a few verbs and adjectives and not only \
nouns, give different words and not forms of one word, and never invent a word. Leave out every \
word in the learner's list of words they already have. Give exactly {count} words. Write the \
english in American English, without em dashes."""


# What the cram is for and what to leave out, and the suggested words with what asking cost.
SuggestWords = Callable[
    [Code, str, str, str, tuple[str, ...]], Awaitable[tuple[list[Candidate], Usage]]
]


def claude_suggest_words(client: anthropic.AsyncAnthropic) -> SuggestWords:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def suggest(
        language: Code, topic: str, facts: str, focus: str, exclude: tuple[str, ...]
    ) -> tuple[list[Candidate], Usage]:
        system = SYSTEM.format(
            language=LANGUAGES[language].name,
            reading=READINGS.get(language, "left empty (the spelling already shows the sound)"),
            commonness=", ".join(COMMONNESS),
            registers=", ".join(REGISTERS),
            count=MAX_SUGGESTED,
        )
        lines = [f"What it is for: {topic}" if topic else "What it is for: general conversation"]
        if facts:
            lines.append(f"What really happened, in the learner's words: {facts}")
        if focus:
            lines.append(f"The learner wants the words to lean toward: {focus}")
        if exclude:
            lines.append("Words they already have (leave these out): " + ", ".join(exclude))
        messages = [{"role": "user", "content": "\n".join(lines)}]
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
                didnt_answer(e, ". Try again in a moment.", doing="suggest words")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise LessonWordsFailed("Claude didn't suggest any words. Try again.", used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise LessonWordsFailed("Claude's answer couldn't be read. Try again.", used) from e
        if not isinstance(answer, dict):
            raise LessonWordsFailed("Claude's answer couldn't be read. Try again.", used)
        words = clean(answer, language, MAX_SUGGESTED)
        # Claude is told to leave the learner's words out; a word that comes back anyway is dropped.
        skip = set(exclude)
        return [w for w in words if w.text not in skip], used

    return suggest
