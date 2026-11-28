"""English meanings for the words of a text that nothing else glosses.

A common word counts as known without being in the deck (spaced.py), so the model isn't asked to
gloss it, and a tap on it had no meaning to show; nor is a compound known by splitting into deck
entries (เข้าใจ, from เข้า and ใจ), whose parts' meanings are often not its own. After a text is
written, the words in it with no gloss from the text or the deck are glossed in one Claude call, each
with the line it's in and its English, and the answers are kept with that text (`texts.meanings`), so
a word shows the sense it has there: Spanish vino is "came" in one text and "wine" in the next. A tap
never makes a call, except a tap on a word with no meaning at all, which asks for that one word
(`Engine.define_word`, `/api/word-meaning`) and keeps the answer, replacing an empty one. A card's
example sentence is kept the same way (`sentence_meanings`), so a word
shows the sense it has in that sentence: เรื่อง is "matter" in one card and "movie" in the next. The
language also keeps the first meaning each word was given (`word_meanings`), only as the fallback for
a text or sentence with none of its own. The same pass runs over the texts waiting to be read
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
from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker, is_word, parse_line, segment_line
from franki_reader.generator import CHEAP_MODEL, REGISTERS, Usage, usage_of
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
Each word is listed with the line it appears in and that line's English translation, so you can \
tell which sense is meant and which part of the translation, if any, the word stands for."""

_REQUEST = """\
For each numbered word below, give its meaning in English as it is used in that line, in one to four \
words (a verb as "to go", a past or inflected form as its own meaning: "went", "warm (neuter)"). The \
English is a free translation of the line, so the word may have no counterpart in it, and a nearby \
word's translation is not this word's meaning: a word that only links others (a preposition, a \
particle) means what it does in the line ("about"), not a noun beside it. Read the line itself, not \
only its translation. A \
word can be listed more than once, with different lines: give each the meaning its own line uses. A \
compound means what the whole word means, not what its parts mean. Leave out a preposition or \
auxiliary that goes with the word in the line: "hoods", not "in hoods"; "eaten", not "has eaten". Give \
each word's number, and the \
word exactly as listed. Plain text only: no `|`, no asterisks, no em dashes. Also give each word's "register": how formal \
the word is where it is used in that line, one of casual, neutral, formal or slang, or an empty \
string when you are not confident native speakers use it that way. Most everyday words are neutral.

Words, each numbered and followed by a line it is in, then that line in English (the line is left \
out when it isn't known):
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
                    "register": {"type": "string", "enum": [*REGISTERS, ""]},
                },
                "required": ["n", "word", "meaning", "register"],
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


class MeaningsUnavailable(Exception):
    """No Claude key is set on the server, so nothing can write a meaning."""


# Writes the meanings for (word, line in English, line in the language) triples, numbered from 1 in
# the request, and what that cost. The line in the language is "" when it isn't known.
WriteMeanings = Callable[[Code, list[tuple[str, str, str]]], Awaitable[tuple[list[Any], Usage]]]


def key(word: str) -> str:
    """How a word is kept and looked up: lower case, so a sentence's first word shares its meaning."""
    return word.casefold()


@dataclass(frozen=True)
class Wanted:
    """A word to ask the meaning of: as kept (`key`), with the English of the line it's in, and the
    text it's asked for, or the card sentence it's asked for (`sentence`, as the card shows it).
    `line` is that line in the language itself, which the model needs to see which part of the
    English the word stands for ("" when it isn't known, as for a bare tap)."""

    word: str
    english: str
    text_id: int | None = None
    sentence: str | None = None
    line: str = ""


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
                    # The line as read, without its markup: the request row already uses `|` between its parts.
                    found.append(
                        Wanted(
                            word,
                            line.english,
                            text.id,
                            None,
                            parse_line(line.text, lexicon.spaced)[0],
                        )
                    )
    return found


def missing_in_sentences(
    sentences: Iterable[tuple[str, str]],
    lexicon: Checker,
    deck: dict[str, str],
    own: dict[str, dict[str, str]],
) -> list[Wanted]:
    """As `missing`, for cards' example sentences, given as (sentence, its English): plain text,
    split as `reader.render_sentence` splits it. `own` is what each sentence has been asked already
    (`store.sentence_meanings`, by sentence). Each sentence is asked about for itself, so a word has
    the sense of its own line: the language's kept meaning doesn't count, only the deck's."""
    found: list[Wanted] = []
    for sentence, english in sentences:
        asked = own.get(sentence, {})
        seen: set[str] = set()
        for piece in lexicon.segment(sentence):
            word = key(piece)
            if not is_word(piece) or word in seen or word in asked:
                continue
            seen.add(word)
            if gloss_for(piece, {}, lexicon, deck) is None:
                found.append(Wanted(word, english, None, sentence, sentence))
    return found


def _clean(value: object) -> str:
    """A meaning as the reader shows it, or "" when there's nothing usable."""
    if not isinstance(value, str):
        return ""
    value = re.sub(r"\s*—\s*", ", ", value.replace("|", " ").replace("*", ""))
    value = " ".join(value.split())
    return value if value and len(value) <= MAX_MEANING else ""


def request_message(language: Code, asked: list[tuple[str, str, str]]) -> str:
    return _REQUEST.format(
        words="\n".join(
            f"{n}. {word} | {line} | {english}" if line else f"{n}. {word} | {english}"
            for n, (word, english, line) in enumerate(asked, 1)
        )
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
    texts gets the meaning of each one's line. A meaning is kept with its text or card sentence, and
    for the language when the language has none for the word yet."""
    asked = words[:MAX_WORDS]
    if not asked:
        return 0
    try:
        raw, used = await write(language, [(w.word, w.english, w.line) for w in asked])
    except MeaningsFailed as e:
        if e.usage != Usage():
            store.save_meaning_batch(conn, language, {}, now(), e.usage.cost_usd())
        raise
    answered: dict[int, str] = {}
    registered: dict[int, str] = {}
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("word"), str):
            continue
        n = item.get("n")
        # The number places the answer, and the word has to match it, so a miscount keeps nothing.
        if isinstance(n, int) and 1 <= n <= len(asked) and key(item["word"]) == asked[n - 1].word:
            answered.setdefault(n - 1, _clean(item.get("meaning")))
            if item.get("register") in REGISTERS:
                registered.setdefault(n - 1, item["register"])
    texts: dict[int, dict[str, str]] = {}
    in_sentences: dict[str, dict[str, str]] = {}
    text_registers: dict[int, dict[str, str]] = {}
    for_language: dict[str, str] = {}
    for i, wanted in enumerate(asked):
        meaning = answered.get(i, "")
        if wanted.text_id is not None:
            texts.setdefault(wanted.text_id, {})[wanted.word] = meaning
            if i in registered:
                text_registers.setdefault(wanted.text_id, {})[wanted.word] = registered[i]
        if wanted.sentence is not None:
            in_sentences.setdefault(wanted.sentence, {})[wanted.word] = meaning
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
        text_registers,
        in_sentences,
    )
    return len(asked)


def claude_meanings(client: anthropic.AsyncAnthropic) -> WriteMeanings:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(language: Code, asked: list[tuple[str, str, str]]) -> tuple[list[Any], Usage]:
        messages = [{"role": "user", "content": request_message(language, asked)}]
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=_SYSTEM.format(language=LANGUAGES[language].name),
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            raise MeaningsFailed(didnt_answer(e)) from e
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
