"""English meanings for the words of a text that nothing else glosses.

A common word counts as known without being in the deck (spaced.py), so the model isn't asked to
gloss it, and a tap on it had no meaning to show; nor is a compound known by splitting into deck
entries (เข้าใจ, from เข้า and ใจ), whose parts' meanings are often not its own. After a text is
written, the words in it with no gloss from the text or the deck are glossed in one Claude call, each
with the English of the line it's in, and the answers are kept with that text (`texts.meanings`), so
a word shows the sense it has there: Spanish vino is "came" in one text and "wine" in the next. A tap
never makes a call. The language also keeps the first meaning each word was given
(`word_meanings`), only as the fallback for a text with none of its own and for cards' example
sentences, which are asked about once per word. The same pass runs over the texts waiting to be read
and read lately. Reading and listening still never grade or write cards: this only fills in text for
the reader to show.
"""

import json
import logging
import re
import sqlite3
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader import store
from franki_reader.coverage import Checker, is_word, segment_line
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.reader import gloss_for
from franki_reader.store import StoredText

log = logging.getLogger(__name__)

# Words asked about in one call; a pass with more waiting leaves the rest for the next.
MAX_WORDS = 150
MAX_MEANING = 40  # characters
MAX_TOKENS = 8000

_SYSTEM = """\
You give English meanings of {language} words for an English-speaking learner reading a short text. \
Each word is listed with the English translation of one line it appears in, so you can tell which \
sense is meant."""

_REQUEST = """\
For each numbered word below, give its meaning in English as it is used in that line, in one to four \
words (a verb as "to go", a past or inflected form as its own meaning: "went", "warm (neuter)"). A \
word can be listed more than once, with different lines: give each the meaning its own line uses. A \
compound means what the whole word means, not what its parts mean. Give each word's number, and the \
word exactly as listed. Plain text only: no `|`, no asterisks, no em dashes.

Words, each numbered and followed by the English of a line it is in:
{words}"""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "n": {"type": "integer"},
                    "word": {"type": "string"},
                    "meaning": {"type": "string"},
                },
                "required": ["n", "word", "meaning"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["words"],
    "additionalProperties": False,
}


class MeaningsFailed(Exception):
    """Claude couldn't write the meanings; logged, and tried again later. `usage` is what the failed
    call was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Writes the meanings for (word, line in English) pairs, numbered from 1 in the request, and what
# that cost.
WriteMeanings = Callable[[Code, list[tuple[str, str]]], Awaitable[tuple[list[Any], Usage]]]


def key(word: str) -> str:
    """How a word is kept and looked up: lower case, so a sentence's first word shares its meaning."""
    return word.casefold()


@dataclass(frozen=True)
class Wanted:
    """A word to ask the meaning of: as kept (`key`), with the English of the line it's in, and the
    text it's asked for (None for a card's sentence, whose answer is kept for the language only)."""

    word: str
    english: str
    text_id: int | None = None


def missing(texts: Iterable[StoredText], lexicon: Checker, deck: dict[str, str]) -> list[Wanted]:
    """The words in each of `texts` with no gloss of the text's own (the model's, or one asked for
    it before, `StoredText.meanings`) and none from `deck` (the deck's meanings, and WaniKani's),
    each with the English of the first line it's in there, in the order they appear. The language's
    kept meanings don't count: a word glossed for another text may be used here in another sense.
    Names are left out: the model glosses those itself."""
    found: list[Wanted] = []
    for text in texts:
        own = text.own_glosses
        seen: set[str] = set()
        for line in text.lines:
            for piece, is_name in segment_line(line.text, lexicon):
                word = key(piece)
                if is_name or not is_word(piece) or word in seen or word in text.meanings:
                    continue
                seen.add(word)
                if gloss_for(piece, own, lexicon, deck) is None:
                    found.append(Wanted(word, line.english, text.id))
    return found


def missing_in_sentences(
    sentences: Iterable[tuple[str, str]], lexicon: Checker, meanings: dict[str, str]
) -> list[Wanted]:
    """As `missing`, for cards' example sentences, given as (sentence, its English): plain text,
    split as `reader.render_sentence` splits it, with no glosses of their own, so a word with a kept
    meaning (`meanings`: the language's and the deck's) isn't asked about again."""
    found: dict[str, str] = {}
    for sentence, english in sentences:
        for piece in lexicon.segment(sentence):
            if not is_word(piece) or key(piece) in found or key(piece) in meanings:
                continue
            if gloss_for(piece, {}, lexicon, meanings) is None:
                found[key(piece)] = english
    return [Wanted(word, english) for word, english in found.items()]


def _clean(value: object) -> str:
    """A meaning as the reader shows it, or "" when there's nothing usable."""
    if not isinstance(value, str):
        return ""
    value = re.sub(r"\s*—\s*", ", ", value.replace("|", " ").replace("*", ""))
    value = " ".join(value.split())
    return value if value and len(value) <= MAX_MEANING else ""


def request_message(language: Code, asked: list[tuple[str, str]]) -> str:
    return _REQUEST.format(
        words="\n".join(f"{n}. {word} | {english}" for n, (word, english) in enumerate(asked, 1))
    )


async def fill(
    conn: sqlite3.Connection,
    write: WriteMeanings,
    language: Code,
    texts: Iterable[StoredText],
    lexicon: Checker,
    deck: dict[str, str],
    now: Callable[[], datetime],
) -> int:
    """Has Claude gloss the words in `texts` that have no gloss of their own, up to `MAX_WORDS`, and
    keeps what comes back with each text. A word it gives nothing usable for is kept without a
    meaning, so that text doesn't ask again. Returns how many words were asked about; raises
    `MeaningsFailed` when the call fails, after keeping what a paid answer cost as a batch with no
    words in it, so they're all asked again."""
    return await fill_words(conn, write, language, missing(texts, lexicon, deck), now)


async def fill_words(
    conn: sqlite3.Connection,
    write: WriteMeanings,
    language: Code,
    words: list[Wanted],
    now: Callable[[], datetime],
) -> int:
    """`fill` for words already found (`missing`, `missing_in_sentences`): the first `MAX_WORDS` are
    asked about in one call. Each answer is matched to its word by number, so a word asked for in two
    texts gets the meaning of each one's line. A meaning is kept with its text, and for the language
    when the language has none for the word yet."""
    asked = words[:MAX_WORDS]
    if not asked:
        return 0
    try:
        raw, used = await write(language, [(w.word, w.english) for w in asked])
    except MeaningsFailed as e:
        if e.usage != Usage():
            store.save_meaning_batch(conn, language, {}, now(), e.usage.cost_usd())
        raise
    answered: dict[int, str] = {}
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("word"), str):
            continue
        n = item.get("n")
        # The number places the answer, and the word has to match it, so a miscount keeps nothing.
        if isinstance(n, int) and 1 <= n <= len(asked) and key(item["word"]) == asked[n - 1].word:
            answered.setdefault(n - 1, _clean(item.get("meaning")))
    texts: dict[int, dict[str, str]] = {}
    for_language: dict[str, str] = {}
    for i, wanted in enumerate(asked):
        meaning = answered.get(i, "")
        if wanted.text_id is not None:
            texts.setdefault(wanted.text_id, {})[wanted.word] = meaning
        if not for_language.get(wanted.word):
            for_language[wanted.word] = meaning
    store.save_meaning_batch(
        conn,
        language,
        for_language,
        now(),
        used.cost_usd(),
        texts,
        (len(asked), sum(1 for m in answered.values() if m)),
    )
    return len(asked)


def claude_meanings(client: anthropic.AsyncAnthropic) -> WriteMeanings:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(language: Code, asked: list[tuple[str, str]]) -> tuple[list[Any], Usage]:
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
            raise MeaningsFailed(f"Claude didn't answer ({type(e).__name__})") from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise MeaningsFailed(f"No meanings ({response.stop_reason})", used)
        try:
            words = json.loads(text).get("words")
        except (json.JSONDecodeError, AttributeError) as e:
            raise MeaningsFailed("The answer wasn't valid JSON", used) from e
        return (words if isinstance(words, list) else []), used

    return write
