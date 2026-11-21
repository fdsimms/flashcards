"""Themes to talk about at a lesson with a tutor, for a new cram (docs/read-and-listen/
architecture.md, Cram themes). A theme is a topic with the learner's own words that fit it, a few
common words the deck lacks, questions to steer the conversation with and a short story to tell.

The app sends words from the deck, each labeled by why it's on offer (not used at the last cram,
missed in its rounds, added lately, or simply studied), what Practice has been missing, and the titles
of crams already made. The server adds the common words the deck lacks (word_suggestions.py). Claude
is given numbered lists and answers with numbers, so the code keeps only words that are really in
those lists; the questions and the story it writes are kept only when written in the language's own
script (`lesson_words.is_written`). Nothing here reads a card's schedule, writes a note or grades
anything: a word to learn is only named, and the app adds it through the note queue, where saving
is the approval.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lesson import MAX_CHARS
from franki_reader.lesson_words import is_written

MAX_TOKENS = 4000
# How many themes are offered at once, and the most each one carries.
COUNT = 3
MAX_TITLE = 60
MAX_WHY = 200
MAX_WORDS = 12
MAX_NEW = 3
MAX_QUESTIONS = 5
MIN_QUESTIONS = 2
# What the request may hold: the deck's words the app sends, the common words the deck lacks, the
# titles to avoid and what Practice has been missing.
MAX_POOL = 60
MAX_CANDIDATES = 40
MAX_AVOID = 30
MAX_WEAK = 8
MAX_WEAK_CHARS = 120

Kind = Literal["carried", "missed", "fresh", "deck"]
KIND_NOTES: dict[Kind, str] = {
    "carried": "not used at the last lesson",
    "missed": "missed in practice rounds",
    "fresh": "added lately",
    "deck": "studied",
}


@dataclass(frozen=True)
class PoolWord:
    """A word of the learner's deck. `id` is the app's own, handed back so it knows which note."""

    id: str
    text: str
    english: str
    kind: Kind


@dataclass(frozen=True)
class Candidate:
    """A common word the deck lacks. `english` is empty when nothing glosses it yet."""

    text: str
    english: str


@dataclass(frozen=True)
class Seeds:
    pool: tuple[PoolWord, ...]
    candidates: tuple[Candidate, ...]
    # What Practice has been missing, as the app words it ("Telling time: minutes:to").
    weak_spots: tuple[str, ...]
    # Titles of crams already made and themes already shown.
    avoid: tuple[str, ...]
    stretch: bool
    # What the learner said the lesson is for (the cram's name): every theme is an angle on it.
    topic: str = ""


@dataclass(frozen=True)
class Line:
    text: str
    english: str


@dataclass(frozen=True)
class Theme:
    title: str
    why: str
    word_ids: tuple[str, ...]
    new_words: tuple[Candidate, ...]
    questions: tuple[Line, ...]
    story: Line | None


LINE: dict[str, Any] = {
    "type": "object",
    "properties": {"text": {"type": "string"}, "english": {"type": "string"}},
    "required": ["text", "english"],
    "additionalProperties": False,
}
SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "themes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "why": {"type": "string"},
                    "words": {"type": "array", "items": {"type": "integer"}},
                    "new_words": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "index": {"type": "integer"},
                                "english": {"type": "string"},
                            },
                            "required": ["index", "english"],
                            "additionalProperties": False,
                        },
                    },
                    "questions": {"type": "array", "items": LINE},
                    "story": LINE,
                },
                "required": ["title", "why", "words", "new_words", "questions", "story"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["themes"],
    "additionalProperties": False,
}

SYSTEM = """\
A learner of {language} has a conversation lesson with a tutor soon and wants things to talk \
about. Suggest {count} different themes. Each is a topic a learner could really talk about for a \
while, written as a short English title of two to six words (like "Ordering at a restaurant" or \
"What I did last weekend"). Use the numbered lists in the message:

- words: the numbers of the learner's own words that fit the theme, most useful first, at most \
{max_words}. Prefer words marked as missed, not used at the last lesson, or added lately, when \
they fit. Use only numbers that are in the list.
- new_words: up to {max_new} words from the second list that the theme needs and the learner \
lacks, each as the number and its meaning in a few plain English words. Use only numbers in \
that list, and none when nothing fits.
- why: one short English sentence on why the theme suits this learner, using only what the \
lists show (words they haven't used yet, words they miss, what they have been missing in \
practice). Do not give counts.
- questions: {min_questions} to {max_questions} questions a tutor would ask about the theme, \
written in {language} at the learner's level (short, common words) with the English. They are \
what the learner asks the tutor to steer the conversation, so they open the subject up.
- story: two or three short sentences in {language} that the learner could say about the theme, \
in the first person, using several of the learner's words, with the English.

Everything in {language} is written in {language}'s own writing, never romanization, with no \
translations in brackets. Write the English in American English, without em dashes. The themes \
must differ from each other and from any listed as taken.{topic}{level}"""

STRETCH = """ The learner wants a stretch: questions and a story a little above their level, \
while still built mostly from their own words."""
TOPIC = """ The learner has said what the lesson is for (the message starts with it). Make every \
theme a different angle on that, so all of them help with it. When it names no subject (only \
"Thai lesson", say), suggest themes freely."""
COMFORTABLE = """ Keep the questions and the story within the learner's level: mostly their own \
words, with common ones for the rest."""


class ThemesFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# What Claude wrote and what asking cost.
WriteThemes = Callable[[Code, Seeds], Awaitable[tuple[Any, Usage]]]


def request_message(seeds: Seeds) -> str:
    parts = [f"What the lesson is for: {seeds.topic}", ""] if seeds.topic else []
    parts += [
        "The learner's words:",
        *(f"[{n}] {w.text} ({w.english}) - {KIND_NOTES[w.kind]}" for n, w in enumerate(seeds.pool)),
    ]
    if seeds.candidates:
        parts += [
            "",
            "Common words the learner lacks:",
            *(
                f"[{n}] {c.text}" + (f" ({c.english})" if c.english else "")
                for n, c in enumerate(seeds.candidates)
            ),
        ]
    if seeds.weak_spots:
        parts += [
            "",
            "What the learner has been missing in practice (labels from the app):",
            *(f"- {w}" for w in seeds.weak_spots),
        ]
    if seeds.avoid:
        parts += ["", "Themes already taken, do not repeat them:", *(f"- {a}" for a in seeds.avoid)]
    return "\n".join(parts)


def system_message(language: Code, stretch: bool, topic: bool = False) -> str:
    return SYSTEM.format(
        language=LANGUAGES[language].name,
        count=COUNT,
        max_words=MAX_WORDS,
        max_new=MAX_NEW,
        min_questions=MIN_QUESTIONS,
        max_questions=MAX_QUESTIONS,
        level=STRETCH if stretch else COMFORTABLE,
        topic=TOPIC if topic else "",
    )


def _plain(value: Any) -> str:
    return " ".join(str(value or "").split())


def _line(raw: Any, language: Code) -> Line | None:
    """A question or story as the app may show it: both parts present, no longer than a lesson
    phrase, and the text written in the language's own script."""
    if not isinstance(raw, dict):
        return None
    text, english = _plain(raw.get("text")), _plain(raw.get("english"))
    if not text or not english or len(text) > MAX_CHARS or len(english) > MAX_CHARS:
        return None
    return Line(text, english) if is_written(text, language) else None


def _indexes(raw: Any, size: int) -> list[int]:
    """The distinct numbers in `raw` that name an item of a list of `size`, in order."""
    out: list[int] = []
    for n in raw if isinstance(raw, list) else []:
        if isinstance(n, int) and not isinstance(n, bool) and 0 <= n < size and n not in out:
            out.append(n)
    return out


def clean_themes(raw: Any, seeds: Seeds, language: Code) -> list[Theme]:
    """The themes worth showing, in order. A theme keeps only words that are in the lists it was
    given, questions and a story written in the language, and a title no other theme or taken
    title shares (ignoring case); one left with no words at all, or fewer than `MIN_QUESTIONS`
    questions, is dropped, not repaired. At most `COUNT`."""
    items = raw.get("themes") if isinstance(raw, dict) else None
    seen = {a.casefold() for a in seeds.avoid}
    out: list[Theme] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        title = _plain(item.get("title")).strip("\"'“”‘’").rstrip(".").strip()
        if not title or len(title) > MAX_TITLE or title.casefold() in seen:
            continue
        why = _plain(item.get("why"))
        word_ids = tuple(
            seeds.pool[n].id for n in _indexes(item.get("words"), len(seeds.pool))[:MAX_WORDS]
        )
        new: list[Candidate] = []
        taken: set[int] = set()
        new_raw = item.get("new_words")
        for entry in new_raw if isinstance(new_raw, list) else []:
            if not isinstance(entry, dict):
                continue
            picked = _indexes([entry.get("index")], len(seeds.candidates))
            if not picked or picked[0] in taken:
                continue
            candidate = seeds.candidates[picked[0]]
            english = candidate.english or _plain(entry.get("english"))
            if not english or len(english) > MAX_CHARS:
                continue
            taken.add(picked[0])
            new.append(Candidate(candidate.text, english))
        questions_raw = item.get("questions")
        asked = questions_raw if isinstance(questions_raw, list) else []
        questions = [q for q in (_line(x, language) for x in asked) if q is not None]
        if (not word_ids and not new) or len(questions) < MIN_QUESTIONS:
            continue
        seen.add(title.casefold())
        out.append(
            Theme(
                title,
                why if len(why) <= MAX_WHY else "",
                word_ids,
                tuple(new[:MAX_NEW]),
                tuple(questions[:MAX_QUESTIONS]),
                _line(item.get("story"), language),
            )
        )
    return out[:COUNT]


def claude_themes(client: anthropic.AsyncAnthropic) -> WriteThemes:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(language: Code, seeds: Seeds) -> tuple[Any, Usage]:
        messages = [{"role": "user", "content": request_message(seeds)}]
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=system_message(language, seeds.stretch, bool(seeds.topic)),
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            raise ThemesFailed(
                didnt_answer(e, ". Try again in a moment.", doing="suggest lesson themes")
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise ThemesFailed("Claude didn't answer. Try again in a moment.", used)
        try:
            return json.loads(text), used
        except json.JSONDecodeError as e:
            raise ThemesFailed("Claude's answer couldn't be read. Try again.", used) from e

    return write
