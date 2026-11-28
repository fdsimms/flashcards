"""Text generator: Claude writes a short Thai dialogue or story from the deck's known words, the server checks
it, and anything under the coverage floor goes back for revision with the problem words named.

The rules this enforces come from docs/read-and-listen/brief.md (design principles 2, 4, 5 and 8):
- coverage is measured by the server's own segmentation, never by the model's `|` breaks
- 1-4 stretch words, each used once or twice (twice for a word that's harder to take in: several
  forms or senses, or a longer phrase); when the model chooses them from a longer list, at least
  one and no more than it was asked for
- at most 3 attempts while a draft is under the floor; then the closest attempt is kept if it's at
  least MINIMUM (85%), and only a text under that is returned as not passed, never shown
- words outside the deck are spread out: no more than 2 in any 10 words, a soft rule that sends a
  draft back but never drops a text (crowding.py)
- a dialogue says whether each speaker is a man or a woman, and in Thai no line may use a word of
  the other gender (gender.py); a draft that does is never kept, whatever its coverage

The revision loop is written against `Ask`, so it's tested without a key. `claude_ask` is the real
call: the lexicon sits in a cached system prompt, and each revision is appended to the same
conversation (append-only, so the model's thinking stays valid across turns).
"""

import json
import logging
from collections.abc import Callable, Coroutine, Iterable
from dataclasses import dataclass, field, replace
from typing import Any, Literal, cast

import anthropic
from anthropic.types.beta import (
    BetaMessage,
    BetaMessageParam,
    BetaOutputConfigParam,
    BetaTextBlockParam,
)

from franki_reader import grammar, xray
from franki_reader.cast import (
    AGES,
    Speaker,
    find,
    parse_speakers,
    quotation_texts,
    quote_problems,
)
from franki_reader.characters import CHARACTERS
from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import MINIMUM, Checker, Coverage, check, line_names, parse_line
from franki_reader.crowding import crowding
from franki_reader.difficulty import DEFAULT_FLOOR
from franki_reader.gender import (
    GENDERS,
    gender_problems,
    polite_i_problems,
    quote_gender_problems,
)
from franki_reader.genre import DEFAULT as DEFAULT_GENRE
from franki_reader.genre import Genre
from franki_reader.genre import instruction as genre_instruction
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry
from franki_reader.met import MetWord
from franki_reader.register import DEFAULT as DEFAULT_REGISTER
from franki_reader.register import Register, instruction

# The models a text can be asked to be written by (the shelf's "Written by").
TextModel = Literal["claude-sonnet-5-5", "claude-haiku-5-5"]
MODEL: TextModel = "claude-sonnet-5-5"
# For short, checked or low-stakes calls (glosses, word forms, IPA, hints, questions). Haiku has no
# server-side refusal fallback, so calls to it send none and handle stop_reason "refusal" themselves.
CHEAP_MODEL: TextModel = "claude-haiku-5-5"

# What every prompt that asks for an English rendering says about its shape: a language with no
# tenses (Thai) otherwise comes back in the present, with the source's word order.
NATURAL_ENGLISH = (
    "Write it the way a native English speaker would say it: pick the English tense, articles and "
    "word order the sentence needs, even where the language marks none of them (a language without "
    'tenses still gives English a future for "tomorrow", a past for "yesterday"), and never carry '
    "the source's word order or structure over."
)
Effort = Literal["low", "medium", "high", "xhigh", "max"]
EFFORT: Effort = "high"
# A story episode also returns a recap, a season plan, choices and new speakers, so it thinks less
# per draft to leave room for them.
STORY_EFFORT: Effort = "medium"
# Thinking counts against max_tokens, so a draft that thinks long can run out before its JSON ends.
# A response cut off at MAX_TOKENS is asked once more at RETRY_EFFORT with RETRY_MAX_TOKENS.
MAX_TOKENS = 32000
RETRY_EFFORT: Effort = "medium"
RETRY_MAX_TOKENS = 48000
# The SDK refuses a non-streaming call whose max_tokens could take over 10 minutes unless it's given
# a timeout of its own; 48,000 tokens at the slowest speed seen is well inside this.
REQUEST_TIMEOUT_SECONDS = 1200.0
log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
MAX_STRETCH = 4
STRETCH_MIN_USES = 1
# How a line is said; the app shows it as a chip on the line.
REGISTERS = ("casual", "neutral", "formal", "slang")

# Per million tokens: input, output, cache read, cache write (5-minute cache, 1.25x input). A model
# not listed here (a refusal fallback) is priced as MODEL, which is close enough for a running total.
PRICES = {
    "claude-sonnet-5-5": (2.00, 10.00, 0.20, 2.50),
    # Prompts over 100K tokens cost $0.50 / $2.50, which none of the calls to it reach. The cache
    # figures are the usual 0.1x read and 1.25x write of the input price, not read off a price list.
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
    "claude-opus-4-8": (5.00, 25.00, 0.50, 6.25),
}


def prices_of(model: str) -> tuple[float, float, float, float]:
    """A model's prices, found by its name with any date after it (claude-haiku-5-5-20261101 is
    claude-haiku-5-5's), else MODEL's: a dated id missed the table and was priced as Sonnet."""
    if model in PRICES:
        return PRICES[model]
    named = [name for name in PRICES if model.startswith(name + "-")]
    return PRICES[max(named, key=len)] if named else PRICES[MODEL]


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    model: str = ""  # the model that actually answered, which a refusal fallback can change
    # A sum's cost, each part priced at its own model: the tokens are added up, but a fallback can
    # have answered one call on another model, and pricing them all at the last one's rate was wrong.
    usd: float | None = field(default=None, compare=False)

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(
            self.input_tokens + other.input_tokens,
            self.output_tokens + other.output_tokens,
            self.cache_read_tokens + other.cache_read_tokens,
            self.cache_write_tokens + other.cache_write_tokens,
            other.model or self.model,
            self.cost_usd() + other.cost_usd(),
        )

    def cost_usd(self) -> float:
        if self.usd is not None:
            return self.usd
        inp, out, read, write = prices_of(self.model or MODEL)
        return (
            self.input_tokens * inp
            + self.output_tokens * out
            + self.cache_read_tokens * read
            + self.cache_write_tokens * write
        ) / 1_000_000


def usage_of(response: BetaMessage) -> Usage:
    """What a response from Claude was billed for, whatever came of it: a refusal, an answer cut
    off or one that can't be read is paid for like any other, so each caller keeps this even when
    it raises."""
    u = response.usage
    return Usage(
        u.input_tokens,
        u.output_tokens,
        u.cache_read_input_tokens or 0,
        u.cache_creation_input_tokens or 0,
        response.model,
    )


# Sent as a list of message dicts; returns the parsed draft, the assistant content to append, and
# the tokens the call used.
Ask = Callable[[list[dict[str, Any]]], Coroutine[Any, Any, tuple[dict[str, Any], list[Any], Usage]]]


class GenerationFailed(Exception):
    """The model refused, ran out of tokens, or returned something unusable. `usage` is what the
    failed call was billed for, when it got an answer at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# A dialogue between A and B, or a short story told by a narrator (N), one sentence or two a line.
Form = Literal["dialogue", "story"]


# A story runs in seasons of this many episodes, each building to a finale, and the episode after
# a finale opens a new season with the same characters.
SEASON_EPISODES = 8


@dataclass(frozen=True)
class StoryContext:
    """An episode of an ongoing story (docs/read-and-listen/architecture.md, Stories): the same
    characters and setting from one text to the next, carried by a sentence about each episode."""

    episode: int  # 1 starts the story
    about: str = ""  # what the owner asked it to be about; empty lets the model choose
    title: str = ""  # the story's name, from the first episode on
    cast: str = ""  # its characters and setting, from the first episode
    recaps: tuple[str, ...] = ()  # one sentence for each earlier episode, oldest first
    # The last lines of the previous episode in English. A recap is a sentence or two, so on its
    # own it drops the small state the episode ended on (a cake still baking), and the next
    # episode contradicted it.
    ending: tuple[str, ...] = ()
    # The English of what the reader chose at the end of the last episode, if they chose.
    chosen: str = ""
    # Where the model last said the season was heading, replaced by every episode's own.
    plan: str = ""
    # The characters who already have a voice in the story (cast.py): they're kept for good, so
    # an episode lists only the speakers it adds.
    speakers: tuple[Speaker, ...] = ()
    # The characters recorded so far, as "Name: what's known", for X-Ray (xray.py).
    known: tuple[str, ...] = ()
    # The names the language's other stories already use, one entry per story, so this one's
    # characters don't repeat them (a second series came out with the first one's Mali).
    taken: tuple[str, ...] = ()
    # The names the earlier episodes mark in their lines, each spelling with how many episodes
    # used it, most used first. The cast, recaps and voices are all in English, so without these an
    # episode spelled a name afresh (มะลิ, then มาลี; ไฝ, then ฝ้าย and ไฟ, "fire").
    names: tuple[tuple[str, int], ...] = ()
    # The latest episodes' titles, so a new one doesn't repeat one (two episodes were แหวนสองวง).
    titles: tuple[str, ...] = ()

    @property
    def season(self) -> int:
        return (self.episode - 1) // SEASON_EPISODES + 1

    @property
    def season_episode(self) -> int:
        """This episode's place in its season, 1 to SEASON_EPISODES."""
        return (self.episode - 1) % SEASON_EPISODES + 1


@dataclass(frozen=True)
class Choice:
    """One thing the reader can pick to happen in a story's next episode. Written and checked like
    a line: `|` between words, counted in the text's coverage."""

    text: str
    english: str


# How many choices an episode ends with, at least and at most. Fewer than the least is no choice.
MIN_CHOICES = 2
MAX_CHOICES = 3


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
    # Points the owner hasn't marked: at most `unset_uses` uses in all, as they may be new.
    unset: tuple[str, ...] = ()
    unset_uses: int = grammar.UNSET_USES
    story: StoryContext | None = None
    # What really happened, for a text on the owner's own day: written from, never contradicted.
    about: str = ""
    # What kind of text it is (genre.py); "any" asks for nothing, as before the choice existed.
    genre: Genre = DEFAULT_GENRE
    # The Settings register (register.py). Each line still carries its own register label, chosen
    # by who is talking to whom, so this sets the baseline and the default asks for nothing extra.
    register: Register = DEFAULT_REGISTER
    # Words outside the deck the learner looked up in earlier texts, to bring back where one fits
    # (met.py). Still unfamiliar words: they count against the coverage target.
    met: tuple[MetWord, ...] = ()

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
    # How a native speaker would say it in that situation, one of REGISTERS. Empty for a text
    # written before the model was asked, and for an answer outside the list.
    register: str = ""
    # A story episode's line: who says each quotation in it, in order, by the name of a character
    # (cast.py). Empty for a line with none, for a dialogue and for an older text.
    quotes: tuple[str, ...] = ()


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
    roles: dict[str, str] = field(default_factory=dict)  # name, job first: "Waiter Nok"
    # speaker -> "male" or "female", for a dialogue (gender.py picks each one's voice)
    genders: dict[str, str] = field(default_factory=dict)
    # speaker -> one of characters.CHARACTERS, for a dialogue; the app draws it in the speaker's gender
    characters: dict[str, str] = field(default_factory=dict)
    # False when a Thai line uses a word of the other gender than its speaker's, or a dialogue
    # doesn't say who is a man or a woman. Such a draft is never kept.
    gender_ok: bool = True
    # False when it marks too many names, or words that can't be names. Names leave the coverage
    # count, so such a draft's coverage isn't to be trusted, and it's never kept as the closest.
    names_ok: bool = True
    floor_met: bool = True  # False for a closest attempt kept under the floor
    # Uses of a practiced point short of the 2 asked for, plus uses of an avoided one. The
    # closest attempt kept under the rules can have some.
    grammar_problems: int = 0
    # Crowded stretches of new words (crowding.py): the closest attempt is kept if no attempt has none.
    crowded: int = 0
    # What was wrong with this draft besides its coverage, as the sentences a revision is sent
    # (stretch words, gender, names, grammar, crowding); `drop_reasons` adds the coverage.
    problems: tuple[str, ...] = ()
    # The model's transliteration of the words it glossed (Thai only), by word. Absent for a word
    # it gave none for; the reader then shows none rather than a guess.
    translits: dict[str, str] = field(default_factory=dict)
    # A story episode's own sentence about what happened in it, and on the first episode the
    # story's name and cast (StoryContext). Empty for any other text.
    recap: str = ""
    series: str = ""
    cast: str = ""
    # Where the season is heading, in a few sentences, as of this episode (StoryContext.plan).
    plan: str = ""
    # The recap as the reader sees it on the shelf: a line in the text's language (`|` between
    # words, counted in coverage) and its English. Empty when the model gave none.
    recap_line: str = ""
    recap_english: str = ""
    # What the reader may pick to happen next, for a story episode that ends on a choice.
    choices: tuple[Choice, ...] = ()
    # The characters this story episode adds to the story's cast: those who speak in it and had no
    # voice yet (StoryContext.speakers).
    speakers: tuple[Speaker, ...] = ()
    # What this story episode tells about its characters (xray.parse_characters): (name, fact, the
    # episode a character first appeared in, asked only when the story has none recorded).
    xray: tuple[tuple[str, str, int | None], ...] = ()
    # The title in English, shown under it on the shelf's cover. Empty when the model gave none.
    title_english: str = ""


DRAFT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "title_english": {"type": "string"},
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
                    "register": {"type": "string", "enum": list(REGISTERS)},
                    # Optional, and only asked for in a story episode's request.
                    "quotes": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["speaker", "text", "english", "paragraph", "register"],
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
        "plan": {"type": "string"},
        "xray": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "fact": {"type": "string"},
                    "since": {"type": "integer"},
                },
                "required": ["name", "fact"],
                "additionalProperties": False,
            },
        },
        "speakers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "gender": {"type": "string", "enum": list(GENDERS)},
                    "age": {"type": "string", "enum": list(AGES)},
                },
                "required": ["name", "gender", "age"],
                "additionalProperties": False,
            },
        },
        "recap_line": {
            "type": "object",
            "properties": {"text": {"type": "string"}, "english": {"type": "string"}},
            "required": ["text", "english"],
            "additionalProperties": False,
        },
        "choices": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"text": {"type": "string"}, "english": {"type": "string"}},
                "required": ["text", "english"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "title_english", "roles", "genders", "characters", "lines", "glosses"],
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
- Spread the words that are not on the list out: never more than two in any ten words, and never \
two in a row. Each one needs known words around it for the learner to work out its meaning from.
- Put each stretch word, and each word that is not on the list, where the line itself shows what it \
means, using words the learner knows: say what it goes with or what it does (a fire before its \
sparks, a coat before its hood). A short clue is enough; never explain the word. Use a stretch word \
a second time in a different situation.
- Every line must be a complete, grammatical Thai sentence, however simple. Never leave out a \
classifier, particle, auxiliary or connective to fit a listed word in, and never string listed \
words together as a list or a fragment. A word that grammar needs is worth more than coverage: add \
it even when it is not on the list, and gloss it. The learner can look it up, but they can't learn \
from a sentence that isn't Thai.
- Before you answer, go through your draft word by word and check each one is on the list. Replace \
any that isn't with a listed word or a simpler way of saying it, unless the line needs that word to \
be grammatical. Getting this right first time matters more than a clever text.
- Write natural Thai, the way a Thai speaker would say it, never a word-for-word translation of an \
English phrase or idiom. If an English idea has no plain Thai equivalent, say something else. Pair \
each verb with the nouns Thai uses it with (นั่ง|เรือ and นั่ง|รถ for riding in a boat or a car; \
ขี่ only for a bicycle, a motorbike or a horse), and say that a person does something where Thai \
does, not a part of them (เขา|ยิ้ม, not หน้า|ของ|เขา|ยิ้ม).
- A dialogue is natural, everyday spoken Thai between two speakers, A and B. In "roles", give \
each speaker a first name, written in Latin letters, that suits the speaker and the language, like \
"Nok" and "Somchai". Where the situation gives them a job (waiter, shopkeeper, doctor, teacher), put it \
before the name, like "Waiter Nok". A friend, relative or stranger is only a name. Use two \
different names.
- In "genders", say whether A and B are a man or a woman ("male" or "female"). The learner hears a \
man's voice for a man and a woman's voice for a woman, so every line has to fit its speaker. A man \
says ผม and ครับ; a woman says ฉัน (ดิฉัน when formal) and ค่ะ (statements) or คะ (questions), \
never ครับ or ผม. \
Choose each speaker's gender to suit the situation and vary it from text to text: a man and a \
woman, two men or two women. In a story, set both to "none".
- In "characters", pick the picture shown beside each speaker: parent, grandparent, child, friend, \
waiter, shopkeeper, doctor, teacher, traveler, or person for anyone else. Pick the one nearest \
the role, and "none" for both in a story. The picture is drawn as a man or a woman from "genders", \
so a parent is a father or a mother. Prefer two different characters.
- Polite particles follow who is talking to whom, in a dialogue and in a story's quotations \
alike: ครับ, and ค่ะ or คะ, to a stranger, a customer, an elder or anyone the speaker is being \
polite to. A parent talking to their own child calls themselves แม่ or พ่อ and ends with นะ or จ้ะ, \
or with no particle; children and close friends often leave the particle out. Never add ครับ or ค่ะ \
to a line out of habit.
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
- Introduce every name where it first appears, so the learner never meets one out of nowhere: say \
who it is the first time (เด็ก|ผู้ชาย|ชื่อ|~ต้น~, "a boy named Ton"), and use the name for that same \
person afterward. Never call someone "the boy" and then switch to a name with nothing linking them.
- A name fits where the person is from: someone from another country has a name from that \
country, never a Thai one (a man from England is James, not ต้น). Give a Thai name only to a \
person from Thailand.
- Where a clause or sentence ends, put a space instead of |, as Thai is written: \
สวัสดี|ครับ ไป|ไหน|มา|ครับ. The voice pauses at each space, so put one at every clause or sentence \
break and nowhere else: never between words of the same clause, never before a particle like \
ครับ, ค่ะ or นะ, and never right after a connective that opens a clause (แล้ว, และ, แต่, หรือ, \
เพราะ, ถ้า, ก็, จึง): write เขา|ดู|เด็ก แล้ว|เดิน|มา, not เขา|ดู|เด็ก แล้ว เดิน|มา.
- Give "title_english", a natural English translation of the title.
- Give "english", a natural English translation of each line. {natural_english}
- Give "register" for each line: how a native speaker would say it in that situation: \
"casual" (everyday speech with friends or family), "neutral", "formal" (polite, official or written) \
or "slang". Write each line in its register, so a chat between friends is casual, and a story's \
narrator is usually neutral.
- In "glosses", give a short English gloss for each stretch word and for every word you used that \
is not in the list, and for each name ("a girl's name"). Also gloss every word you join from two or \
more list words, like เข้าใจ ("understand", from เข้า and ใจ) or หน้าที่ ("duty", from หน้า and ที่): \
such a word often means something its parts don't. For each of those words also give "translit", its pronunciation in Latin letters \
with tone marks and a hyphen between syllables, as the learner's own cards write it: \
nǎng-sǔue (หนังสือ), kâao (ข้าว), mâi-pen-rai (ไม่เป็นไร).

Known words, one per line as: word | meaning | M or Y
"""

# Every other language counts as many of its most common words as known as the `common` setting
# says, as well as the deck (spaced.py, japanese.py), and most of the decks hold advanced words, so the list is
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
- Spread the words that are neither allowed common words nor on the list out: never more than two \
in any ten words, and never two in a row. Each one needs known words around it for the learner to \
work out its meaning from.
- Put each stretch word, and each word that is neither an allowed common word nor on the list, where \
the line itself shows what it means, using words the learner knows: say what it goes with or what it \
does (a fire before its sparks, a coat before its hood). A short clue is enough; never explain the \
word. Use a stretch word a second time in a different situation.
- Every line must make sense where it is: something a person would really say in that situation, \
following from the line before it. Sense comes before coverage. With few words to work with, choose \
a simple, ordinary situation (greeting, asking, buying, saying what you have or want) rather than \
joining unrelated words into a scene. Never write a line only because its words are allowed.
- Every line must be a complete, grammatical {name} sentence, however simple. Never leave out a \
preposition, article, auxiliary, conjunction or ending to fit a listed word in, and never string \
listed words together as a list or a fragment. A word that grammar needs is worth more than \
coverage: add it even when it is neither an allowed common word nor on the list, and gloss it. \
The learner can look it up, but they can't learn from a sentence that isn't {name}.
- Before you answer, go through your draft word by word and check each one is either an allowed \
common word or on the list, then read each line as a native speaker would and rewrite any that \
doesn't make sense or isn't grammatical. Replace a word that isn't allowed with an allowed word or \
a simpler way of saying it, unless the line needs that word to be grammatical.
- Write natural {name}, the way a native speaker would say it, never a word-for-word translation \
of an English phrase or idiom. If an English idea has no plain {name} equivalent, say something else.
- A dialogue is natural, everyday spoken {name} between two speakers, A and B. In "roles", give \
each speaker a first name, written in Latin letters, that suits the speaker and {name}, like \
"Camille" and "Luc". Where the situation gives them a job (waiter, shopkeeper, doctor, teacher), put it \
before the name, like "Waiter Luc". A friend, relative or stranger is only a name. Use two \
different names.
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
- In each line's text, {writing}, and wrap each stretch word or phrase in asterisks every time it \
appears, like {example} A stretch word can be inflected.
- Wrap a person's, pet's or place's name in tildes every time it appears, like ~Kasia~|mieszka. \
Names don't count against the known-word target, so mark only real names, never ordinary words, \
and use at most 4 different names in a text.
- Introduce every name where it first appears, so the learner never meets one out of nowhere: say \
who it is the first time (a girl named Kasia, a dog called Burek), and use the name for that same \
person afterward. Never call someone "the boy" and then switch to a name with nothing linking them.
- A name fits where the person is from: someone from another country has a name from that \
country, never a {name} one (a man from England is James, not a {name} name). A {name} name \
means a person from where {name} is spoken.
- Give "title_english", a natural English translation of the title.
- Give "english", a natural English translation of each line. {natural_english}
- Give "register" for each line: how a native speaker would say it in that situation: \
"casual" (everyday speech with friends or family), "neutral", "formal" (polite, official or written) \
or "slang". Write each line in its register, so a chat between friends is casual, and a story's \
narrator is usually neutral.
- In "glosses", give a short English gloss for each stretch word and for every word you used that \
is neither an allowed common word nor on the list. Also gloss any word whose form matches a listed \
word but is used here as a different word, such as a verb form that two verbs share. A gloss is \
the word's own meaning: leave out a preposition or auxiliary that goes with it in the line ("hoods", \
not "in hoods"; "eaten", not "has eaten"), since that is a word of its own.

The learner's flashcard words, one per line as: word | meaning | M (well known) or Y (still being \
learned)
"""


# The Thai text has braces of its own, so it is filled by name rather than with `format`.
_THAI_INSTRUCTIONS = _INSTRUCTIONS.replace("{natural_english}", NATURAL_ENGLISH)


def _instructions(language: Code) -> str:
    if language == "th":
        return _THAI_INSTRUCTIONS
    info = LANGUAGES[language]
    variety = f"{info.variety} " if info.variety else ""
    return _SPACED_INSTRUCTIONS.format(
        name=info.name,
        variety=variety,
        example=info.example,
        writing=info.writing,
        natural_english=NATURAL_ENGLISH,
    )


def system_prompt(entries: list[Entry], language: Code = "th") -> str:
    """The stable, cached part of every request. Sorted by note id so it's byte-identical between
    calls on the same snapshot; anything that varies goes in the user message instead."""
    known = sorted((e for e in entries if e.tier != "unreviewed"), key=lambda e: e.note_id)
    words = "\n".join(
        f"{e.text} | {e.meaning} | {'M' if e.tier == 'mature' else 'Y'}" for e in known
    )
    return _instructions(language) + words


# Every kind of text is asked this: with a small vocabulary the easy plot is someone opening a
# container and finding something, then a stranger arriving to explain it, and nearly every text
# was that one.
_PLOT_VARIETY = (
    "Plot: don't build the situation around someone opening a box, bag, drawer or letter and "
    "finding something, or around a stranger who turns up to explain an object or its past. That "
    "plot is overused. Unless the topic is about it, give the people something they want, a choice "
    "to make or a problem to deal with, so things happen because of what they do."
)


def request_message(request: TextRequest) -> str:
    what = "a dialogue" if request.form == "dialogue" else "a short story"
    parts = [
        f"Topic: {request.topic}",
        f"Write {what} of {request.lines} lines.",
        _PLOT_VARIETY,
    ]
    if request.about:
        parts.append(
            f"What really happened, in the learner's words: {request.about}\n"
            "Base the text on this. Use its people, place and events, and don't add anything that "
            "contradicts it."
        )
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
            "one you pick once or twice, wrapped in asterisks: twice for a word with several forms or "
            "senses or a longer phrase, once for a simple one. Leave the rest out. If none of them fits "
            "a sensible situation with the known words, use fewer, or none:\n" + listed
        )
    elif request.stretch:
        parts.append(
            "Stretch words: use each of these once or twice, wrapped in asterisks: twice for a word "
            "with several forms or senses or a longer phrase, once for a simple one:\n" + listed
        )
    else:
        parts.append("No stretch words this time.")
    if request.met:
        parts.append(
            "Words met before: the learner looked these up in earlier texts, and they are not on "
            "the list. Where one fits the topic naturally, use it once in place of another word "
            "that is not on the list, in any of its forms, and gloss it. They count as words "
            "outside the list, so the coverage target stays the same. Don't wrap them in asterisks, "
            "and use none that doesn't fit:\n"
            + "\n".join(f"- {w.text} ({w.meaning})" for w in request.met)
        )
    if request.genre != DEFAULT_GENRE:
        parts.append(
            f"Genre: write {genre_instruction(request.genre)} The topic still decides what it is "
            "about, and the word list still decides the vocabulary."
        )
    if request.register != DEFAULT_REGISTER:
        parts.append(
            f"Register: the learner wants {request.register} speech. {instruction(request.register)}"
            " Lines between people who would talk differently, such as a customer and a clerk, may"
            " still differ, but keep to this as the default."
        )
    if request.story is not None:
        parts.append(_story_part(request.story))
    if request.practice:
        parts.append(
            f"Grammar to practice: use each of these at least {grammar.PRACTICE_USES} times, "
            "where it fits naturally. Use a point only where a native speaker would in that "
            "line: never add one to a line that is complete without it, and write a different "
            "line rather than bend one to fit it:\n" + _grammar_list(request.practice)
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
            f"{_times(request.unset_uses)} in the whole text, all of them together, or not at all; "
            "the reader explains any that appear:\n" + _grammar_list(request.unset)
        )
    return "\n".join(parts)


# Earlier episodes beyond this many are left out of the request: the cast and the latest ones
# carry the story, and the request stays short.
STORY_RECAPS = 12

# How many of the last episode's final lines the next episode's request quotes.
STORY_ENDING_LINES = 3


_CHOICES_ASK = (
    f'In "choices", end the episode on a decision: give {MIN_CHOICES} or {MAX_CHOICES} short '
    "options for what happens next, each one line of the story's language written like the text "
    '(| between words, only words the learner knows) with its English in "english". Make the '
    "options lead to clearly different next episodes, and gloss any word in them that isn't on "
    "the list, as for the lines. Write each option about the story's characters in the third "
    'person, by name, the way the narrator tells it ("Fai waits here for the police"): never '
    "as the reader or a character speaking, so no I, we, us, our or you. "
    "The decision belongs in the choices, not in the text: end the "
    "text on a concrete moment (something heard, seen or said, or someone arriving), and never "
    "on a line saying a character must decide, choose or work out what to do. That wording "
    "closed episode after episode."
)


# The recap stays in English for the next episode's request; this one is for the reader. Asked to
# be "simpler than the recap" it dropped the episode's one event and kept filler ("the man knows
# where the temple is"), so it has to carry the same event and name who did it.
_RECAP_LINE_ASK = (
    'In "recap_line", say what "recap" says for the reader, in one line of the story\'s language '
    "written like the text (| between words, names marked as in the lines), with its English in "
    '"english". It must tell the main event of "recap": who did what, naming the characters, '
    'not a vague stand-in ("the man", "someone") and not a detail from the scene. Use only words '
    "the learner knows, so keep the event and shorten the rest rather than swap the event for "
    "something easier; if the event needs a word that isn't on the list, gloss it as for the "
    "lines."
)


# How the English recap is asked for. One sentence made it string the whole episode together with
# commas (a comma splice), so it's two short ones, each a sentence that stands on its own.
_RECAP_ASK = (
    'In "recap", say in one or two short English sentences what happens in this episode, naming '
    "the characters. Write plain sentences: end each one with a period, and don't join two "
    'separate events with a comma (use a period, or "and" or "but" without the comma).'
)


def _speakers_ask(story: StoryContext) -> str:
    """How a story episode says who speaks each quotation, so each character is read in a voice of
    their own (cast.py). The characters who already have a voice are listed, and the model adds
    only the new ones: a character's voice is fixed once it's given."""
    known = (
        "These characters already have a voice, so don't list them again, and use their names "
        "exactly:\n" + "\n".join(f"- {s.name} ({s.gender}, {s.age})" for s in story.speakers)
        if story.speakers
        else "No character has a voice yet, so list every one who speaks, those in the cast above "
        "included."
    )
    return (
        "Voices: the learner hears each character in a voice of their own, and the narrator in "
        "another. Put what a character says aloud in quotation marks inside the narrator's line, "
        "the language's usual pair of these: « » or “ ” or „ “ or 「 」. Use quotation marks for "
        "nothing else, and none for thoughts. Vary how a quotation comes in: once it's clear who "
        "is talking, let one follow what the character does (she looked at the ring and smiled, "
        "then the quotation) or stand on its own, and use asked, answered or called where they "
        'fit, rather than opening line after line with "X said". Then in the line\'s "quotes" '
        "list who says each "
        "quotation, in the order they appear, by name; a line with none has an empty list. In "
        '"speakers" list each character who speaks in this episode and has no voice yet: "name" '
        '(a short name or label, the same every time, like Аня or Hoarse voice), "gender" '
        '("male" or "female") and "age" ("child", "adult" or "elder"). Every quotation has to fit '
        f"its speaker's gender and age. {known}"
    )


def _characters_ask(story: StoryContext) -> str:
    """How an episode reports its characters for X-Ray (xray.py): a short English fact for each
    one it introduces or changes, as of this episode and with nothing from later."""
    base = (
        'In "xray" list each named character this episode introduces, or tells something '
        'new about, as "name" (as written in the lines) and "fact": who they are or what they '
        "did, in English, under twelve words, true as of this episode."
    )
    if story.known:
        return (
            base
            + " Characters so far:\n"
            + "\n".join(f"- {k}" for k in story.known)
            + "\nDon't repeat what is already said."
        )
    if story.episode == 1:
        return base + " List every character in the cast."
    return (
        base + " No character has been recorded yet, so list every named character in the story so "
        'far, each with "since": the episode number they first appeared in.'
    )


def _story_part(story: StoryContext) -> str:
    return (
        _story_intro(story)
        + " "
        + _RECAP_LINE_ASK
        + " "
        + _CHOICES_ASK
        + "\n"
        + _speakers_ask(story)
        + "\n"
        + _characters_ask(story)
    )


# Said of every episode: the reader has the last recap on screen, so an episode that opens by
# retelling it, or replays its beat, reads as nothing happening.
_STORY_RULES = (
    "Open in the new scene: don't introduce the characters or the setting again, and don't retell "
    "what happened before (the reader has just been shown it). Don't repeat a beat from the last "
    "episodes either, such as a character staying silent or holding the same object in the same "
    "place. Make something interesting happen that moves the story toward the season's end. "
    "Where it fits the story, let more than one thing happen, so the episode moves on by more "
    "than a single step; a quieter episode is fine when the story calls for one."
)


def _taken_names(story: StoryContext) -> str:
    """Tells the model the names other stories use, so a new character gets a different one."""
    if not story.taken:
        return ""
    return (
        "These characters are in the learner's other stories. Give every new character a name "
        "none of them has, and don't reuse a name from this list for a different person:\n"
        + "\n".join(f"- {t}" for t in story.taken)
        + "\n"
    )


def name_spellings(episodes: Iterable[Iterable[str]], spaced: bool) -> tuple[tuple[str, int], ...]:
    """Each name the episodes mark in their lines (as the model wrote them, `~มะลิ~`), with how
    many episodes used that spelling: most used first, then in the order they first appeared."""
    counts: dict[str, int] = {}
    for lines in episodes:
        for name in dict.fromkeys(n for line in lines for n in line_names(line, spaced)):
            counts[name] = counts.get(name, 0) + 1
    return tuple(sorted(counts.items(), key=lambda kv: -kv[1]))


def _name_spellings(story: StoryContext) -> str:
    """Tells a later episode how the earlier ones wrote the characters' names, so a returning
    character keeps one spelling."""
    if not story.names:
        return ""
    return (
        "How the earlier episodes write the characters' names in the lines, with how many "
        "episodes used each spelling: "
        + ", ".join(f"{name} ({n})" for name, n in story.names)
        + ". Write a returning character's name exactly as most episodes did, every time, and "
        "never a new spelling of a name already here.\n"
    )


def _earlier_titles(story: StoryContext) -> str:
    """The latest episodes' titles, so this one's is its own."""
    if not story.titles:
        return ""
    return (
        "The latest episodes' titles: "
        + ", ".join(story.titles)
        + ". Give this episode a title of its own, not one of these.\n"
    )


def _story_intro(story: StoryContext) -> str:
    last = SEASON_EPISODES
    plan_ask = (
        'In "plan", say in two or three English sentences where this season is heading and how it '
        f"ends in its finale (episode {last}), updated for what happens in this episode"
        + (" and what the reader chose." if story.chosen else ".")
    )
    if story.episode == 1:
        about = f"It's about: {story.about}" if story.about else "Choose what it's about yourself."
        return (
            "This is the first episode of an ongoing story that will run for many episodes, one "
            f"text at a time, in seasons of {last} episodes that each build to a finale. {about} "
            "Invent two to four characters with names and a place they keep coming back to, and "
            "end the episode with something that can carry on next time. "
            f"{_taken_names(story)}"
            'In "series", give the story a short name in the language of the text, like its title, '
            'with no English. In "cast", describe the characters '
            f"and the setting in one or two English sentences. {_RECAP_ASK} {plan_ask}"
        )
    recent = story.recaps[-STORY_RECAPS:]
    so_far = "\n".join(f"- {r}" for r in recent) if recent else "- (no summary)"
    picked = (
        f'The reader chose what happens next: "{story.chosen}". Start this episode from that '
        "choice.\n"
        if story.chosen
        else ""
    )
    ending = (
        "How the last episode ended, in its final lines (English). Open in the same state of "
        "things: don't contradict anything here, and let any time that has passed show:\n"
        + "\n".join(f"> {ln}" for ln in story.ending)
        + "\n"
        if story.ending
        else ""
    )
    where = f'episode {story.episode} of an ongoing story, "{story.title}"'
    if story.season_episode == 1:
        place = (
            f"This is {where}, and the first episode of season {story.season}: the last season "
            "has ended. Keep the same characters and setting, and open a new problem for them."
            f" Plan how this season will build to a finale in episode {last}."
        )
        plan = ""
    else:
        place = (
            f"This is {where}, episode {story.season_episode} of {last} in season "
            f"{story.season}. Keep the same characters and setting, and pick up where the last "
            "episode ended."
        )
        if story.season_episode == last:
            place += (
                " This is the season finale: bring what has been building to its climax and "
                "resolve the season's main question, with no cliffhanger. Resolve it in a scene the "
                "reader sees, whatever kind of question it is: the moment that answers it happens "
                "in the lines rather than being reported afterward by a character, and a "
                "character's big decision has a reason the reader is shown. The choices at the end "
                "are what the next season could be about."
            )
        elif story.season_episode == last - 1:
            place += " The next episode is the finale, so bring the story to its turning point."
        plan = (
            f"The season's plan so far: {story.plan}\n"
            if story.plan
            else "The season has no plan yet: decide how it ends in its finale.\n"
        )
    return (
        f"{place}\n{plan}{picked}{ending}"
        f"Characters and setting: {story.cast or 'as in the earlier episodes'}\n"
        f"{_name_spellings(story)}"
        f"{_taken_names(story)}"
        f"The story so far, a recap of each episode:\n{so_far}\n"
        f"{_earlier_titles(story)}"
        f"{_STORY_RULES}\n"
        f'{_RECAP_ASK} {plan_ask} Leave "series" and "cast" empty.'
    )


def _times(n: int) -> str:
    return "once" if n == 1 else f"{n} times"


def _grammar_list(point_ids: tuple[str, ...]) -> str:
    return "\n".join(
        f"- {grammar.POINTS[p].name} ({grammar.POINTS[p].note}, e.g. {grammar.POINTS[p].example})"
        for p in point_ids
    )


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
                f"this draft uses it {n} {'time' if n == 1 else 'times'}. Add a line where a "
                "native speaker would use it, rather than forcing it into a line that has none."
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
    if (n := len(unset)) > request.unset_uses:
        misses += n - request.unset_uses
        problems.append(
            f"Use grammar the learner may not know at most {_times(request.unset_uses)} in all; "
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
        try:
            draft, content, used = await ask(messages)
            usage += used
            assessed, problems = _assess(draft, lexicon, request, attempt)
        except GenerationFailed as e:
            usage += e.usage
            if result is None:
                raise GenerationFailed(str(e), usage) from e
            # A revision failed: what the earlier attempts wrote (and cost) is still kept below,
            # so a good enough draft is served and a dropped one still has its cost on record.
            result = replace(result, attempts=attempt, usage=usage)
            break
        result = replace(assessed, usage=usage)
        # How far off each draft was, so a retry's cost can be weighed against what it fixed.
        log.info(
            "%s draft %d: %.1f%% known (floor %.0f%%), %d problems%s%s",
            request.language,
            attempt,
            result.coverage.ratio * 100,
            request.floor * 100,
            len(problems),
            ": " if problems else "",
            "; ".join(problems[:5]),
        )
        if result.passed:
            return result
        # Fewer grammar problems first, then closer to the target; the later attempt on a tie.
        rank = (
            -result.grammar_problems,
            _closeness(result.coverage.ratio, request),
            -result.crowded,
        )
        if (
            result.gender_ok
            and result.names_ok
            and (
                best is None
                or rank
                >= (-best.grammar_problems, _closeness(best.coverage.ratio, request), -best.crowded)
            )
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
        # Every attempt had a line that doesn't fit its speaker's gender, or names hiding words
        # from the count: none is kept, whatever its coverage. It's returned as not passed, so
        # it's stored as dropped and never served.
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


def drop_reasons(result: Generated, request: TextRequest) -> list[str]:
    """Why a draft that wasn't passed was dropped, for review after the fact (audit.py): where its
    coverage fell against the target, then the problems the last attempt still had."""
    ratio = result.coverage.ratio
    reasons = []
    if ratio < request.floor:
        reasons.append(f"Below the floor: {ratio:.1%} known, the floor is {request.floor:.0%}.")
    elif request.ceiling is not None and ratio > request.ceiling:
        reasons.append(
            f"Over the ceiling: {ratio:.1%} known, the ceiling is {request.ceiling:.0%}."
        )
    return reasons + list(result.problems)


def _paragraphs(lines: tuple[Line, ...], form: Form) -> tuple[Line, ...]:
    """A story's paragraph marks, made consistent: the first line opens a paragraph whenever any
    line does, and a dialogue has none."""
    if form != "story" or not any(ln.paragraph for ln in lines):
        return tuple(replace(ln, paragraph=False) for ln in lines)
    return (replace(lines[0], paragraph=True), *lines[1:])


def _quotes(line: dict[str, Any], request: TextRequest) -> tuple[str, ...]:
    """Who says each quotation in a line, in order. Only a story episode is asked for it."""
    if request.story is None or not isinstance(line.get("quotes"), list):
        return ()
    return tuple(str(q).strip() for q in line["quotes"])


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
                Line(
                    ln["speaker"],
                    ln["text"],
                    ln["english"],
                    bool(ln.get("paragraph")),
                    ln["register"] if ln.get("register") in REGISTERS else "",
                    _quotes(ln, request),
                )
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
        # The model sometimes writes the title like a line (ทาง|ป่า), and the shelf showed the bars.
        title = parse_line(str(draft["title"]), lexicon.spaced)[0].strip()
        title_english = str(draft.get("title_english") or "").strip()
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
        recap, series, cast_, plan = (
            str(draft.get(k) or "").strip() for k in ("recap", "series", "cast", "plan")
        )
        series = parse_line(series, lexicon.spaced)[0].strip()
        choices = _choices(draft, request)
        recap_line, recap_english = _recap_line(draft, request)
        speakers = parse_speakers(draft.get("speakers")) if request.story is not None else ()
        xray_told = xray.parse_characters(draft.get("xray")) if request.story is not None else ()
    except (KeyError, TypeError) as e:
        raise GenerationFailed(f"The draft is missing a field: {e}") from e
    if not lines:
        raise GenerationFailed("The draft has no lines")

    # The choices and the recap's line are read like lines, so a word outside the deck in one
    # counts against the floor and is named in the revision message like any other.
    extra = [c.text for c in choices] + ([recap_line] if recap_line else [])
    coverage = check([ln.text for ln in lines] + extra, lexicon)
    used, uses, problems = _stretch_used(coverage, request, lexicon)
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
    polite_said = [
        (f"Speaker {ln.speaker}", genders[ln.speaker], ln.text)
        for ln in lines
        if ln.speaker in genders
    ]
    if request.story is not None:
        quote_issues, quote_gender_issues, quotations = _quote_issues(lines, request, speakers)
        problems += quote_issues
        gender_issues += quote_gender_issues
        polite_said += quotations
    problems += gender_issues
    problems += polite_i_problems(request.language, polite_said)
    name_issues = name_problems(coverage, lexicon.spaced)
    problems += name_issues
    grammar_issues, grammar_misses = grammar_problems([ln.text for ln in lines], lexicon, request)
    problems += grammar_issues
    crowd_issues, crowded = crowding(coverage, request.floor)
    problems += crowd_issues
    # Stretch words are glossed from the deck, the meaning their card teaches, whatever the model
    # wrote for them; only off-list words need the model's gloss.
    for word in used:
        glosses[word.text] = word.meaning
    missing = tuple(
        w for w in coverage.words("unknown") + coverage.words("partial") if w not in glosses
    )
    in_range = request.ceiling is None or coverage.ratio <= request.ceiling
    passed = coverage.meets(request.floor) and in_range and not problems
    # Only a word that appears was practiced: a closest attempt kept without one mustn't count toward the word's days of practice (`practiced_days`).
    stretch = tuple(e.text for e in used if uses[e.text] >= STRETCH_MIN_USES)
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
        names_ok=not name_issues,
        grammar_problems=grammar_misses,
        crowded=crowded,
        problems=tuple(problems),
        translits=translits,
        recap=recap,
        series=series,
        cast=cast_,
        plan=plan,
        recap_line=recap_line,
        recap_english=recap_english,
        title_english=title_english,
        choices=choices,
        speakers=speakers,
        xray=xray_told,
    )
    return generated, problems


def _quote_issues(
    lines: tuple[Line, ...], request: TextRequest, speakers: tuple[Speaker, ...]
) -> tuple[list[str], list[str], list[tuple[str, str, str]]]:
    """What's wrong with who speaks the quotations in a story episode (cast.py): the attributions
    that don't match the quotations, and, in Thai, a quotation with a word of the other gender than
    its speaker's, which like a dialogue's is never kept; then each quotation as (who, their
    gender, the quotation), for the checks that only send it back (`polite_i_problems`)."""
    assert request.story is not None
    cast = {s.name: s for s in (*request.story.speakers, *speakers)}
    problems = quote_problems([(ln.text, ln.quotes) for ln in lines], cast)
    quotations = []
    for ln in lines:
        for name, text in quotation_texts(ln.text, ln.quotes):
            if (key := find(cast, name)) is not None:
                quotations.append((name, cast[key].gender, text))
    said: list[tuple[str, str, str]] = list(quotations)
    return problems, quote_gender_problems(request.language, quotations), said


def _choices(draft: dict[str, Any], request: TextRequest) -> tuple[Choice, ...]:
    """The choices a story episode ends on. Only a story episode is asked for them, and fewer than
    `MIN_CHOICES` is no choice, so the episode is kept and the story carries on by itself."""
    if request.story is None:
        return ()
    found = [
        Choice(str(c["text"]).strip(), str(c["english"]).strip())
        for c in draft.get("choices") or []
        if str(c["text"]).strip() and str(c["english"]).strip()
    ]
    return tuple(found[:MAX_CHOICES]) if len(found) >= MIN_CHOICES else ()


def _recap_line(draft: dict[str, Any], request: TextRequest) -> tuple[str, str]:
    """A story episode's recap in its own language and that line's English, or two empty strings
    when it isn't a story episode or either half is missing (the shelf then shows the English
    recap, as before this was asked for)."""
    raw = draft.get("recap_line")
    if request.story is None or not isinstance(raw, dict):
        return "", ""
    text, english = str(raw.get("text") or "").strip(), str(raw.get("english") or "").strip()
    return (text, english) if text and english else ("", "")


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
) -> tuple[list[Entry], dict[str, int], list[str]]:
    """The stretch words the draft uses, how many times each, and what's wrong with how it uses
    them, as sentences for the revision message. A chosen word is one of the offered words the
    draft put in asterisks."""
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
        problems.append("These stretch words don't appear in the text: " + ", ".join(short) + ".")
    return used, uses, problems


def claude_ask(
    client: anthropic.AsyncAnthropic,
    entries: list[Entry],
    language: Code = "th",
    model: TextModel = MODEL,
    effort: Effort = EFFORT,
) -> Ask:
    system: list[BetaTextBlockParam] = [
        {
            "type": "text",
            "text": system_prompt(entries, language),
            "cache_control": {"type": "ephemeral"},
        }
    ]

    def output_config(effort: Effort) -> BetaOutputConfigParam:
        return {"effort": effort, "format": {"type": "json_schema", "schema": DRAFT_SCHEMA}}

    # Haiku has no server-side refusal fallback; a refusal there fails the attempt below.
    fallback: dict[str, Any] = (
        {}
        if model == CHEAP_MODEL
        else {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    )

    async def call(messages: list[dict[str, Any]], effort: Effort, max_tokens: int) -> BetaMessage:
        try:
            response: BetaMessage = await client.beta.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config(effort),
                timeout=REQUEST_TIMEOUT_SECONDS,
                **fallback,
            )
            return response
        except anthropic.APIError as e:
            # Overloaded, rate limited, unreachable: say so rather than failing the request.
            raise GenerationFailed(didnt_answer(e)) from e

    async def ask(messages: list[dict[str, Any]]) -> tuple[dict[str, Any], list[Any], Usage]:
        response = await call(messages, effort, MAX_TOKENS)
        used = usage_of(response)
        if response.stop_reason == "max_tokens":
            # Most likely thinking used the budget. Both calls are paid for, so both are counted.
            log.warning("Response cut off at %d tokens; asking again", MAX_TOKENS)
            response = await call(messages, RETRY_EFFORT, RETRY_MAX_TOKENS)
            used += usage_of(response)
        if response.stop_reason == "refusal":
            raise GenerationFailed("Claude declined to write this text", used)
        if response.stop_reason == "max_tokens":
            raise GenerationFailed("The response was cut off", used)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise GenerationFailed("The response had no text", used)
        try:
            draft = json.loads(text)
        except json.JSONDecodeError as e:
            raise GenerationFailed("The response wasn't valid JSON", used) from e
        return draft, list(response.content), used

    return ask
