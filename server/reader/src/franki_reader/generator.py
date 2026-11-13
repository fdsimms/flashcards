"""Text generator: Claude writes a short Thai dialogue or story from the deck's known words, the server checks
it, and anything under the coverage floor goes back for revision with the problem words named.

The rules this enforces come from docs/read-and-listen/brief.md (design principles 2, 4, 5 and 8):
- coverage is measured by the server's own segmentation, never by the model's `|` breaks
- 1-3 stretch words, each used 2-3 times; when the model chooses them from a longer list, at least
  one and no more than it was asked for
- at most 3 attempts while a draft is under the floor; then the closest attempt is kept if it's at
  least MINIMUM (85%), and only a text under that is returned as not passed, never shown
- a dialogue says whether each speaker is a man or a woman, and in Thai no line may use a word of
  the other gender (gender.py); a draft that does is never kept, whatever its coverage

The revision loop is written against `Ask`, so it's tested without a key. `claude_ask` is the real
call: the lexicon sits in a cached system prompt, and each revision is appended to the same
conversation (append-only, so the model's thinking stays valid across turns).
"""

import json
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field, replace
from typing import Any, Literal, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam, BetaTextBlockParam

from franki_reader import grammar
from franki_reader.characters import CHARACTERS
from franki_reader.coverage import MINIMUM, Checker, Coverage, check
from franki_reader.difficulty import DEFAULT_FLOOR
from franki_reader.gender import GENDERS, gender_problems
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry

MODEL = "claude-sonnet-5-5"
EFFORT: Literal["low", "medium", "high", "xhigh", "max"] = "high"
MAX_TOKENS = 16000
MAX_ATTEMPTS = 3
MAX_STRETCH = 3
STRETCH_MIN_USES = 2

# Per million tokens: input, output, cache read, cache write (5-minute cache, 1.25x input). A model
# not listed here (a refusal fallback) is priced as MODEL, which is close enough for a running total.
PRICES = {
    "claude-sonnet-5-5": (2.00, 10.00, 0.20, 2.50),
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
    "claude-opus-4-8": (5.00, 25.00, 0.50, 6.25),
}


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    model: str = ""  # the model that actually answered, which a refusal fallback can change

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(
            self.input_tokens + other.input_tokens,
            self.output_tokens + other.output_tokens,
            self.cache_read_tokens + other.cache_read_tokens,
            self.cache_write_tokens + other.cache_write_tokens,
            other.model or self.model,
        )

    def cost_usd(self) -> float:
        inp, out, read, write = PRICES.get(self.model or MODEL, PRICES[MODEL])
        return (
            self.input_tokens * inp
            + self.output_tokens * out
            + self.cache_read_tokens * read
            + self.cache_write_tokens * write
        ) / 1_000_000


# Sent as a list of message dicts; returns the parsed draft, the assistant content to append, and
# the tokens the call used.
Ask = Callable[[list[dict[str, Any]]], Coroutine[Any, Any, tuple[dict[str, Any], list[Any], Usage]]]


class GenerationFailed(Exception):
    """The model refused, ran out of tokens, or returned something unusable."""


# A dialogue between A and B, or a short story told by a narrator (N), one sentence or two a line.
Form = Literal["dialogue", "story"]


@dataclass(frozen=True)
class StoryContext:
    """An episode of an ongoing story (docs/read-and-listen/architecture.md, Stories): the same
    characters and setting from one text to the next, carried by a sentence about each episode."""

    episode: int  # 1 starts the story
    about: str = ""  # what the owner asked it to be about; empty lets the model choose
    title: str = ""  # the story's name, from the first episode on
    cast: str = ""  # its characters and setting, from the first episode
    recaps: tuple[str, ...] = ()  # one sentence for each earlier episode, oldest first


@dataclass(frozen=True)
class TextRequest:
    topic: str
    # The stretch words to use, or with `choose` set, the words to choose them from: the model
    # picks 1 to `choose` of them that fit the topic, so a text about ordering food isn't bent
    # around "tiger" just because it's due.
    stretch: tuple[Entry, ...] = ()
    lines: int = 8
    floor: float = DEFAULT_FLOOR
    # With a ceiling, a draft with more known words than this is too easy and goes back too.
    ceiling: float | None = None
    choose: int | None = None
    form: Form = "dialogue"
    language: Code = "th"
    # How many of the language's most common words count as known (the `common` setting).
    common: int = 0
    # Grammar point ids (grammar.py): used at least twice each, or kept out.
    practice: tuple[str, ...] = ()
    avoid: tuple[str, ...] = ()
    # Known points to work in where they fit, with no minimum and no check (exposure.py).
    review: tuple[str, ...] = ()
    # Points the owner hasn't marked: at most grammar.UNSET_USES uses in all, as they may be new.
    unset: tuple[str, ...] = ()
    story: StoryContext | None = None

    def __post_init__(self) -> None:
        used = len(self.stretch) if self.choose is None else self.choose
        if used > MAX_STRETCH:
            raise ValueError(f"At most {MAX_STRETCH} stretch words per text")
        if self.choose is not None and (self.choose < 1 or not self.stretch):
            raise ValueError("Choosing stretch words needs at least one to choose and a list")


@dataclass(frozen=True)
class Line:
    speaker: str
    text: str  # as the model wrote it: `|` between words, stretch words in asterisks
    english: str
    # A story's line that opens a paragraph. Older texts and dialogues have none.
    paragraph: bool = False


@dataclass(frozen=True)
class Generated:
    title: str
    lines: tuple[Line, ...]
    glosses: dict[str, str]
    coverage: Coverage
    attempts: int
    passed: bool  # shown to the reader: it met the floor, or it's the closest attempt at MINIMUM+
    missing_glosses: tuple[str, ...]
    usage: Usage = Usage()
    stretch: tuple[str, ...] = ()  # the stretch words the text actually uses
    roles: dict[str, str] = field(default_factory=dict)  # speaker -> who they are, e.g. "Waiter"
    # speaker -> "male" or "female", for a dialogue (gender.py picks each one's voice)
    genders: dict[str, str] = field(default_factory=dict)
    # speaker -> one of characters.CHARACTERS, for a dialogue; the app draws it in the speaker's gender
    characters: dict[str, str] = field(default_factory=dict)
    # False when a Thai line uses a word of the other gender than its speaker's, or a dialogue
    # doesn't say who is a man or a woman. Such a draft is never kept.
    gender_ok: bool = True
    floor_met: bool = True  # False for a closest attempt kept under the floor
    # Uses of a practiced point short of the 2 asked for, plus uses of an avoided one. The
    # closest attempt kept under the rules can have some.
    grammar_problems: int = 0
    # The model's transliteration of the words it glossed (Thai only), by word. Absent for a word
    # it gave none for; the reader then shows none rather than a guess.
    translits: dict[str, str] = field(default_factory=dict)
    # A story episode's own sentence about what happened in it, and on the first episode the
    # story's name and cast (StoryContext). Empty for any other text.
    recap: str = ""
    series: str = ""
    cast: str = ""


DRAFT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "roles": {
            "type": "object",
            "properties": {"A": {"type": "string"}, "B": {"type": "string"}},
            "required": ["A", "B"],
            "additionalProperties": False,
        },
        "genders": {
            "type": "object",
            "properties": {
                "A": {"type": "string", "enum": [*GENDERS, "none"]},
                "B": {"type": "string", "enum": [*GENDERS, "none"]},
            },
            "required": ["A", "B"],
            "additionalProperties": False,
        },
        "characters": {
            "type": "object",
            "properties": {
                "A": {"type": "string", "enum": [*CHARACTERS, "none"]},
                "B": {"type": "string", "enum": [*CHARACTERS, "none"]},
            },
            "required": ["A", "B"],
            "additionalProperties": False,
        },
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "speaker": {"type": "string", "enum": ["A", "B", "N"]},
                    "text": {"type": "string"},
                    "english": {"type": "string"},
                    "paragraph": {"type": "boolean"},
                },
                "required": ["speaker", "text", "english", "paragraph"],
                "additionalProperties": False,
            },
        },
        "glosses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "word": {"type": "string"},
                    "english": {"type": "string"},
                    # Optional, and only asked for in Thai's instructions.
                    "translit": {"type": "string"},
                },
                "required": ["word", "english"],
                "additionalProperties": False,
            },
        },
        # Optional, and only asked for in a story episode's request (StoryContext).
        "recap": {"type": "string"},
        "series": {"type": "string"},
        "cast": {"type": "string"},
    },
    "required": ["title", "roles", "genders", "characters", "lines", "glosses"],
    "additionalProperties": False,
}

_INSTRUCTIONS = """\
You write short Thai texts for one learner to read and listen to: dialogues, or short stories. \
They must be built almost entirely from words the learner already knows, which are listed below.

Rules:
- Use only words from the list. A word that appears only inside a longer list entry is not known \
on its own: รับ is not known just because รับอะไรดี is. Every word outside the list makes the text \
harder; the server measures this and sends back any text outside the learner's coverage target, \
too hard or too easy.
- Prefer entries marked M (well known) over Y (still being learned).
- Before you answer, go through your draft word by word and check each one is on the list. Replace \
any that isn't with a listed word or a simpler way of saying it. Getting this right first time \
matters more than a clever text.
- Write natural Thai, the way a Thai speaker would say it, never a word-for-word translation of an \
English phrase or idiom. If an English idea has no plain Thai equivalent, say something else.
- A dialogue is natural, everyday spoken Thai between two speakers, A and B. In "roles", say who \
A and B are in this situation, in one to three English words each, like "Waiter" and "Customer".
- In "genders", say whether A and B are a man or a woman ("male" or "female"). The learner hears a \
man's voice for a man and a woman's voice for a woman, so every line has to fit its speaker. A man \
says ครับ and ผม; a woman says ค่ะ (statements) or คะ (questions) and ดิฉัน, never ครับ or ผม. \
Choose each speaker's gender to suit the situation and vary it from text to text: a man and a \
woman, two men or two women. In a story, set both to "none".
- In "characters", pick the picture shown beside each speaker: parent, grandparent, child, friend, \
waiter, shopkeeper, doctor, teacher, traveler, or person for anyone else. Pick the one nearest \
the role, and "none" for both in a story. The picture is drawn as a man or a woman from "genders", \
so a parent is a father or a mother. Prefer two different characters.
- A story is told by a narrator: every line's speaker is N, each line is one or two simple \
sentences, and the story has a beginning, something that happens, and an end. Keep the language \
plain, since description pulls in words the learner may not know. Leave both roles empty.
- "paragraph" is true on a story line that opens a paragraph: the first line always, then a new \
one at a change of scene, time or subject, usually every two to four lines. It is false on every \
other line, and on every line of a dialogue.
- In each line's text, put | between every word, and wrap each stretch word in asterisks every \
time it appears, like ฉัน|ต้องการ|*น้ำ*.
- Wrap a person's, pet's or place's name in tildes every time it appears, like ~มะลิ~|เป็น|สาว. \
Names don't count against the known-word target, so mark only real names, never ordinary words, \
and use at most 4 different names in a text.
- Where a clause or sentence ends, put a space instead of |, as Thai is written: \
สวัสดี|ครับ ไป|ไหน|มา|ครับ. The voice pauses at each space, so put one at every clause or sentence \
break and nowhere else: never between words of the same clause, never before a particle like \
ครับ, ค่ะ or นะ, and never right after a connective that opens a clause (แล้ว, และ, แต่, หรือ, \
เพราะ, ถ้า): write เขา|ดู|เด็ก แล้ว|เดิน|มา, not เขา|ดู|เด็ก แล้ว เดิน|มา.
- Give "english", a natural English translation of each line.
- In "glosses", give a short English gloss for each stretch word and for every word you used that \
is not in the list, and for each name ("a girl's name"). For each of those words also give "translit", its pronunciation in Latin letters \
with tone marks and a hyphen between syllables, as the learner's own cards write it: \
nǎng-sǔue (หนังสือ), kâao (ข้าว), mâi-pen-rai (ไม่เป็นไร).

Known words, one per line as: word | meaning | M or Y
"""

# Every other language counts as many of its most common words as known as the `common` setting
# says, as well as the deck (spaced.py), and most of the decks hold advanced words, so the list is
# what to recycle rather than the only words allowed. How many common words is in each request, so
# this prefix stays the same, and cached, when the setting changes.
_SPACED_INSTRUCTIONS = """\
You write short {name} texts for one learner to read and listen to: dialogues, or short stories. \
{variety}They must be built almost entirely from words the learner already knows: the words and \
phrases listed below, which are from their own flashcards, and as many of the most common {name} \
words as each request says, in all their forms.

Rules:
- Use the common words the request allows freely, along with words from the list, in any of their \
forms. Every other word makes the text harder; the server measures this and sends back any text \
outside the learner's coverage target, too hard or too easy. When the request allows no common words, use only words from \
the list. A word that appears only inside a longer list phrase is not known on its own.
- Prefer entries marked M (well known) over Y (still being learned).
- Every line must make sense where it is: something a person would really say in that situation, \
following from the line before it. Sense comes before coverage. With few words to work with, choose \
a simple, ordinary situation (greeting, asking, buying, saying what you have or want) rather than \
joining unrelated words into a scene. Never write a line only because its words are allowed.
- Before you answer, go through your draft word by word and check each one is either an allowed \
common word or on the list, then read each line as a native speaker would and rewrite any that \
doesn't make sense. Replace a word that isn't allowed with an allowed word or a simpler way of \
saying it.
- Write natural {name}, the way a native speaker would say it, never a word-for-word translation \
of an English phrase or idiom. If an English idea has no plain {name} equivalent, say something else.
- A dialogue is natural, everyday spoken {name} between two speakers, A and B. In "roles", say \
who A and B are in this situation, in one to three English words each, like "Waiter" and \
"Customer".
- In "genders", say whether A and B are a man or a woman ("male" or "female"). The learner hears a \
man's voice for a man and a woman's voice for a woman, so every line has to fit its speaker: where \
{name} shows the speaker's gender (verb endings, adjectives, participles, titles), use the form for \
that gender. Choose each speaker's gender to suit the situation and vary it from text to text: a \
man and a woman, two men or two women. In a story, set both to "none".
- In "characters", pick the picture shown beside each speaker: parent, grandparent, child, friend, \
waiter, shopkeeper, doctor, teacher, traveler, or person for anyone else. Pick the one nearest \
the role, and "none" for both in a story. The picture is drawn as a man or a woman from "genders", \
so a parent is a father or a mother. Prefer two different characters.
- A story is told by a narrator: every line's speaker is N, each line is one or two simple \
sentences, and the story has a beginning, something that happens, and an end. Leave both roles \
empty.
- "paragraph" is true on a story line that opens a paragraph: the first line always, then a new \
one at a change of scene, time or subject, usually every two to four lines. It is false on every \
other line, and on every line of a dialogue.
- In each line's text, put | between words instead of spaces, keep punctuation on its word, and \
wrap each stretch word or phrase in asterisks every time it appears, like {example} A stretch \
word can be inflected.
- Wrap a person's, pet's or place's name in tildes every time it appears, like ~Kasia~|mieszka. \
Names don't count against the known-word target, so mark only real names, never ordinary words, \
and use at most 4 different names in a text.
- Give "english", a natural English translation of each line.
- In "glosses", give a short English gloss for each stretch word and for every word you used that \
is neither an allowed common word nor on the list. Also gloss any word whose form matches a listed \
word but is used here as a different word, such as a verb form that two verbs share.

The learner's flashcard words, one per line as: word | meaning | M (well known) or Y (still being \
learned)
"""


def _instructions(language: Code) -> str:
    if language == "th":
        return _INSTRUCTIONS
    info = LANGUAGES[language]
    variety = f"{info.variety} " if info.variety else ""
    return _SPACED_INSTRUCTIONS.format(name=info.name, variety=variety, example=info.example)


def system_prompt(entries: list[Entry], language: Code = "th") -> str:
    """The stable, cached part of every request. Sorted by note id so it's byte-identical between
    calls on the same snapshot; anything that varies goes in the user message instead."""
    known = sorted((e for e in entries if e.tier != "unreviewed"), key=lambda e: e.note_id)
    words = "\n".join(
        f"{e.text} | {e.meaning} | {'M' if e.tier == 'mature' else 'Y'}" for e in known
    )
    return _instructions(language) + words


def request_message(request: TextRequest) -> str:
    what = "a dialogue" if request.form == "dialogue" else "a short story"
    parts = [
        f"Topic: {request.topic}",
        f"Write {what} of {request.lines} lines.",
    ]
    if request.language != "th":
        name = LANGUAGES[request.language].name
        parts.append(
            f"Known words: the list, plus the {request.common:,} most common {name} words in all "
            "their forms."
            if request.common
            else "Known words: only the list, in any of their forms. No common words this time."
        )
    source = "common or from the list" if request.common else "from the list"
    if request.ceiling is None:
        parts.append(f"Coverage target: at least {request.floor:.0%} of words {source}.")
    else:
        parts.append(
            f"Coverage target: between {request.floor:.0%} and {request.ceiling:.0%} of words "
            f"{source}. A text with fewer unfamiliar words than that is too easy for the learner: "
            "use natural words outside the list where the topic calls for them, and gloss each one."
        )
    listed = "\n".join(f"- {e.text} ({e.meaning})" for e in request.stretch)
    if request.choose is not None:
        how_many = "1" if request.choose == 1 else f"1 to {request.choose}"
        parts.append(
            f"Stretch words: pick {how_many} of these that fit the topic naturally, and use each "
            "one you pick 2 or 3 times, wrapped in asterisks. Leave the rest out. If none of them fits "
            "a sensible situation with the known words, use fewer, or none:\n" + listed
        )
    elif request.stretch:
        parts.append(
            "Stretch words: use each of these 2 or 3 times, wrapped in asterisks:\n" + listed
        )
    else:
        parts.append("No stretch words this time.")
    if request.story is not None:
        parts.append(_story_part(request.story))
    if request.practice:
        parts.append(
            f"Grammar to practice: use each of these at least {grammar.PRACTICE_USES} times, "
            "where it fits naturally:\n" + _grammar_list(request.practice)
        )
    if request.avoid:
        parts.append(
            "Grammar to avoid: the learner hasn't learned these yet, so don't use them at all; "
            "say it another way:\n" + _grammar_list(request.avoid)
        )
    if request.review:
        parts.append(
            "Grammar the learner knows and hasn't met in a while: work these in where they fit "
            "naturally, without forcing them:\n" + _grammar_list(request.review)
        )
    if request.unset:
        parts.append(
            "Grammar the learner may not know yet: use these at most "
            f"{grammar.UNSET_USES} times in the whole text, all of them together, or not at all; "
            "the reader explains any that appear:\n" + _grammar_list(request.unset)
        )
    return "\n".join(parts)


# Earlier episodes beyond this many are left out of the request: the cast and the latest ones
# carry the story, and the request stays short.
STORY_RECAPS = 12


def _story_part(story: StoryContext) -> str:
    if story.episode == 1:
        about = f"It's about: {story.about}" if story.about else "Choose what it's about yourself."
        return (
            "This is the first episode of an ongoing story that will run for many episodes, one "
            f"text at a time. {about} Invent two to four characters with names and a place they "
            "keep coming back to, and end the episode with something that can carry on next time. "
            'In "series", give the story a short English name. In "cast", describe the characters '
            'and the setting in one or two English sentences. In "recap", say in one English '
            "sentence what happens in this episode, naming the characters."
        )
    recent = story.recaps[-STORY_RECAPS:]
    so_far = "\n".join(f"- {r}" for r in recent) if recent else "- (no summary)"
    return (
        f'This is episode {story.episode} of an ongoing story, "{story.title}". Keep the same '
        "characters and setting, and pick up where the last episode ended; something new happens "
        "in this one.\n"
        f"Characters and setting: {story.cast or 'as in the earlier episodes'}\n"
        f"The story so far, one sentence an episode:\n{so_far}\n"
        'In "recap", say in one English sentence what happens in this episode, naming the '
        'characters. Leave "series" and "cast" empty.'
    )


def _grammar_list(point_ids: tuple[str, ...]) -> str:
    return "\n".join(f"- {grammar.POINTS[p].name} ({grammar.POINTS[p].note})" for p in point_ids)


def grammar_problems(
    lines: list[str], lexicon: Checker, request: TextRequest
) -> tuple[list[str], int]:
    """What's wrong with a draft's grammar, as sentences for the revision message, and how much:
    each use short of a practiced point, plus each use of an avoided one, plus each use of a
    point that isn't set past the few allowed."""
    found = grammar.find_in_lines(lines, lexicon, request.practice + request.avoid + request.unset)
    problems = []
    misses = 0
    for pid in request.practice:
        if (n := len(found[pid])) < grammar.PRACTICE_USES:
            misses += grammar.PRACTICE_USES - n
            problems.append(
                f"Use the {grammar.POINTS[pid].name} at least {grammar.PRACTICE_USES} times; "
                f"this draft uses it {n} {'time' if n == 1 else 'times'}."
            )
    for pid in request.avoid:
        if used := found[pid]:
            misses += len(used)
            problems.append(
                f"Don't use the {grammar.POINTS[pid].name}; this draft has: "
                + ", ".join(dict.fromkeys(used))
                + ". Say those another way."
            )
    unset = [(pid, w) for pid in request.unset for w in found[pid]]
    if (n := len(unset)) > grammar.UNSET_USES:
        misses += n - grammar.UNSET_USES
        problems.append(
            f"Use grammar the learner may not know at most {grammar.UNSET_USES} times in all; "
            "this draft has: "
            + "; ".join(
                f"{grammar.POINTS[pid].name} ({', '.join(dict.fromkeys(w for p, w in unset if p == pid))})"
                for pid in dict.fromkeys(pid for pid, _ in unset)
            )
            + ". Say some of those another way."
        )
    return problems, misses


def revision_message(
    coverage: Coverage, problems: list[str], floor: float, ceiling: float | None = None
) -> str:
    """`problems` are the stretch word and grammar problems, as sentences."""
    if ceiling is not None and coverage.ratio > ceiling:
        parts = [
            (
                f"This draft is {coverage.ratio:.1%} known words, which is too easy; the target is "
                f"between {floor:.0%} and {ceiling:.0%}."
            ),
            *problems,
            (
                "Rewrite the whole text on the same topic with more natural words that aren't in the "
                "list where the topic calls for them, and add a gloss for each. Return the full text "
                "again in the same format."
            ),
        ]
        return " ".join(parts)
    parts = [
        f"This draft is {coverage.ratio:.1%} known words; the target is at least {floor:.0%}."
        if coverage.ratio < floor
        else f"Coverage is fine ({coverage.ratio:.1%})."
    ]
    if unknown := coverage.words("unknown"):
        parts.append("These words are not in the list: " + ", ".join(unknown) + ".")
    if partial := coverage.words("partial"):
        parts.append(
            "These only appear inside longer list entries, so they don't count as known: "
            + ", ".join(partial)
            + "."
        )
    parts.extend(problems)
    parts.append(
        "Rewrite the whole text on the same topic so it fixes this, replacing words with ones "
        "from the list. Return the full text again in the same format."
    )
    return " ".join(parts)


async def generate(ask: Ask, lexicon: Checker, request: TextRequest) -> Generated:
    messages: list[dict[str, Any]] = [{"role": "user", "content": request_message(request)}]
    result: Generated | None = None
    best: Generated | None = None  # the attempt with the highest coverage, the later one on a tie
    usage = Usage()
    for attempt in range(1, MAX_ATTEMPTS + 1):
        draft, content, used = await ask(messages)
        usage += used
        result, problems = _assess(draft, lexicon, request, attempt)
        result = replace(result, usage=usage)
        if result.passed:
            return result
        # Fewer grammar problems first, then closer to the target; the later attempt on a tie.
        rank = (-result.grammar_problems, _closeness(result.coverage.ratio, request))
        if result.gender_ok and (
            best is None
            or rank >= (-best.grammar_problems, _closeness(best.coverage.ratio, request))
        ):
            best = result
        if attempt < MAX_ATTEMPTS:
            messages.append({"role": "assistant", "content": content})
            messages.append(
                {
                    "role": "user",
                    "content": revision_message(
                        result.coverage, problems, request.floor, request.ceiling
                    ),
                }
            )
    assert result is not None
    if best is None:
        # Every attempt had a line that doesn't fit its speaker's gender: none is kept, whatever
        # its coverage. It's returned as not passed, so it's stored as dropped and never served.
        return replace(result, passed=False)
    if best.coverage.ratio >= MINIMUM:
        # Every attempt missed (the floor, or only a stretch word rule): keep the closest one.
        return replace(
            best,
            passed=True,
            floor_met=best.coverage.meets(request.floor),
            attempts=result.attempts,
            usage=usage,
        )
    return result


def _paragraphs(lines: tuple[Line, ...], form: Form) -> tuple[Line, ...]:
    """A story's paragraph marks, made consistent: the first line opens a paragraph whenever any
    line does, and a dialogue has none."""
    if form != "story" or not any(ln.paragraph for ln in lines):
        return tuple(replace(ln, paragraph=False) for ln in lines)
    return (replace(lines[0], paragraph=True), *lines[1:])


def _closeness(ratio: float, request: TextRequest) -> float:
    """How good a draft's coverage is for choosing the closest attempt: the ratio itself with no
    ceiling, else minus how far it is outside the target range (0 inside it)."""
    if request.ceiling is None:
        return ratio
    return -max(request.floor - ratio, ratio - request.ceiling, 0.0)


def _assess(
    draft: dict[str, Any], lexicon: Checker, request: TextRequest, attempt: int
) -> tuple[Generated, list[str]]:
    try:
        lines = _paragraphs(
            tuple(
                Line(ln["speaker"], ln["text"], ln["english"], bool(ln.get("paragraph")))
                for ln in draft["lines"]
            ),
            request.form,
        )
        glosses = {g["word"]: g["english"] for g in draft["glosses"]}
        translits = {
            g["word"]: g["translit"].strip()
            for g in draft["glosses"]
            if isinstance(g.get("translit"), str) and g["translit"].strip()
        }
        title = draft["title"]
        roles = {k: str(v).strip() for k, v in draft.get("roles", {}).items() if str(v).strip()}
        genders = {
            k: v
            for k, v in (draft.get("genders") or {}).items()
            if k in ("A", "B") and v in GENDERS
        }
        characters = {
            k: v
            for k, v in (draft.get("characters") or {}).items()
            if k in ("A", "B") and v in CHARACTERS
        }
        recap, series, cast_ = (
            str(draft.get(k) or "").strip() for k in ("recap", "series", "cast")
        )
    except (KeyError, TypeError) as e:
        raise GenerationFailed(f"The draft is missing a field: {e}") from e
    if not lines:
        raise GenerationFailed("The draft has no lines")

    coverage = check([ln.text for ln in lines], lexicon)
    used, problems = _stretch_used(coverage, request, lexicon)
    if request.form == "story":
        genders = {}  # a story has only its narrator
        characters = {}
        gender_issues: list[str] = []
    elif set(genders) != {"A", "B"}:
        gender_issues = ['Say in "genders" whether A and B are a man or a woman.']
    else:
        gender_issues = gender_problems(
            request.language, [(ln.speaker, ln.text) for ln in lines], genders
        )
    problems += gender_issues
    problems += name_problems(coverage, lexicon.spaced)
    grammar_issues, grammar_misses = grammar_problems([ln.text for ln in lines], lexicon, request)
    problems += grammar_issues
    # Stretch words are glossed from the deck, so only off-list words need the model's gloss.
    for word in used:
        glosses.setdefault(word.text, word.meaning)
    missing = tuple(
        w for w in coverage.words("unknown") + coverage.words("partial") if w not in glosses
    )
    in_range = request.ceiling is None or coverage.ratio <= request.ceiling
    passed = coverage.meets(request.floor) and in_range and not problems
    stretch = tuple(e.text for e in used)
    generated = Generated(
        title,
        lines,
        glosses,
        coverage,
        attempt,
        passed,
        missing,
        stretch=stretch,
        roles=roles,
        genders=genders,
        characters=characters,
        gender_ok=not gender_issues,
        grammar_problems=grammar_misses,
        translits=translits,
        recap=recap,
        series=series,
        cast=cast_,
    )
    return generated, problems


MAX_NAMES = 4


def name_problems(coverage: Coverage, spaced: bool) -> list[str]:
    """What's wrong with the names a draft marked, as sentences for the revision message. Names
    leave the coverage count, so they're limited and, where the language capitalizes them, checked,
    or the model could mark hard words as names to get past the floor."""
    problems = []
    if len(coverage.names) > MAX_NAMES:
        problems.append(
            f"Mark at most {MAX_NAMES} different names; this draft marks "
            + ", ".join(coverage.names)
            + "."
        )
    if spaced and (lower := [n for n in coverage.names if not n[:1].isupper()]):
        problems.append(
            "Only names that start with a capital letter can be marked with tildes: "
            + ", ".join(lower)
            + "."
        )
    return problems


def _stretch_used(
    coverage: Coverage, request: TextRequest, lexicon: Checker
) -> tuple[list[Entry], list[str]]:
    """The stretch words the draft uses, and what's wrong with how it uses them, as sentences for
    the revision message. A chosen word is one of the offered words the draft put in asterisks."""
    if request.choose is None:
        used = list(request.stretch)
    else:
        # A marked word counts as the entry it's a form of: mantuvimos a raya as mantener a raya.
        marked = {lexicon.entry_of(w) or w for w in coverage.stretch_words}
        used = [e for e in request.stretch if e.text in marked]
    problems = []
    if request.choose is not None and not used:
        problems.append(
            "No stretch word from the list was used. Pick at least one and wrap it in asterisks."
        )
    if request.choose is not None and len(used) > request.choose:
        problems.append(
            f"Use at most {request.choose} stretch words; this draft uses "
            + ", ".join(e.text for e in used)
            + "."
        )
    uses = {
        e.text: sum(1 for t in coverage.tokens if (lexicon.entry_of(t.text) or t.text) == e.text)
        for e in used
    }
    if short := [word for word, n in uses.items() if n < STRETCH_MIN_USES]:
        problems.append("These stretch words appear fewer than 2 times: " + ", ".join(short) + ".")
    return used, problems


def claude_ask(
    client: anthropic.AsyncAnthropic, entries: list[Entry], language: Code = "th"
) -> Ask:
    system: list[BetaTextBlockParam] = [
        {
            "type": "text",
            "text": system_prompt(entries, language),
            "cache_control": {"type": "ephemeral"},
        }
    ]
    output_config: BetaOutputConfigParam = {
        "effort": EFFORT,
        "format": {"type": "json_schema", "schema": DRAFT_SCHEMA},
    }

    async def ask(messages: list[dict[str, Any]]) -> tuple[dict[str, Any], list[Any], Usage]:
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
            # Overloaded, rate limited, unreachable: say so rather than failing the request.
            raise GenerationFailed(f"Claude didn't answer ({type(e).__name__})") from e
        if response.stop_reason == "refusal":
            raise GenerationFailed("Claude declined to write this text")
        if response.stop_reason == "max_tokens":
            raise GenerationFailed("The response was cut off")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise GenerationFailed("The response had no text")
        try:
            draft = json.loads(text)
        except json.JSONDecodeError as e:
            raise GenerationFailed("The response wasn't valid JSON") from e
        u = response.usage
        used = Usage(
            u.input_tokens,
            u.output_tokens,
            u.cache_read_input_tokens or 0,
            u.cache_creation_input_tokens or 0,
            response.model,
        )
        return draft, list(response.content), used

    return ask
