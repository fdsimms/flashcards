"""The note queue: words the owner typed in the app (Quick add) for Claude to fill in the rest of, in the
background, so a note is a word to type and a minute to check instead of a form.

Claude writes each word's Meaning (unless the owner gave one), a Context sentence with the word in bold,
its English translation, the romanization of the sentence and word where the language needs one (a
Japanese word's reading in kana instead, its KanaReading), the Register, PartOfSpeech, a Notes line
(usage, compounds, a contrast with a near word), plus what each language's finished notes carry
(`EXTRAS`: genders, German plurals and verb classes, Russian aspect partners, Polish and Greek key forms,
Thai classifiers, Japanese kanji), and the Language and GenerateReverse every note carries. The Audio field isn't written here: the app records it when the owner
saves the note, as it does for any note (src/core/recording.ts). Nothing here creates an Anki note or
grades a card. A word that has been filled in waits in `ready` until the owner opens it in the note
editor in the app, where saving is the approval.

Generate, then verify: a word is kept only if it was asked for and its fields pass the checks below.
Anything else is marked failed with the reason, never repaired. Words go to Claude a batch at a time,
never one call per word.
"""

import json
import logging
import re
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader import store
from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code

log = logging.getLogger(__name__)

BATCH = 10  # words in one call to Claude
MAX_ATTEMPTS = 3  # tries a word gets before it stays failed until the owner asks again
RETRY_AFTER = timedelta(minutes=10)  # between one try of a word and the next
MAX_TOKENS = 6000
MAX_MEANING = 80  # characters
MAX_SENTENCE = 200
MAX_REGISTER = 24
MAX_NOTES = 160
PARTS_OF_SPEECH = frozenset(
    {
        "noun",
        "verb",
        "adjective",
        "adverb",
        "pronoun",
        "preposition",
        "conjunction",
        "particle",
        "classifier",
        "numeral",
        "interjection",
        "phrase",
    }
)


@dataclass(frozen=True)
class Extra:
    """A field a language's finished notes carry beyond the common ones. `key` is the name in Claude's
    answer, `ask` what the prompt says to write, `allowed` the only values kept (None: any one line)
    and `pos` the part of speech it applies to (None: every word). Kept only when it passes; a word is
    never failed for one."""

    key: str
    field: str
    ask: str
    pos: str | None = None
    allowed: frozenset[str] | None = None
    limit: int = MAX_MEANING


_NO = "an empty string"
_LATIN_GENDER = frozenset({"m", "f", "n"})
# What each language's owner-written notes fill in, read off the deck (16 November 2026). English has nothing
# beyond the common fields, and Spanish Forms are filled in by fill_forms, not here. A noun's Gender (Spanish,
# Norwegian, German, French, Greek) is what the card draws its article from (el / la, en / ei / et, der / die / das, le / la, ο / η / το),
# so the Entry is the bare noun (the app drops the article it gives when a queued word is turned into a note).
EXTRAS: dict[Code, tuple[Extra, ...]] = {
    "th": (
        Extra(
            "classifier",
            "Classifier",
            "for a noun, its everyday classifier word in Thai script (e.g. ผืน for ผ้า); else " + _NO,
            "noun",
            limit=MAX_REGISTER,
        ),
    ),
    "de": (
        Extra(
            "gender", "Gender", 'for a noun, "m", "f" or "n"; else ' + _NO, "noun", _LATIN_GENDER, 1
        ),
        Extra(
            "plural",
            "Plural",
            "for a noun, the plural without its article (Einstellungen); else " + _NO,
            "noun",
        ),
        Extra(
            "genitive",
            "Genitive",
            "for a noun, the genitive singular with its article (der Einstellung, des Tisches); else "
            + _NO,
            "noun",
        ),
        Extra(
            "verb_class",
            "VerbClass",
            '"strong", "weak" or "mixed" for a verb; else ' + _NO,
            "verb",
            frozenset({"strong", "weak", "mixed"}),
        ),
        Extra(
            "auxiliary",
            "Auxiliary",
            '"haben" or "sein" for a verb; else ' + _NO,
            "verb",
            frozenset({"haben", "sein"}),
        ),
        Extra(
            "key_forms",
            "KeyForms",
            "for a verb, the first person singular preterite, with a separable prefix after it (warf ab); else "
            + _NO,
            "verb",
        ),
    ),
    "es": (
        Extra(
            "gender",
            "Gender",
            'for a noun, "m" or "f"; else ' + _NO,
            "noun",
            frozenset({"m", "f"}),
            1,
        ),
    ),
    "nb": (
        Extra(
            "gender", "Gender", 'for a noun, "m", "f" or "n"; else ' + _NO, "noun", _LATIN_GENDER, 1
        ),
    ),
    "fr": (
        Extra(
            "gender",
            "Gender",
            'for a noun, "m" or "f"; else ' + _NO,
            "noun",
            frozenset({"m", "f"}),
            1,
        ),
    ),
    "ru": (
        Extra(
            "gender", "Gender", 'for a noun, "m", "f" or "n"; else ' + _NO, "noun", _LATIN_GENDER, 1
        ),
        Extra(
            "aspect_partner",
            "AspectPartner",
            "for a verb, its partner of the other aspect, as one word (добиться for добиваться); else "
            + _NO,
            "verb",
        ),
        Extra(
            "key_forms",
            "KeyForms",
            "for a verb, the first person singular of the present (imperfective) or future (perfective) "
            "(добиваюсь); else " + _NO,
            "verb",
        ),
    ),
    "pl": (
        Extra(
            "gender", "Gender", 'for a noun, "m", "f" or "n"; else ' + _NO, "noun", _LATIN_GENDER, 1
        ),
        Extra(
            "key_forms",
            "KeyForms",
            "for a noun, its genitive singular and nominative plural, comma separated (mężczyzny, mężczyźni); "
            "for a verb, its first and second person singular of the present, or of the future for a "
            "perfective verb (mam, masz); else " + _NO,
            limit=40,
        ),
    ),
    "el": (
        Extra(
            "gender", "Gender", 'for a noun, "m", "f" or "n"; else ' + _NO, "noun", _LATIN_GENDER, 1
        ),
        Extra(
            "verb_class",
            "VerbClass",
            '"active" for a verb in -ω or -ώ, "deponent" for one in -ομαι or -μαι; else ' + _NO,
            "verb",
            frozenset({"active", "deponent"}),
        ),
        Extra(
            "key_forms",
            "KeyForms",
            "for a verb, the first person singular aorist (αντιπάθησα); else " + _NO,
            "verb",
        ),
    ),
    "ja": (
        Extra(
            "hanzi",
            "Hanzi",
            "for a word with kanji, each kanji with its readings in katakana in parentheses and its meaning, "
            "separated by semicolons (服(フク)clothing; 装(ソウ)adorn/dress); else " + _NO,
            limit=MAX_SENTENCE,
        ),
    ),
}

# Languages whose Context sentence and word get a romanization (the Omnilanguage fields
# ContextRomanized and Transliteration): the ones not written in Latin letters.
ROMANIZED: frozenset[Code] = frozenset({"th", "ru", "el"})
# Kana, and the long-vowel mark: what a Japanese reading is written in.
_KANA = re.compile(r"^[\u3041-\u309f\u30a0-\u30ffー・ ]+$")

_SYSTEM = """\
You fill in flashcard notes for an English-speaking learner of {language}. For each word or phrase you \
are given, you write the fields below. Be accurate: a wrong gloss or an unnatural sentence is worse \
than a plain one."""

_REQUEST = """\
For each entry below, give:
- entry: the entry exactly as listed
- meaning: its most common meaning in English, in as few words as will do (a verb as "to go"). If the \
entry came with a meaning from the learner, repeat it unchanged
- context: one natural {language} sentence of 5 to 12 words using the entry, with the entry as it is \
spelled in the sentence in <b></b> tags (both parts of a split verb), and no other markup
- translation: the sentence in natural English
- romanization: {romanization}
- transliteration: {transliteration}
- register: one lowercase word: "neutral" for plain everyday language, else "formal", "informal", \
"slang", "vulgar", "literary", "dated" or "technical"
- part_of_speech: one of noun, verb, adjective, adverb, pronoun, preposition, conjunction, particle, \
classifier, numeral, interjection, phrase
- notes: one short line of what helps remember or use the entry: how it differs from a near word, a \
common compound or collocation with its meaning, a usage restriction. An empty string when there is \
nothing worth saying; never filler
{extras}
Leave any field not described for {language} as an empty string. Plain text apart from the <b> tags: \
no `|`, no asterisks, no em dashes. Entries:
{entries}"""

# Every language's extra keys, in one schema: a key that doesn't apply to a language is left out of its
# prompt, and an answer that holds it anyway is ignored.
_EXTRA_KEYS = tuple(dict.fromkeys(x.key for extras in EXTRAS.values() for x in extras))

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "notes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "entry": {"type": "string"},
                    "meaning": {"type": "string"},
                    "context": {"type": "string"},
                    "translation": {"type": "string"},
                    "romanization": {"type": "string"},
                    "transliteration": {"type": "string"},
                    "register": {"type": "string"},
                    "part_of_speech": {"type": "string"},
                    "notes": {"type": "string"},
                    **{key: {"type": "string"} for key in _EXTRA_KEYS},
                },
                "required": [
                    "entry",
                    "meaning",
                    "context",
                    "translation",
                    "romanization",
                    "transliteration",
                    "register",
                    "part_of_speech",
                    "notes",
                    *_EXTRA_KEYS,
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["notes"],
    "additionalProperties": False,
}


class FillFailed(Exception):
    """Claude couldn't write the fields; logged, and tried again later. `usage` is what the failed
    call was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Writes the fields for (entry, the owner's meaning or "") pairs in a language, and what that cost.
WriteNotes = Callable[[Code, list[tuple[str, str]]], Awaitable[tuple[list[Any], Usage]]]


def request_message(language: Code, asked: list[tuple[str, str]]) -> str:
    name = LANGUAGES[language].name
    romanized = language in ROMANIZED
    if romanized:
        transliteration = "the entry alone in Latin letters, the same system"
    elif language == "ja":
        # The owner's Japanese notes keep a reading in kana, not a romanization.
        transliteration = (
            "the entry's reading in hiragana (a word written in katakana as it's written), with "
            "no kanji, Latin letters or spaces"
        )
    else:
        transliteration = "an empty string"
    return _REQUEST.format(
        language=name,
        romanization=(
            f"the sentence in Latin letters, the way a {name} textbook romanizes it"
            if romanized
            else "an empty string"
        ),
        extras="".join(f"- {x.key}: {x.ask}\n" for x in EXTRAS.get(language, ())),
        transliteration=transliteration,
        entries="\n".join(
            f"{i}. {entry}" + (f" (the learner's meaning: {meaning})" if meaning else "")
            for i, (entry, meaning) in enumerate(asked, 1)
        ),
    )


def _plain(value: object, limit: int, *, markup: bool = False) -> str | None:
    """One line of text with nothing in it a field can't hold, or None. `markup` allows <b> and </b>."""
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    if len(value) > limit or any(c in value for c in "—|*~"):
        return None
    text = value.replace("<b>", "").replace("</b>", "") if markup else value
    return None if "<" in text or ">" in text else value


def check(raw: object, asked: dict[str, str], language: Code) -> tuple[str, dict[str, str]] | None:
    """One word Claude filled, as (entry, fields by Anki field name), or None unless it was asked for
    and its fields are usable. The owner's own meaning is always kept; a field that doesn't apply (a
    romanization in Latin-letter languages) is left out rather than written empty."""
    if not isinstance(raw, dict):
        return None
    entry = raw.get("entry")
    if not isinstance(entry, str) or entry not in asked:
        return None
    meaning = asked[entry] or _plain(raw.get("meaning"), MAX_MEANING)
    context = _plain(raw.get("context"), MAX_SENTENCE, markup=True)
    translation = _plain(raw.get("translation"), MAX_SENTENCE)
    if not meaning or not context or not translation:
        return None
    # The entry is shown in bold, balanced, once or more (a split verb has two).
    opens, closes = context.count("<b>"), context.count("</b>")
    if opens == 0 or opens != closes:
        return None
    fields = {"Meaning": meaning, "Context": context, "ContextTranslation": translation}
    if language in ROMANIZED:
        romanization = _plain(raw.get("romanization"), MAX_SENTENCE)
        transliteration = _plain(raw.get("transliteration"), MAX_MEANING)
        if not romanization or not transliteration:
            return None
        fields["ContextRomanized"] = romanization
        fields["Transliteration"] = transliteration
    elif language == "ja":
        reading = _plain(raw.get("transliteration"), MAX_MEANING)
        if not reading or not _KANA.match(reading):
            return None
        fields[LANGUAGES[language].translit_field] = reading
    # The owner's notes spell a plain word's register "neutral", not an empty field.
    fields["Register"] = (_plain(raw.get("register"), MAX_REGISTER) or "neutral").casefold()
    fields["Language"] = LANGUAGES[language].name.casefold()
    fields["GenerateReverse"] = "y"
    # What follows is a nice-to-have: one that doesn't pass is left out, never repaired or a reason to
    # fail the word.
    part = _plain(raw.get("part_of_speech"), MAX_REGISTER)
    if part and part.casefold() in PARTS_OF_SPEECH:
        fields["PartOfSpeech"] = part.casefold()
    if note := _plain(raw.get("notes"), MAX_NOTES):
        fields["Notes"] = note
    for extra in EXTRAS.get(language, ()):
        if extra.pos is not None and fields.get("PartOfSpeech") != extra.pos:
            continue
        value = _plain(raw.get(extra.key), extra.limit)
        if value and (extra.allowed is None or value.casefold() in extra.allowed):
            fields[extra.field] = value.casefold() if extra.allowed else value
    return entry, fields


def due(note: store.QueuedNote, now: datetime) -> bool:
    """Whether a word should be sent to Claude now: waiting, or failed with tries left and the wait
    since the last one over."""
    if note.state == "waiting":
        return True
    return (
        note.state == "failed"
        and note.attempts < MAX_ATTEMPTS
        and (note.tried_at is None or now - note.tried_at >= RETRY_AFTER)
    )


def pending(conn: sqlite3.Connection, now: datetime) -> list[store.QueuedNote]:
    return [n for n in store.queued_notes(conn) if due(n, now)]


async def fill_pending(
    conn: sqlite3.Connection, write: WriteNotes, now: Callable[[], datetime]
) -> int:
    """Has Claude fill in every word that's due, a language and a batch at a time, and stores what
    came of each. Returns how many words were filled. A failed call fails its batch's words, which wait
    out `RETRY_AFTER` and are tried again until `MAX_ATTEMPTS`; what it cost, when Claude answered, is
    shared among them like a good batch's."""
    filled = 0
    tried: set[int] = set()
    while True:
        # Words that failed a moment ago wait out RETRY_AFTER, so this ends once each has had a turn.
        todo = [n for n in pending(conn, now()) if n.id not in tried]
        if not todo:
            return filled
        language = todo[0].language
        batch = [n for n in todo if n.language == language][:BATCH]
        tried.update(n.id for n in batch)
        # The same word queued twice is asked for once; its entry is the key Claude's answer comes back by.
        asked: dict[str, str] = {}
        for n in batch:
            asked.setdefault(n.entry, n.meaning)
        try:
            raw, used = await write(language, list(asked.items()))
        except FillFailed as e:
            log.warning("Couldn't fill in %s notes: %s", language, e)
            failed_cost = e.usage.cost_usd() / len(batch)
            for n in batch:
                store.save_queue_result(conn, n.id, language, None, str(e), now(), failed_cost)
            continue
        results = dict(r for r in (check(x, asked, language) for x in raw) if r is not None)
        cost = used.cost_usd() / len(batch)
        for n in batch:
            fields = results.get(n.entry)
            if fields is None:
                store.save_queue_result(
                    conn,
                    n.id,
                    language,
                    None,
                    "Claude's answer for this one didn't pass the checks.",
                    now(),
                    cost,
                )
            else:
                # The owner's meaning for this copy of the word, when two were queued with different ones.
                fields = {**fields, "Meaning": n.meaning or fields["Meaning"]}
                store.save_queue_result(conn, n.id, language, fields, "", now(), cost)
                filled += 1


def claude_notes(client: anthropic.AsyncAnthropic) -> WriteNotes:
    output_config: BetaOutputConfigParam = {
        "effort": "medium",
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
            raise FillFailed(didnt_answer(e, ".")) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise FillFailed(f"Claude didn't write these ({response.stop_reason}).", used)
        try:
            notes = json.loads(text).get("notes")
        except (json.JSONDecodeError, AttributeError) as e:
            raise FillFailed("Claude's answer wasn't valid JSON.", used) from e
        return (notes if isinstance(notes, list) else []), used

    return write
