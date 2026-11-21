"""Rare English words for Suggested words, written by Claude (docs/read-and-listen/architecture.md,
Suggested words).

The English deck holds words a well-read native speaker doesn't know (chiliastic, velleity), so the
language's common-word list has nothing to offer it. Claude is shown the deck's words and told to
suggest more of that kind, and the words it names are checked in code: a word the deck, the queue or
a "Not interested" already has is dropped, and so is one on the common-word list, which a native
speaker knows. The checked words are kept (`store.written_words`) and shown from there until fewer
than REFILL_BELOW are left, so opening the screen doesn't cost a call each time. Nothing here adds a
note or grades a card: a picked word goes to the note queue like any suggested word.
"""

import json
import re
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.languages import Code
from franki_reader.lexicon import Entry
from franki_reader.spaced import common_words, fold

MAX_TOKENS = 4000
# Words asked for in a call, and the fewest left in the kept list before another call is made.
ASK_FOR = 40
REFILL_BELOW = 20
# How many of the deck's words, newest first, and of the words not to repeat, are sent.
MAX_DECK = 200
MAX_AVOID = 300

# One lowercase word: letters, with an inner hyphen or apostrophe. A phrase or a name isn't one.
WORD = re.compile(r"^[a-z]+(?:['-][a-z]+)*$")

SYSTEM = """\
You suggest English words for a learner's vocabulary deck. The learner is a well-read native \
speaker of American English. Their deck holds only words they did not know: rare, archaic, \
literary, technical or learned words (chiliastic, velleity, kenosis), never everyday ones. The \
deck's words are listed below, each with its meaning. Suggest {count} more words of that kind: \
words that most well-read native speakers could not define with confidence, and that are real \
words found in good writing or a major dictionary. Leave out everyday words, words most educated \
people know, proper nouns, abbreviations, slang, phrases and inflected forms (give the base form: \
the singular noun, the infinitive verb). Do not repeat a word in the deck or in the list of \
words to avoid, which the learner has already added or turned down, and do not suggest several \
forms of one word. Vary the fields: do not cluster on one subject or one source language. \
Prefer words a writer reaches for because they say something exactly, in the prose of good essays, \
histories, science and criticism: apodictic, epigone, tendentious. Avoid the words that appear on \
lists of beautiful, funny or obscure English words (widdershins, mellifluous, defenestrate, \
serendipity), words whose main appeal is how they sound or that they are long, whimsical or \
quaint, and words that exist mostly to be quoted in a list or used to show off. If a word is \
more often mentioned than used, leave it out. \
For each word give word, lowercase, and meaning, a short plain definition in American English \
without em dashes."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"word": {"type": "string"}, "meaning": {"type": "string"}},
                "required": ["word", "meaning"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["words"],
    "additionalProperties": False,
}


class RareWordsFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class RareWord:
    word: str
    meaning: str


# Words for a language's deck, from its entries and the words not to repeat, as Claude gave them
# (not yet `clean`ed), and what asking cost.
WriteRareWords = Callable[
    [Code, Sequence[Entry], Sequence[str]], Awaitable[tuple[list[RareWord], Usage]]
]


def clean(
    words: Iterable[RareWord], language: Code, skip: Checker, taken: Iterable[str]
) -> list[RareWord]:
    """The words the app may offer: one lowercase word each, with a meaning, none the deck, the
    queue or a dismissal already has (`skip`), none already kept or just given (`taken`), and none
    on the language's common-word list, which a native speaker knows. One that doesn't pass is
    dropped, not repaired."""
    known = set(common_words(language))
    seen = {fold(w, language) for w in taken}
    out: list[RareWord] = []
    for item in words:
        word = " ".join(item.word.split()).lower()
        meaning = " ".join(item.meaning.split())
        key = fold(word, language)
        if not WORD.match(word) or len(word) < 4 or not meaning:
            continue
        if key in seen or key in known:
            continue
        if skip.entry_of(word) is not None or skip.status(word) == "known":
            continue
        seen.add(key)
        out.append(RareWord(word, meaning))
    return out


def claude_rare_words(client: anthropic.AsyncAnthropic) -> WriteRareWords:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(
        language: Code, entries: Sequence[Entry], avoid: Sequence[str]
    ) -> tuple[list[RareWord], Usage]:
        deck = "\n".join(
            f"{e.text}: {e.meaning}" if e.meaning else e.text for e in entries[-MAX_DECK:]
        )
        message = f"The deck's words:\n{deck or '(none yet)'}"
        if avoid:
            message += "\n\nWords to avoid:\n" + ", ".join(avoid[-MAX_AVOID:])
        try:
            response = await client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM.format(count=ASK_FOR),
                messages=cast(list[BetaMessageParam], [{"role": "user", "content": message}]),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            raise RareWordsFailed(
                didnt_answer(e, ". Try again in a moment.", doing="suggest rare words")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise RareWordsFailed("Claude didn't suggest any words. Try again in a moment.", used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise RareWordsFailed("Claude's answer couldn't be read. Try again.", used) from e
        if not isinstance(answer, dict):
            raise RareWordsFailed("Claude's answer couldn't be read. Try again.", used)
        items = answer.get("words")
        words = [
            RareWord(str(i.get("word") or ""), str(i.get("meaning") or ""))
            for i in (items if isinstance(items, list) else [])
            if isinstance(i, dict)
        ]
        return words, used

    return write
