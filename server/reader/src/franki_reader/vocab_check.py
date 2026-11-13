"""The vocabulary check: the app's quiz on a language's most common words, which suggests how many to
count as known (the `common` setting). The quiz and its scoring run on the phone (src/reader/
vocabCheck.ts); this is its question bank. Results stay on the phone, and nothing here grades a card.

For each language but Thai, a fixed sample of its common words is drawn, `ASKED_PER_BAND` from each band
of ranks, and Claude writes each one's meaning and three wrong choices in one call, once, so the quiz
never waits on Claude and never asks for a word twice. Generate, then verify: a word is kept only if
it's one that was asked for and its choices pass the checks below. Anything else is dropped, never
repaired. Words already in the learner's deck are left out when the bank is served, since they count
as known anyway, and so are proper nouns and obvious cognates, which test nothing.
"""

import json
import logging
import random
import re
import sqlite3
import unicodedata
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader import store
from franki_reader.coverage import Checker
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.japanese import quiz_word
from franki_reader.languages import LANGUAGES, Code
from franki_reader.reader import from_wanikani
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
# Asked for, and all served: some won't pass the checks and some are deck words or giveaways
# (`is_giveaway`), and a band that runs short makes its neighbours carry its questions. The more a
# band holds, the more of a retake's words are new (the app asks unseen words first).
ASKED_PER_BAND = 14
MIN_PER_BAND = 5  # kept words a band needs for the bank to be used
WRONG = 3  # wrong choices a word carries
MAX_MEANING = 40  # characters
MAX_TOKENS = 12000
# Share of letters a word and its English meaning must have in common to be a giveaway.
COGNATE_RATIO = 0.8

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
{pieces}
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
    """Claude couldn't write the words; logged, and tried again later. `usage` is what the failed
    call was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


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


def sample(language: Code) -> list[tuple[int, str]]:
    """`ASKED_PER_BAND` words from each band as (rank, word), the same ones every time for a language
    (the list is fixed, and so is the seed), so a word is glossed once. Single plain words only
    (in Japanese, `quiz_word`'s: no particles, names or pieces of a word)."""
    words = common_lemmas(language)
    rng = random.Random(f"vocab-check:{language}")
    out: list[tuple[int, str]] = []
    for lo, hi in BANDS:
        pool = [(r, words[r - 1]) for r in range(lo, min(hi, len(words)) + 1)]
        pool = [(r, w) for r, w in pool if (quiz_word(w) if language == "ja" else w.isalpha())]
        out += sorted(rng.sample(pool, min(ASKED_PER_BAND, len(pool))))
    return out


# Japanese's list is wordfreq's MeCab pieces grouped by Sudachi, and a few are pieces of a conjugated
# word (まし, あり) that no learner would be asked about. Claude leaves those out with an empty
# meaning, which `check` drops.
_PIECES = (
    "If a listed word isn't a word on its own but a piece of a longer one (a verb's stem, like まし or "
    "あり), give it an empty meaning and no wrong choices.\n"
)


def request_message(language: Code, asked: list[tuple[int, str]]) -> str:
    return _REQUEST.format(
        pieces=_PIECES if language == "ja" else "",
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
    """Has Claude gloss the language's sample and stores what passes. A bank already there is topped
    up: only sampled words not yet stored are asked for, and what passes is added. False when it
    couldn't, or nothing passed on a first write, so the caller can try again later."""
    stored = {lemma for lemma, *_ in store.vocab_items(conn, language)}
    asked = [(rank, word) for rank, word in sample(language) if word not in stored]
    if not asked:
        return True
    try:
        raw, used = await write(language, asked)
    except VocabFailed as e:
        log.warning("Couldn't write vocabulary check words for %s: %s", language, e)
        if e.usage != Usage():
            # Its cost, as a batch with nothing asked or kept: none of its words count as asked
            # (store.vocab_asked), so they're all asked again.
            store.save_vocab_batch(conn, language, [], 0, now(), e.usage.cost_usd())
        return False
    lookup = {word: rank for rank, word in asked}
    kept = [i for i in (check(r, lookup) for r in raw) if i is not None]
    # A first write needs every band to have enough words for the quiz to reach it; otherwise none are
    # kept, so the bank is written again whole later. The cost is recorded either way.
    per_band = [sum(1 for i in kept if band_of(i.rank) == b) for b in range(len(BANDS))]
    enough = bool(stored) or all(n >= MIN_PER_BAND for n in per_band)
    store.save_vocab_batch(
        conn, language, kept if enough else [], len(asked), now(), used.cost_usd()
    )
    return enough


def _fold(text: str) -> str:
    """Lowercase without accents, so "legislador" and "legislator" compare on their letters."""
    decomposed = unicodedata.normalize("NFD", text.casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


_CYRILLIC = dict(
    zip(
        "абвгдезийклмнопрстуфхцчшщъыьэюяё",
        [
            "a",
            "b",
            "v",
            "g",
            "d",
            "e",
            "z",
            "i",
            "i",
            "k",
            "l",
            "m",
            "n",
            "o",
            "p",
            "r",
            "s",
            "t",
            "u",
            "f",
            "h",
            "ts",
            "ch",
            "sh",
            "sh",
            "",
            "i",
            "",
            "e",
            "iu",
            "ia",
            "e",
        ],
        strict=True,
    )
)
_CYRILLIC["ж"] = "zh"
_GREEK = dict(
    zip(
        "αβγδεζηθικλμνξοπρσςτυφχψω",
        [
            "a",
            "v",
            "g",
            "d",
            "e",
            "z",
            "i",
            "th",
            "i",
            "k",
            "l",
            "m",
            "n",
            "ks",
            "o",
            "p",
            "r",
            "s",
            "s",
            "t",
            "i",
            "f",
            "h",
            "ps",
            "o",
        ],
        strict=True,
    )
)


_KATAKANA = re.compile(r"^[\u30a0-\u30ffー]+$")


def _latin(word: str) -> str:
    """A Cyrillic or Greek word in Latin letters ("телефон" as "telefon"), so it can be compared with
    its English meaning; other letters are kept."""
    word = word.replace("ου", "u")
    return "".join(_CYRILLIC.get(c) or _GREEK.get(c) or c for c in word)


def _sound(word: str) -> str:
    """English spelled the way a transliteration spells it ("telephone" as "telefone"): the letters
    that differ only by spelling convention are made the same, and doubled letters made single."""
    for old, new in (
        ("tion", "tsi"),
        ("ph", "f"),
        ("ck", "k"),
        ("th", "t"),
        ("ch", "h"),
        ("sh", "h"),
        ("c", "k"),
        ("q", "k"),
        ("y", "i"),
        ("w", "v"),
        ("v", "b"),
        ("x", "ks"),
    ):
        word = word.replace(old, new)
    word = re.sub(r"(.)\1+", r"\1", word)
    # The ending is the language's own (-o, -os, -ia), unless that would leave too little ("moi").
    stem = re.sub(r"[aeiou]+s?$", "", word)
    return stem if len(stem) >= 3 else word


def is_giveaway(lemma: str, meaning: str) -> bool:
    """A word that tests nothing: a proper noun (its meaning is capitalized, "Thames") or a cognate an
    English speaker reads without studying (the word and its meaning share most of their letters,
    "legislador" and "legislator"). Checked here rather than left to Claude, and on what's stored, so a
    bank written before this check is cleaned when it's served. Russian and Greek words are compared
    with their Latin spelling ("телефон" as "telefon"), both sides respelled by sound. A Japanese word
    written only in katakana is a giveaway too: most are English loanwords (ホテル, ゲーム)."""
    if meaning[:1].isupper() and meaning != "I":
        return True
    if _KATAKANA.match(lemma):
        return True
    folded = _fold(lemma)
    text = _fold(meaning)
    pieces = text.removeprefix("to ").split()
    if (spelled := _latin(folded)) != folded:  # Cyrillic or Greek: compare by sound
        folded = _sound(spelled)
        pieces = [_sound(p) for p in pieces]
    candidates = [" ".join(pieces), *pieces]
    # A verb's ending is its own ("aceptar", "to accept"), so a verb is also compared without it.
    words = [folded, folded[:-2]] if text.startswith("to ") else [folded]
    # Short words only match when identical: "se" and "see" share letters, not a meaning.
    return any(
        word == c
        or (min(len(word), len(c)) >= 4 and SequenceMatcher(None, word, c).ratio() >= COGNATE_RATIO)
        for word in words
        for c in candidates
        if c
    )


def serve(conn: sqlite3.Connection, lexicon: Checker, language: Code) -> list[dict[str, Any]]:
    """The language's bank for the quiz, every stored word, without words already in the
    deck or learned in WaniKani (they count as known) and without proper nouns and obvious cognates
    (`is_giveaway`), most common first. Empty until the bank is written."""
    out: list[dict[str, Any]] = []
    for lemma, rank, meaning, wrong in store.vocab_items(conn, language):
        known = lexicon.entry_of(lemma) is not None or from_wanikani(lemma, lexicon)
        if known or is_giveaway(lemma, meaning):
            continue
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
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise VocabFailed(f"No words ({response.stop_reason})", used)
        try:
            words = json.loads(text).get("words")
        except (json.JSONDecodeError, AttributeError) as e:
            raise VocabFailed("The answer wasn't valid JSON", used) from e
        return (words if isinstance(words, list) else []), used

    return write
