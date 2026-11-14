"""Sentences (docs/read-and-listen/architecture.md, Using the language): an English sentence for the
owner to say in the language, built around a word from their deck, with a sentence written for it
to compare with. The app's Sentences tool asks them; results stay on the phone, and nothing here
grades a card.

Which words: as for a text's stretch words (stretch.py), words reviewed today first, then young
ones, and never a word due today and not yet reviewed, which a sentence before its review would
prime. Not as the word asked, and not anywhere else in a sentence either: a sentence is checked with
the texts' writing lexicon (`Engine.writing_lexicon`), which counts those words as unknown, and one
that uses any of them is dropped.

Written in the background, `BATCH` words to a call, up to `STOCK` sentences a word, so the tool
never waits on Claude, and at most `BATCHES_PER_DAY` calls a language a day. Generate, then verify:
a sentence is kept only if it uses its word (in any form the checker knows), has at most
`MAX_UNKNOWN` other words outside the known ones, and none that's waiting for its review. Anything
else is dropped, never repaired.
"""

import json
import logging
import random
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam, BetaTextBlockParam

from franki_reader import store
from franki_reader.coverage import Checker, is_word
from franki_reader.generator import MODEL, Usage, system_prompt, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry
from franki_reader.stretch import pick_stretch

log = logging.getLogger(__name__)

STOCK = 2  # sentences kept for a word
BATCH = 10  # words asked for in one call
CANDIDATES = 30  # words considered for a round of sentences
MAX_UNKNOWN = 1  # other words in a sentence outside the known ones
MIN_WORDS, MAX_WORDS = 4, 14
BATCHES_PER_DAY = 3  # calls a language may make in a day
MAX_TOKENS = 6000

_REQUEST = """\
Write one short, natural {language} sentence for each word below, for a learner to practice saying:
something a person would really say, of {low} to {high} words, using the word (in whatever form fits)
and otherwise only words from the list. Give:
- word: the word exactly as listed below
- sentence: the sentence in {language}, plain text{spacing}
- english: the sentence in natural English

Write plain text: no `|`, no asterisks, no tildes. Vary the situations, and don't repeat a sentence.
Do not use em dashes.

The words:
{words}"""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "sentences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "word": {"type": "string"},
                    "sentence": {"type": "string"},
                    "english": {"type": "string"},
                },
                "required": ["word", "sentence", "english"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["sentences"],
    "additionalProperties": False,
}


class SentencesFailed(Exception):
    """Claude couldn't write a batch; logged, and tried again on a later round. `usage` is what the
    failed call was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Writes raw sentences for `words` from the language's entries, and what that cost.
WriteSentences = Callable[[list[Entry], Code, list[Entry]], Awaitable[tuple[list[Any], Usage]]]


@dataclass(frozen=True)
class Sentence:
    note_id: int
    word: str
    sentence: str
    english: str


def request_message(language: Code, words: list[Entry]) -> str:
    return _REQUEST.format(
        language=LANGUAGES[language].name,
        low=MIN_WORDS,
        high=MAX_WORDS - 2,
        spacing="" if LANGUAGES[language].spaced else ", with no spaces between words",
        words="\n".join(f"- {e.text} ({e.meaning})" for e in words),
    )


def check(
    raw: object, words: dict[str, Entry], writing: Checker, full: Checker, held: frozenset[str]
) -> Sentence | None:
    """A sentence Claude wrote, kept only if the code agrees with it (see the module's docstring).
    `writing` is the writing lexicon; `full` the snapshot's, which still knows the words waiting for
    their review (`held`), so a form of one is found."""
    if not isinstance(raw, dict):
        return None
    word, sentence, english = (raw.get(k) for k in ("word", "sentence", "english"))
    if not isinstance(word, str) or not isinstance(sentence, str) or not isinstance(english, str):
        return None
    entry = words.get(word.strip())
    sentence, english = sentence.strip(), english.strip()
    if entry is None or not sentence or not english:
        return None
    if "—" in sentence + english or any(c in sentence for c in "|*~"):
        return None
    tokens = [t for t in writing.segment(sentence) if is_word(t)]
    if not MIN_WORDS <= len(tokens) <= MAX_WORDS:
        return None

    def target(token: str) -> bool:
        return (full.entry_of(token) or token) == entry.text

    if not any(target(t) for t in tokens):
        return None
    if any((full.entry_of(t) or t) in held for t in tokens):
        return None
    unknown = [t for t in tokens if not target(t) and writing.status(t) != "known"]
    if len(unknown) > MAX_UNKNOWN:
        return None
    return Sentence(entry.note_id, entry.text, sentence, english)


def candidates(entries: list[Entry], days: int, rng: random.Random) -> list[Entry]:
    """The words a round of sentences is about: reviewed today first, then young, never waiting."""
    return pick_stretch(entries, CANDIDATES, rng, days=days)


async def top_up(
    conn: sqlite3.Connection,
    language: Code,
    words: list[Entry],
    writing_lexicon: Callable[[Code, list[Entry]], tuple[list[Entry], Checker]],
    full: Checker,
    held: frozenset[str],
    write: WriteSentences,
    now: Callable[[], datetime],
    writing: set[Code],
) -> None:
    """Writes sentences for the first `BATCH` of `words` with fewer than `STOCK`, unless the language
    is being written (`writing`, shared between requests) or made `BATCHES_PER_DAY` calls today. A
    call that failed after Claude answered is kept as a batch with no sentences, for its cost."""
    if language in writing:
        return
    if store.sentence_batches_since(conn, language, now() - timedelta(days=1)) >= BATCHES_PER_DAY:
        return
    stock = store.sentence_stock(conn, language)
    short = [e for e in words if stock.get(e.text, 0) < STOCK][:BATCH]
    if not short:
        return
    writing.add(language)
    try:
        entries, checker = writing_lexicon(language, short)
        raw, used = await write(entries, language, short)
        by_text = {e.text: e for e in short}
        kept = [s for s in (check(r, by_text, checker, full, held) for r in raw) if s is not None]
        store.save_sentence_batch(conn, language, kept, len(raw), now(), used.cost_usd())
    except SentencesFailed as e:
        log.warning("Couldn't write sentences for %s: %s", language, e)
        if e.usage != Usage():
            store.save_sentence_batch(conn, language, [], 0, now(), e.usage.cost_usd())
    finally:
        writing.discard(language)


def serve(
    conn: sqlite3.Connection,
    language: Code,
    words: list[Entry],
    count: int,
    now: datetime,
    reviewed: frozenset[str],
) -> list[dict[str, Any]]:
    """Up to `count` sentences, one a word, in the order of `words`, each the word's least recently
    served, marked served now. `reviewed`: the words reviewed today, which the app says so of."""
    meanings = {e.text: e.meaning for e in words}
    out: list[dict[str, Any]] = []
    for s in store.take_sentences(conn, language, [e.text for e in words], count, now):
        out.append(
            {
                "id": s.id,
                "word": s.word,
                "meaning": meanings.get(s.word, ""),
                "sentence": s.sentence,
                "english": s.english,
                "reviewed_today": s.word in reviewed,
            }
        )
    return out


def claude_sentences(client: anthropic.AsyncAnthropic) -> WriteSentences:
    output_config: BetaOutputConfigParam = {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(
        entries: list[Entry], language: Code, words: list[Entry]
    ) -> tuple[list[Any], Usage]:
        # The texts' own word list, cached, so a batch after a text reads it from the cache.
        system: list[BetaTextBlockParam] = [
            {
                "type": "text",
                "text": system_prompt(entries, language),
                "cache_control": {"type": "ephemeral"},
            }
        ]
        messages = [{"role": "user", "content": request_message(language, words)}]
        try:
            response = await client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            raise SentencesFailed(f"Claude didn't answer ({type(e).__name__})") from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise SentencesFailed(f"No sentences ({response.stop_reason})", used)
        try:
            sentences = json.loads(text).get("sentences")
        except (json.JSONDecodeError, AttributeError) as e:
            raise SentencesFailed("The answer wasn't valid JSON", used) from e
        return (sentences if isinstance(sentences, list) else []), used

    return write
