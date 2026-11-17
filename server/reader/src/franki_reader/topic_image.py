"""Starting a topic from an image (docs/read-and-listen/architecture.md, Your topics): a photo of a
grammar book's page, or a screenshot, is read by Claude for the one grammar point it's about, and
that fills the New topic screen's title. Nothing else comes from the image: the page is then
written and verified exactly as a typed topic is (grammar_topics.py), so the examples still use
only known words and nothing is graded or written to a card.

The image is sent to Claude and not kept: it isn't written to the database or to disk, and only its
cost is recorded. A read is asked for, so reads are counted and capped like a page write
(`MAX_READS_PER_DAY`, kept in memory by the caller: a restart resets it, which is the worst case of
a few extra reads).
"""

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import spend_limit_message
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.grammar_topics import MAX_TITLE
from franki_reader.languages import LANGUAGES, Code

log = logging.getLogger(__name__)

MAX_READS_PER_DAY = 20
MAX_IMAGE_CHARS = 6_000_000  # base64 text: Claude takes an image up to 5 MB, the app sends far less
MEDIA_TYPES = ("image/jpeg", "image/png", "image/webp", "image/gif")
MAX_TOKENS = 400

NOT_FOUND = "Couldn't find a grammar point in this image. Try a closer photo of the page, or type the topic."
DIDNT_ANSWER = "Claude didn't answer. Try again in a moment."

_PROMPT = """\
This image is a photo of a page from a grammar book, or a screenshot, for a learner of {language}.
Name the one grammar point it is mainly about, as a topic title of at most 8 words in English,
such as "Serial verbs" or "Instrumental case after prepositions". If a {language} word or
structure is the point, include it. If the image has no grammar point you can read, set `found`
to false and leave `title` empty. Plain text only: no markup and no em dashes."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"found": {"type": "boolean"}, "title": {"type": "string"}},
    "required": ["found", "title"],
    "additionalProperties": False,
}


class ReadFailed(Exception):
    """Claude couldn't read a topic; the message is shown to the owner as it is."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Reads the grammar point an image is about (base64 data, its media type): the title, or None when
# there's no readable point, and what the call cost.
ReadTopic = Callable[[Code, str, str], Awaitable[tuple[str | None, Usage]]]


def clean_title(raw: object) -> str | None:
    """A title worth filling in, or None: one line, at most `MAX_TITLE` characters, with nothing the
    screen would show as markup."""
    if not isinstance(raw, str):
        return None
    title = " ".join(raw.split()).strip("\"' ")
    if not title or len(title) > MAX_TITLE or any(c in title for c in "|*~—"):
        return None
    return title


def claude_topic_reader(client: anthropic.AsyncAnthropic) -> ReadTopic:
    output: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def read(language: Code, data: str, media_type: str) -> tuple[str | None, Usage]:
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": data},
                    },
                    {"type": "text", "text": _PROMPT.format(language=LANGUAGES[language].name)},
                ],
            }
        ]
        try:
            response = await client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                messages=cast(list[BetaMessageParam], messages),
                output_config=output,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            raise ReadFailed(spend_limit_message(e) or DIDNT_ANSWER) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise ReadFailed(DIDNT_ANSWER, used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise ReadFailed(DIDNT_ANSWER, used) from e
        if not isinstance(answer, dict) or answer.get("found") is not True:
            return None, used
        return clean_title(answer.get("title")), used

    return read
