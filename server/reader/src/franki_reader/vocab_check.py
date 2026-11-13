"""The vocabulary check: the app's quiz on a language's most common words, which suggests how many to
count as known (the `common` setting). The quiz and its scoring run on the phone (src/reader/
vocabCheck.ts); this is its question bank. Results stay on the phone, and nothing here grades a card.

For each language but Thai, a fixed sample of its common words is drawn, `PER_BAND` from each band of
ranks, and Claude writes each one's meaning and three wrong choices in one call, once, so the quiz
never waits on Claude and never asks for a word twice. Generate, then verify: a word is kept only if
it's one that was asked for and its choices pass the checks below. Anything else is dropped, never
repaired. Words already in the learner's deck are left out when the bank is served, since they count
as known anyway.
"""

import json
import logging
import random
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader import store
from franki_reader.coverage import Checker
from franki_reader.generator import MODEL, Usage
from franki_reader.languages import LANGUAGES, Code
from franki_reader.spaced import common_lemmas

log = logging.getLogger(__name__)

# Ranks in the language's common-word list: the bands the quiz samples, and the choices of the
# common-words setting that fall on their edges (the app scores by these, src/reader/vocabCheck.ts).
BANDS = (
    (1, 100),
    (101, 250),
    (251, 500),
    (501, 1000),
    (1001, 2000),
    (2001, 3000),
    (3001, 5000),
    (5001, 10000),
)
PER_BAND = (
    8  # words kept for each band, so 20 questions never run out even with deck words left out
)
ASKED_PER_BAND = 10  # asked for, since some won't pass the checks
MIN_PER_BAND = 5  # kept words a band needs for the bank to be used
WRONG = 3  # wrong choices a word carries
MAX_MEANING = 40  # characters
MAX_TOKENS = 8000

_SYSTEM = """\
You write multiple-choice vocabulary questions for an English-speaking learner of {language}. You \
are given common {language} words with their frequency ranks, and give each one's English meaning \
and three wrong choices."""

_REQUEST = """\
For each word below, give:
- word: the word exactly as listed
- meaning: its most common meaning in English, in one to three words (a verb as "to go")
- wrong: {wrong} English meanings that other common {language} words have, each clearly different \
from the word's meaning (never a synonym, a near synonym or another sense of the word) and the same \
kind of word (a verb's wrong choices are verbs, a noun's are nouns)

Plain text only: no `|`, no asterisks, no em dashes. Words, most common first:
{words}"""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "word": {"type": "string"},
                    "meaning": {"type": "string"},
                    "wrong": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["word", "meaning", "wrong"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["words"],
    "additionalProperties": False,
}


class VocabFailed(Exception):
    """Claude couldn't write the words; logged, and tried again later."""


# Writes the meanings and wrong choices for (rank, word) pairs, and what that cost.
WriteVocab = Callable[[Code, list[tuple[int, str]]], Awaitable[tuple[list[Any], Usage]]]


@dataclass(frozen=True)
class VocabItem:
    lemma: str
    rank: int
    meaning: str
    wrong: tuple[str, ...]


def band_of(rank: int) -> int | None:
    return next((i for i, (lo, hi) in enumerate(BANDS) if lo <= rank <= hi), None)


def complete(items: list[tuple[str, int, str, list[str]]]) -> bool:
    """Whether a stored bank reaches every band. A bank written before a band was added doesn't, and
    is written again whole (the sample's earlier bands are unchanged, so they're glossed the same words)."""
    per_band = [sum(1 for _, rank, _, _ in items if band_of(rank) == b) for b in range(len(BANDS))]
    return all(n >= MIN_PER_BAND for n in per_band)


def sample(language: Code) -> list[tuple[int, str]]:
    """`ASKED_PER_BAND` words from each band as (rank, word), the same ones every time for a language
    (the list is fixed, and so is the seed), so a word is glossed once. Single plain words only."""
    words = common_lemmas(language)
    rng = random.Random(f"vocab-check:{language}")
    out: list[tuple[int, str]] = []
    for lo, hi in BANDS:
        pool = [(r, words[r - 1]) for r in range(lo, min(hi, len(words)) + 1)]
        pool = [(r, w) for r, w in pool if w.isalpha()]
        out += sorted(rng.sample(pool, min(ASKED_PER_BAND, len(pool))))
    return out


def request_message(language: Code, asked: list[tuple[int, str]]) -> str:
    return _REQUEST.format(
        wrong=WRONG,
        language=LANGUAGES[language].name,
        words="\n".join(f"{rank}. {word}" for rank, word in asked),
    )


def _clean(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    if not value or len(value) > MAX_MEANING or any(c in value for c in "—|*~"):
        return None
    return value


def check(raw: object, asked: dict[str, int]) -> VocabItem | None:
    """A word Claude glossed, kept only if it was asked for and its choices are usable."""
    if not isinstance(raw, dict) or not isinstance(raw.get("wrong"), list):
        return None
    word, meaning = raw.get("word"), _clean(raw.get("meaning"))
    if not isinstance(word, str) or word not in asked or meaning is None:
        return None
    wrong = tuple(dict.fromkeys(w for w in (_clean(w) for w in raw["wrong"]) if w is not None))
    key = meaning.casefold().removeprefix("to ")
    # A wrong choice that is, or contains, the meaning (or the other way round) could be right.
    wrong = tuple(
        w
        for w in wrong
        if (k := w.casefold().removeprefix("to ")) != key and key not in k and k not in key
    )
    if len(wrong) < WRONG:
        return None
    return VocabItem(word, asked[word], meaning, wrong[:WRONG])


async def write_bank(
    conn: sqlite3.Connection,
    write: WriteVocab,
    language: Code,
    now: Callable[[], datetime],
) -> bool:
    """Has Claude gloss the language's sample and stores what passes. False when it couldn't, or
    nothing passed, so the caller can try again later."""
    asked = sample(language)
    try:
        raw, used = await write(language, asked)
    except VocabFailed as e:
        log.warning("Couldn't write vocabulary check words for %s: %s", language, e)
        return False
    lookup = {word: rank for rank, word in asked}
    kept = [i for i in (check(r, lookup) for r in raw) if i is not None]
    # Every band needs enough words for the quiz to reach it; otherwise none are kept, so the bank
    # is written again whole later. The cost is recorded either way.
    per_band = [sum(1 for i in kept if band_of(i.rank) == b) for b in range(len(BANDS))]
    enough = all(n >= MIN_PER_BAND for n in per_band)
    store.save_vocab_batch(conn, language, kept if enough else [], len(raw), now(), used.cost_usd())
    return enough


def serve(conn: sqlite3.Connection, lexicon: Checker, language: Code) -> list[dict[str, Any]]:
    """The language's bank for the quiz, up to `PER_BAND` words a band, without words already in the
    deck (they count as known), most common first. Empty until the bank is written."""
    out: list[dict[str, Any]] = []
    per_band: dict[int | None, int] = {}
    for lemma, rank, meaning, wrong in store.vocab_items(conn, language):
        band = band_of(rank)
        if lexicon.entry_of(lemma) is not None or per_band.get(band, 0) >= PER_BAND:
            continue
        per_band[band] = per_band.get(band, 0) + 1
        out.append({"word": lemma, "rank": rank, "meaning": meaning, "wrong": wrong})
    return out


def claude_vocab(client: anthropic.AsyncAnthropic) -> WriteVocab:
    output_config: BetaOutputConfigParam = {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(language: Code, asked: list[tuple[int, str]]) -> tuple[list[Any], Usage]:
        messages = [{"role": "user", "content": request_message(language, asked)}]
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
            raise VocabFailed(f"Claude didn't answer ({type(e).__name__})") from e
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise VocabFailed(f"No words ({response.stop_reason})")
        try:
            words = json.loads(text).get("words")
        except (json.JSONDecodeError, AttributeError) as e:
            raise VocabFailed("The answer wasn't valid JSON") from e
        u = response.usage
        used = Usage(
            u.input_tokens,
            u.output_tokens,
            u.cache_read_input_tokens or 0,
            u.cache_creation_input_tokens or 0,
            response.model,
        )
        return (words if isinstance(words, list) else []), used

    return write
