"""An answer to a question the owner types about the card on screen in the app's review.

Asked only when the owner sends a question in the Ask Claude sheet, never ahead of time. The app
sends the card as text and the conversation so far (kept only while the sheet is open), so each
follow-up is one call. It only returns text: nothing here reads or writes the collection, and the
rating stays the owner's.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, cast

import anthropic
from anthropic.types.beta import BetaMessageParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

log = logging.getLogger(__name__)

MAX_TOKENS = 1200
# Turns kept in a request, so a long chat in an open sheet doesn't grow each call without bound.
MAX_TURNS = 12

SYSTEM = (
    "You answer a language learner's question about one flashcard they are reviewing. Answer in "
    "plain English, in a few short sentences, using the foreign word or phrase itself where it "
    "helps. Stay on what was asked: the card's word, its grammar, usage, a contrast with a "
    "similar word, or another example. Give examples in the card's language with an English "
    "translation. Call something common, natural or formal only when you are confident native "
    "speakers use it that way; if you are not, say how it works and nothing about how common it "
    "is. If you are not sure of an answer, say so. Do not use em dashes or headings. The learner "
    "has the card's answer in front of them and decides their own rating."
)


class AskCardFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class Turn:
    role: Literal["user", "assistant"]
    content: str


@dataclass(frozen=True)
class CardQuestion:
    # The card's language, when the app knows it; a card from another note type may not say.
    language: Code | None
    front: str
    back: str
    # The note's other fields (example sentence, notes), already plain text.
    details: str
    # The conversation, oldest first, ending with the learner's new question.
    turns: list[Turn]


# The answer, and what asking cost.
AskCard = Callable[[CardQuestion], Awaitable[tuple[str, Usage]]]


def card_message(question: CardQuestion) -> str:
    lines = ["The card I'm reviewing:"]
    if question.language:
        lines.append(f"Language: {LANGUAGES[question.language].name}")
    lines.append(f"Front: {question.front}")
    lines.append(f"Back: {question.back}")
    if question.details:
        lines.append(f"Note: {question.details}")
    return "\n".join(lines)


def messages_for(question: CardQuestion) -> list[BetaMessageParam]:
    """The card goes in front of the first question, and the conversation is cut to its latest
    MAX_TURNS turns. The model needs the roles to alternate, starting and ending with the learner,
    so a cut that would start on an answer drops that answer too."""
    turns = question.turns[-MAX_TURNS:]
    while turns and turns[0].role != "user":
        turns = turns[1:]
    if not turns:
        return []
    first = f"{card_message(question)}\n\nMy question: {turns[0].content}"
    out = [{"role": "user", "content": first}]
    out += [{"role": t.role, "content": t.content} for t in turns[1:]]
    return cast(list[BetaMessageParam], out)


def claude_ask_card(client: anthropic.AsyncAnthropic) -> AskCard:
    async def ask(question: CardQuestion) -> tuple[str, Usage]:
        messages = messages_for(question)
        if not messages or question.turns[-1].role != "user":
            raise AskCardFailed("Type a question about this card first.")
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM,
                messages=messages,
            )
        except anthropic.APIError as e:
            log.warning("Claude couldn't answer a card question: %s: %s", type(e).__name__, e)
            raise AskCardFailed(didnt_answer(e, ". Try again in a moment.")) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason == "refusal" or not text or not text.strip():
            raise AskCardFailed("Claude didn't answer that. Try asking it another way.", used)
        # An answer cut off at the limit is still shown, since most of it is useful.
        return text.strip(), used

    return ask
