"""Themes to talk about at a lesson with a tutor, for a cram (docs/read-and-listen/architecture.md,
Cram themes). A theme is a topic with the learner's own words that fit it, a few words the deck
lacks, questions the learner asks to steer the conversation, questions the tutor is likely to ask
them with an answer ready, and a short story to tell.

The app sends words from the deck, each labeled by why it's on offer (chosen for this cram, not used
at the last cram, missed in its rounds, added lately, or simply studied), what Practice has been
missing, the titles of crams already made and, optionally, what really happened. The server adds
every studied word of the language (in the cached first block of the system prompt, so a theme can
reach the words that fit its topic, not only the ones the app picked by date) and the common words
the deck lacks (word_suggestions.py). Claude answers the deck's words with numbers, so the code keeps
only words that are really in those lists; a new word is kept only when it is written in the
language and isn't in the deck already. Every line is kept only when written in the language's own
script (`lesson_words.is_written`), and a Thai line the learner says only when it is in their gender
(`gender.thai_fits`). Then the lines are checked against the words the learner knows
(`write_themes`): too many unknown words sends the request back once with them named, and the
unknown words left are handed to the app to mark. Nothing here reads a card's schedule, writes a
note or grades anything: a word to learn is only named, and the app adds it through the note queue,
where saving is the approval.
"""

import json
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, replace
from typing import Any, Literal, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam, BetaTextBlockParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker, is_word
from franki_reader.gender import thai_fits
from franki_reader.generator import CHEAP_MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code, citation_form
from franki_reader.lesson import MAX_CHARS, Learner, tokens
from franki_reader.lesson_words import is_written
from franki_reader.lexicon import Entry
from franki_reader.reader import gloss_for
from franki_reader.register import DEFAULT, Register, instruction

MAX_TOKENS = 6000
# One ask gives up after this long and is not retried by the SDK (it would wait 10 minutes, twice
# more): the screen shows "Try again" instead of "Thinking of themes" for minutes. The check's
# second ask is the only retry, so the longest a tap can take is about twice this.
REQUEST_TIMEOUT_SECONDS = 60.0
# How many themes are offered at once, and the most each one carries.
COUNT = 3
MAX_TITLE = 60
MAX_WHY = 200
MAX_WORDS = 12
MAX_NEW = 3
MAX_NEW_CHARS = 60
MAX_ASKS = 4
MAX_EXPECTS = 4
# A theme needs at least one question the learner asks, and this many questions of both kinds.
MIN_QUESTIONS = 2
# What the request may hold: the deck's words the app sends, the common words the deck lacks, the
# titles to avoid, what Practice has been missing and what the learner says really happened.
MAX_POOL = 60
MAX_CANDIDATES = 40
MAX_AVOID = 30
MAX_WEAK = 8
MAX_WEAK_CHARS = 120
MAX_FACTS = 300
# The most studied words the cached block lists (the newest, when a deck has more).
MAX_DECK = 4000
# How many words a theme's lines may use that the learner doesn't know before the themes are asked
# for again, once: Comfortable, then Stretch. The new words a theme offers don't count.
MAX_UNKNOWN = 2
MAX_UNKNOWN_STRETCH = 5
MAX_ATTEMPTS = 2
# How many unknown words a retry names.
MAX_NAMED = 12

Kind = Literal["cram", "carried", "missed", "fresh", "deck"]
KIND_NOTES: dict[Kind, str] = {
    "cram": "chosen for this lesson",
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
    """A word with its meaning: a common word the deck lacks (`english` empty when nothing glosses
    it yet), a studied word of the deck, or a word a theme's lines use that the learner doesn't know."""

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
    # How casual or formal the learner's lines sound.
    register: Register = DEFAULT
    # Who says the learner's lines: Thai's "I" and polite ending change with it.
    learner: Learner = "male"
    # Every studied word of the language, for the cached block (`deck_block`).
    deck: tuple[Candidate, ...] = ()
    # What the learner says really happened, in their words: the story and answers keep to it.
    facts: str = ""
    # Why the last answer was sent back (`write_themes`), empty on a first ask.
    feedback: str = ""


@dataclass(frozen=True)
class Line:
    text: str
    english: str


@dataclass(frozen=True)
class Expect:
    """A question the tutor is likely to ask, and an answer the learner could give."""

    question: Line
    answer: Line


@dataclass(frozen=True)
class Theme:
    title: str
    why: str
    word_ids: tuple[str, ...]
    # Studied words from the whole deck that aren't among the app's words, as text: the app finds
    # their notes by the word.
    deck_words: tuple[Candidate, ...]
    new_words: tuple[Candidate, ...]
    asks: tuple[Line, ...]
    expects: tuple[Expect, ...]
    story: Line | None
    # Words its lines use that the learner doesn't know (`write_themes`), with a meaning when one is kept.
    unknown: tuple[Candidate, ...] = ()


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
                    "deck_words": {"type": "array", "items": {"type": "integer"}},
                    "new_words": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "word": {"type": "string"},
                                "english": {"type": "string"},
                            },
                            "required": ["word", "english"],
                            "additionalProperties": False,
                        },
                    },
                    "asks": {"type": "array", "items": LINE},
                    "expects": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"question": LINE, "answer": LINE},
                            "required": ["question", "answer"],
                            "additionalProperties": False,
                        },
                    },
                    "story": LINE,
                },
                "required": [
                    "title",
                    "why",
                    "words",
                    "deck_words",
                    "new_words",
                    "asks",
                    "expects",
                    "story",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["themes"],
    "additionalProperties": False,
}

# The first, cached block of the system prompt: it changes only when the deck does, so asking again
# (Show different themes, Stretch) reads it from the cache.
DECK = """\
Every {language} word the learner has studied, one per line as "[D<number>] word (meaning)":
{words}"""

SYSTEM = """\
A learner of {language} has a conversation lesson with a tutor soon and wants things to talk \
about. Suggest {count} different themes. Each is a topic a learner could really talk about for a \
while, written as a short English title of two to six words (like "Ordering at a restaurant" or \
"What I did last weekend"). Use the numbered lists:

- words: the numbers of the learner's words in the message's list that fit the theme, most useful \
first. Put words marked as chosen for this lesson first whenever they fit, then ones marked missed, \
not used at the last lesson, or added lately.
- deck_words: the D numbers of other studied words, from the full list, that the theme needs. \
Together words and deck_words name at most {max_words}. Use only numbers that are in the lists.
- new_words: up to {max_new} words the learner doesn't have yet and the theme really needs, each \
in {language}'s own writing as a flashcard would show it, in {citation}, with its meaning in a few plain English \
words. Prefer one from the message's list of common words they lack when it fits. None when the \
theme doesn't need any.
- why: one short English sentence on why the theme suits this learner, using only what the \
lists show (words chosen for the lesson, words they haven't used yet, words they miss, what they \
have been missing in practice). Do not give counts.
- asks: 1 to {max_asks} questions the learner asks the tutor to open the theme up and keep the \
talk going, in {language} with the English. The tutor answers them, so they are about the tutor's \
own life, opinions or experience with the theme, never about what the learner did or felt (a \
question like "how did you feel after your run?" is one the tutor would ask the learner, so it \
goes in expects).
- expects: 1 to {max_expects} questions the tutor is likely to ask the learner about the theme, \
each with an answer the learner could give (one or two short sentences, in the first person), \
both in {language} with the English.
- story: two or three short sentences in {language} that the learner could say about the theme, \
in the first person, using several of the learner's words, with the English.{thai}

Everything the learner says (the asks, the answers and the story) is for speaking aloud with a \
tutor. {register} Build those lines from the learner's words, in both lists, and very common \
words; the new words should be the only others they need.

Everything in {language} is written in {language}'s own writing, never romanization, with no \
translations in brackets. Write the English in American English, without em dashes. The themes \
must differ from each other and from any listed as taken.{topic}{facts}{level}"""

# The learner says the asks, the answers and the story, so they are written as they would say them
# (the same rule as a lesson's phrases, lesson_writer.thai_problems). The tutor's questions are the
# tutor's, whose gender isn't known.
THAI_MAN = (
    ' The learner is a man: in everything the learner says, write "I" as ผม and end polite '
    "sentences with ครับ, never ฉัน, ดิฉัน, ค่ะ or คะ. Leave the polite ending off the tutor's "
    "questions in expects, since the tutor's own isn't known."
)
THAI_WOMAN = (
    ' The learner is a woman: in everything the learner says, write "I" as ดิฉัน or ฉัน, end '
    "statements with ค่ะ and questions with คะ, never ผม or ครับ. Leave the polite ending off the "
    "tutor's questions in expects, since the tutor's own isn't known."
)

STRETCH = """ The learner wants a stretch: lines a little above their level, while still built \
mostly from their own words."""
TOPIC = """ The learner has said what the lesson is for (the message starts with it). Make every \
theme a different angle on that, so all of them help with it. When it names no subject (only \
"Thai lesson", say), suggest themes freely."""
FACTS = """ The message also says what really happened, in the learner's words. Write the story \
and the answers from it, and never add a fact about the learner's life that it doesn't give: where \
an answer needs one, keep it general."""
COMFORTABLE = """ Keep the lines within the learner's level: mostly their own words, with very \
common ones for the rest."""
RETRY = (
    "Some of those lines use words the learner hasn't studied: {words}. Write the themes again, "
    "with those words swapped for ones from the lists or very common ones, or offered as a new "
    "word where the theme truly needs one."
)


class ThemesFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# What Claude wrote and what asking cost.
WriteThemes = Callable[[Code, Seeds], Awaitable[tuple[Any, Usage]]]


def deck_of(entries: Iterable[Entry]) -> tuple[Candidate, ...]:
    """The studied words of a snapshot's entries for the cached block, in note order so the block is
    byte-identical between calls on the same snapshot; the newest `MAX_DECK` when there are more."""
    known = sorted((e for e in entries if e.tier != "unreviewed"), key=lambda e: e.note_id)
    return tuple(
        Candidate(" ".join(e.text.split()), " ".join(e.meaning.split())) for e in known[-MAX_DECK:]
    )


def deck_block(language: Code, deck: tuple[Candidate, ...]) -> str:
    return DECK.format(
        language=LANGUAGES[language].name,
        words="\n".join(
            f"[D{n}] {w.text}" + (f" ({w.english})" if w.english else "")
            for n, w in enumerate(deck)
        ),
    )


def request_message(seeds: Seeds) -> str:
    parts = [f"What the lesson is for: {seeds.topic}", ""] if seeds.topic else []
    if seeds.facts:
        parts += [f"What really happened, in the learner's words: {seeds.facts}", ""]
    parts += [
        "The learner's words:",
        *(f"[{n}] {w.text} ({w.english}) - {KIND_NOTES[w.kind]}" for n, w in enumerate(seeds.pool)),
    ]
    if seeds.candidates:
        parts += [
            "",
            "Common words the learner lacks:",
            *(f"- {c.text}" + (f" ({c.english})" if c.english else "") for c in seeds.candidates),
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


def system_message(
    language: Code,
    stretch: bool,
    topic: bool = False,
    register: Register = DEFAULT,
    learner: Learner = "male",
    facts: bool = False,
) -> str:
    return SYSTEM.format(
        language=LANGUAGES[language].name,
        citation=citation_form(language),
        count=COUNT,
        max_words=MAX_WORDS,
        max_new=MAX_NEW,
        max_asks=MAX_ASKS,
        max_expects=MAX_EXPECTS,
        level=STRETCH if stretch else COMFORTABLE,
        topic=TOPIC if topic else "",
        facts=FACTS if facts else "",
        register=instruction(register),
        thai=(THAI_MAN if learner == "male" else THAI_WOMAN) if language == "th" else "",
    )


def _plain(value: Any) -> str:
    return " ".join(str(value or "").split())


def _line(raw: Any, language: Code) -> Line | None:
    """A line as the app may show it: both parts present, no longer than a lesson phrase, and the
    text written in the language's own script."""
    if not isinstance(raw, dict):
        return None
    text, english = _plain(raw.get("text")), _plain(raw.get("english"))
    if not text or not english or len(text) > MAX_CHARS or len(english) > MAX_CHARS:
        return None
    return Line(text, english) if is_written(text, language) else None


def _said(raw: Any, seeds: Seeds, language: Code) -> Line | None:
    """A line the learner says: as `_line`, and in Thai only when it's in their gender (the
    learner's own words, said as the other gender, are dropped, not repaired)."""
    line = _line(raw, language)
    if line and language == "th" and not thai_fits(tokens(line.text), seeds.learner):
        return None
    return line


def _indexes(raw: Any, size: int) -> list[int]:
    """The distinct numbers in `raw` that name an item of a list of `size`, in order."""
    out: list[int] = []
    for n in raw if isinstance(raw, list) else []:
        if isinstance(n, int) and not isinstance(n, bool) and 0 <= n < size and n not in out:
            out.append(n)
    return out


def _new_words(raw: Any, seeds: Seeds, language: Code, have: set[str]) -> list[Candidate]:
    """The words to learn worth offering: written in the language, short, with a meaning (the
    common list's own when it has one), and not a word the learner has or another one repeats."""
    common = {c.text.casefold(): c for c in seeds.candidates}
    out: list[Candidate] = []
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        word = _plain(entry.get("word"))
        key = word.casefold()
        if not word or len(word) > MAX_NEW_CHARS or key in have or not is_written(word, language):
            continue
        listed = common.get(key)
        english = (listed.english if listed else "") or _plain(entry.get("english"))
        if not english or len(english) > MAX_CHARS:
            continue
        have.add(key)
        out.append(Candidate(word, english))
    return out[:MAX_NEW]


def clean_themes(raw: Any, seeds: Seeds, language: Code) -> list[Theme]:
    """The themes worth showing, in order. A theme keeps only words that are in the lists it was
    given (or new words the deck lacks), lines written in the language (the learner's in their
    gender, in Thai), and a title no other theme or taken title shares (ignoring case); one left
    with no words, no question for the learner to ask, or fewer than `MIN_QUESTIONS` questions of
    both kinds is dropped, not repaired. At most `COUNT`."""
    items = raw.get("themes") if isinstance(raw, dict) else None
    seen = {a.casefold() for a in seeds.avoid}
    deck_keys = {w.text.casefold() for w in seeds.pool} | {w.text.casefold() for w in seeds.deck}
    out: list[Theme] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        title = _plain(item.get("title")).strip("\"'“”‘’").rstrip(".").strip()
        if not title or len(title) > MAX_TITLE or title.casefold() in seen:
            continue
        why = _plain(item.get("why"))
        pool = [seeds.pool[n] for n in _indexes(item.get("words"), len(seeds.pool))][:MAX_WORDS]
        taken = {w.text.casefold() for w in pool}
        deck: list[Candidate] = []
        for n in _indexes(item.get("deck_words"), len(seeds.deck)):
            word = seeds.deck[n]
            if len(pool) + len(deck) >= MAX_WORDS:
                break
            if word.text.casefold() not in taken:
                taken.add(word.text.casefold())
                deck.append(word)
        new = _new_words(item.get("new_words"), seeds, language, set(deck_keys))
        asks_raw = item.get("asks")
        asks = [a for a in (_said(x, seeds, language) for x in _list(asks_raw)) if a]
        expects: list[Expect] = []
        for pair in _list(item.get("expects")):
            if not isinstance(pair, dict):
                continue
            question, answer = (
                _line(pair.get("question"), language),
                _said(pair.get("answer"), seeds, language),
            )
            if question and answer:
                expects.append(Expect(question, answer))
        asks, expects = asks[:MAX_ASKS], expects[:MAX_EXPECTS]
        if (
            (not pool and not deck and not new)
            or not asks
            or len(asks) + len(expects) < MIN_QUESTIONS
        ):
            continue
        seen.add(title.casefold())
        out.append(
            Theme(
                title,
                why if len(why) <= MAX_WHY else "",
                tuple(w.id for w in pool),
                tuple(deck),
                tuple(new),
                tuple(asks),
                tuple(expects),
                _said(item.get("story"), seeds, language),
            )
        )
    return out[:COUNT]


def _list(raw: Any) -> list[Any]:
    return raw if isinstance(raw, list) else []


def lines_of(theme: Theme) -> list[str]:
    """Every line of a theme in the language, in the order the app shows them."""
    return [
        *(a.text for a in theme.asks),
        *(t for e in theme.expects for t in (e.question.text, e.answer.text)),
        *([theme.story.text] if theme.story else []),
    ]


def unknown_in(theme: Theme, checker: Checker) -> list[str]:
    """The words a theme's lines use that the learner doesn't know, each once, in order, leaving out
    the new words it offers (they're there to be learned)."""
    offered = {w.text.casefold() for w in theme.new_words}
    out: list[str] = []
    for line in lines_of(theme):
        for token in checker.segment(line):
            if (
                is_word(token)
                and checker.status(token) != "known"
                and token.casefold() not in offered
                and token not in out
            ):
                out.append(token)
    return out


async def write_themes(
    write: WriteThemes,
    language: Code,
    seeds: Seeds,
    checker: Checker | None = None,
    meanings: dict[str, str] | None = None,
) -> tuple[list[Theme], Usage]:
    """The themes for `seeds`, checked against the words the learner knows (`checker`): when a theme
    uses more unknown words than its level allows, the request goes back once with them named, and
    the answer with more themes, then fewer unknown words, is kept. Each theme carries the unknown
    words it still uses, glossed from `meanings` where it can be. What the calls cost comes back
    with them, or on the failure."""
    limit = MAX_UNKNOWN_STRETCH if seeds.stretch else MAX_UNKNOWN
    glosses = meanings or {}
    used = Usage()
    best: tuple[tuple[int, int], list[Theme]] | None = None
    feedback = ""
    for _ in range(MAX_ATTEMPTS):
        try:
            raw, spent = await write(language, replace(seeds, feedback=feedback))
        except ThemesFailed as e:
            if best is not None:
                return best[1], used + e.usage
            raise ThemesFailed(str(e), used + e.usage) from e
        used = used + spent
        themes = clean_themes(raw, seeds, language)
        if checker is None:
            return themes, used
        unknown = [unknown_in(t, checker) for t in themes]
        marked = [
            # Looked up as the reader looks a word up (`gloss_for`): the meanings are kept in lower case,
            # so a capitalized word (a German noun, a question's first word) would otherwise miss.
            replace(
                t,
                unknown=tuple(
                    Candidate(w, gloss_for(w, {}, checker, glosses) or "") for w in words
                ),
            )
            for t, words in zip(themes, unknown, strict=True)
        ]
        score = (len(marked), -sum(len(words) for words in unknown))
        if best is None or score > best[0]:
            best = (score, marked)
        over = [w for words in unknown if len(words) > limit for w in words]
        if themes and not over:
            break
        if not themes:
            feedback = "That answer had no usable themes. Write them again."
        else:
            feedback = RETRY.format(words=", ".join(list(dict.fromkeys(over))[:MAX_NAMED]))
    assert best is not None
    return best[1], used


def claude_themes(client: anthropic.AsyncAnthropic) -> WriteThemes:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(language: Code, seeds: Seeds) -> tuple[Any, Usage]:
        messages: list[dict[str, Any]] = [{"role": "user", "content": request_message(seeds)}]
        if seeds.feedback:
            messages[0]["content"] += f"\n\n{seeds.feedback}"
        system: list[BetaTextBlockParam] = []
        if seeds.deck:
            system.append(
                {
                    "type": "text",
                    "text": deck_block(language, seeds.deck),
                    "cache_control": {"type": "ephemeral"},
                }
            )
        system.append(
            {
                "type": "text",
                "text": system_message(
                    language,
                    seeds.stretch,
                    bool(seeds.topic),
                    seeds.register,
                    seeds.learner,
                    bool(seeds.facts),
                ),
            }
        )
        try:
            response = await client.with_options(
                timeout=REQUEST_TIMEOUT_SECONDS, max_retries=0
            ).beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
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
