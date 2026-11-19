"""An answer to a question the owner types about a phrase they selected in a line of a text.

Asked only when the owner sends a question in the phrase popup, never ahead of time. The app sends
the phrase and the conversation so far (kept only while the popup is open), and the server adds the
line and the whole text, so each follow-up is one call. It only returns text: nothing here reads or
writes the collection, grades anything, or adds a card.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import cast

import anthropic
from anthropic.types.beta import BetaMessageParam

from franki_reader.ask_card import MAX_TURNS, Turn
from franki_reader.claude_errors import didnt_answer
from franki_reader.explain import CALIBRATION, ENGLISH, IN_LANGUAGE, line_label, whole_text
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

MAX_TOKENS = 1200

SYSTEM = (
    "You answer an adult learner's question about a phrase they selected in one line of a short "
    "text in the language they are learning. Answer in a few short sentences, using the phrase "
    "itself, its words or short examples in the language where they help, each with an English "
    "translation. Stay on what was asked: the phrase's meaning here, its grammar, how its words "
    "combine, its tone, how it differs from a similar phrase, or another example. The whole text "
    "is there only so you can see what the phrase refers to. Use it only when it sharpens the "
    "answer, and never retell or summarize it. If you are not sure of an answer, say so. Do not "
    "use em dashes or headings." + ENGLISH + CALIBRATION
)


class AskPhraseFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class PhraseQuestion:
    language: Code
    phrase: str  # as it appears in the line
    line: str
    english: str
    # The whole text as for PhraseRequest (the selected line too); `index` is the line's place in it.
    context: tuple[str, ...]
    title: str
    index: int
    # The conversation, oldest first, ending with the learner's new question.
    turns: list[Turn]
    in_language: bool = False  # the answer in the phrase's language rather than English
    # As for PhraseRequest: the phrase's last line when it runs on past `index`.
    through: int | None = None


# The answer, and what asking cost.
AskPhrase = Callable[[PhraseQuestion], Awaitable[tuple[str, Usage]]]


def system_for(question: PhraseQuestion) -> str:
    """The prompt, with its English-only instruction swapped for the learner's choice of writing
    the answer in the language itself."""
    if question.in_language:
        return SYSTEM.replace(ENGLISH, IN_LANGUAGE.replace("each `note`", "the answer"))
    return SYSTEM


def phrase_context(question: PhraseQuestion) -> str:
    lines = [f"Language: {LANGUAGES[question.language].name}"]
    lines.extend(whole_text(question.context, question.title, question.index, question.through))
    lines.append(f"{line_label(question.index, question.through)}: {question.line}")
    lines.append(f"English: {question.english}")
    lines.append(f"Selected phrase: {question.phrase}")
    return "\n".join(lines)


def messages_for(question: PhraseQuestion) -> list[BetaMessageParam]:
    """The phrase and its text go in front of the first question, and the conversation is cut to
    its latest MAX_TURNS turns. The model needs the roles to alternate, starting and ending with
    the learner, so a cut that would start on an answer drops that answer too."""
    turns = question.turns[-MAX_TURNS:]
    while turns and turns[0].role != "user":
        turns = turns[1:]
    if not turns:
        return []
    first = f"{phrase_context(question)}\n\nMy question: {turns[0].content}"
    out = [{"role": "user", "content": first}]
    out += [{"role": t.role, "content": t.content} for t in turns[1:]]
    return cast(list[BetaMessageParam], out)


def claude_ask_phrase(client: anthropic.AsyncAnthropic) -> AskPhrase:
    async def ask(question: PhraseQuestion) -> tuple[str, Usage]:
        messages = messages_for(question)
        if not messages or question.turns[-1].role != "user":
            raise AskPhraseFailed("Type a question about this phrase first.")
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=system_for(question),
                messages=messages,
            )
        except anthropic.APIError as e:
            raise AskPhraseFailed(
                didnt_answer(e, ". Try again in a moment.", doing="answer a phrase question")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason == "refusal" or not text or not text.strip():
            raise AskPhraseFailed("Claude didn't answer that. Try asking it another way.", used)
        # An answer cut off at the limit is still shown, since most of it is useful.
        return text.strip(), used

    return ask
