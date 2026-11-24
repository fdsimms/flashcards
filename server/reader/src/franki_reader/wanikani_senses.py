"""Which of a WaniKani word's English glosses are different senses, for its production note.

The app makes an Anki note for each WaniKani word that reaches Guru (src/wanikani/production.ts),
with WaniKani's first three glosses as its Meaning. The house style (note_guide) puts glosses that
could translate the word in the same sentence on one line and numbers the ones that couldn't: 月 is
"1. moon<br>2. month", not "moon; month". WaniKani doesn't say which glosses are which, so before a
batch of notes is saved the app sends the words with two or more glosses here, and Claude sorts
each word's glosses into senses and picks, from WaniKani's own example sentences, the one that
shows each sense.

Generate, then verify: an answer is kept only when its senses use every gloss exactly once, there
are two or three of them, each has its own sentence and a short label. A word whose glosses are all
one sense is simply not in the answer, and a word whose answer doesn't pass is left out the same
way, so the app writes it as it did before. Nothing here reads or writes the collection.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of

log = logging.getLogger(__name__)

MAX_WORDS = 50  # the app's batch of production notes (PRODUCTION_BATCH)
MAX_GLOSSES = 3  # the Meaning keeps WaniKani's first three
MAX_SENTENCES = 3
MAX_SENSES = 3
MAX_LABEL = 24  # characters
MAX_TOKENS = 4000

SYSTEM = """\
You sort the English glosses of Japanese words into senses, for a learner's flashcards. Glosses are \
one sense when every one of them could translate the word in the same example sentence ("to return; \
to go back"). When one couldn't, they are different senses: 月 "moon; month" is two senses, since \
"the moon is full" and "next month" can't swap glosses. A gloss that only narrows or rephrases \
another is the same sense."""

REQUEST = """\
For each numbered word below, decide whether its glosses hold more than one sense. Leave out a word \
whose glosses are all one sense. For a word with two or three senses, give its senses, the most \
common first. Each sense lists the numbers of its glosses (every gloss in exactly one sense), the \
number of the example sentence that shows that sense (a different sentence for each sense), and a \
label of one or two plain English words naming the sense ("moon", "month"). If no sentence shows \
one of the senses, leave the word out.

"""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "senses": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "glosses": {"type": "array", "items": {"type": "integer"}},
                                "sentence": {"type": "integer"},
                                "label": {"type": "string"},
                            },
                            "required": ["glosses", "sentence", "label"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["id", "senses"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["words"],
    "additionalProperties": False,
}


class SensesFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class Sentence:
    ja: str
    en: str


@dataclass(frozen=True)
class Word:
    # WaniKani's subject id.
    id: int
    characters: str
    # The glosses as the note's Meaning would list them, in that order.
    glosses: list[str]
    sentences: list[Sentence]


@dataclass(frozen=True)
class Senses:
    id: int
    # Each sense's glosses, as indexes into the word's `glosses`, the most common sense first.
    glosses: list[list[int]]
    # Each sense's example, as an index into the word's `sentences`.
    sentences: list[int]
    labels: list[str]


# The words with more than one sense, and what asking cost.
SortSenses = Callable[[list[Word]], Awaitable[tuple[list[Senses], Usage]]]


def request_message(words: list[Word]) -> str:
    lines = [REQUEST]
    for n, w in enumerate(words, 1):
        lines.append(f"{n}. {w.characters}")
        lines += [f"   gloss {i}: {g}" for i, g in enumerate(w.glosses, 1)]
        lines += [f"   sentence {i}: {s.ja} ({s.en})" for i, s in enumerate(w.sentences, 1)]
    return "\n".join(lines)


def _label(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split()).lower()
    if not text or len(text) > MAX_LABEL or any(c in text for c in "|<>—"):
        return None
    return text


def check(answer: dict[str, Any], words: list[Word]) -> list[Senses]:
    """The answer's words that pass, in the order asked. Numbers in the answer count from 1, as the
    request shows them; the result's indexes count from 0."""
    kept: dict[int, Senses] = {}
    raw = answer.get("words")
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        n, senses = item.get("id"), item.get("senses")
        if not isinstance(n, int) or not 1 <= n <= len(words) or not isinstance(senses, list):
            continue
        word = words[n - 1]
        if word.id in kept or not 2 <= len(senses) <= MAX_SENSES:
            continue
        glosses: list[list[int]] = []
        sentences: list[int] = []
        labels: list[str] = []
        for sense in senses:
            if not isinstance(sense, dict):
                break
            numbers, sentence, label = (
                sense.get("glosses"),
                sense.get("sentence"),
                _label(sense.get("label")),
            )
            if not isinstance(numbers, list) or not numbers or label is None:
                break
            if not all(isinstance(g, int) and 1 <= g <= len(word.glosses) for g in numbers):
                break
            if not isinstance(sentence, int) or not 1 <= sentence <= len(word.sentences):
                break
            glosses.append([g - 1 for g in numbers])
            sentences.append(sentence - 1)
            labels.append(label)
        else:
            used = sorted(g for sense in glosses for g in sense)
            if used == list(range(len(word.glosses))) and len(set(sentences)) == len(sentences):
                kept[word.id] = Senses(word.id, glosses, sentences, labels)
                continue
        log.info("Senses for %s don't pass: %s", word.characters, senses)
    return [kept[w.id] for w in words if w.id in kept]


def claude_senses(client: anthropic.AsyncAnthropic) -> SortSenses:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def sort(words: list[Word]) -> tuple[list[Senses], Usage]:
        if not words:
            return [], Usage()
        messages = [{"role": "user", "content": request_message(words)}]
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM,
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            raise SensesFailed(didnt_answer(e, doing="sort WaniKani's meanings into senses")) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise SensesFailed("Claude didn't sort the meanings.", used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise SensesFailed("Claude's answer couldn't be read.", used) from e
        if not isinstance(answer, dict):
            raise SensesFailed("Claude's answer couldn't be read.", used)
        return check(answer, words), used

    return sort
