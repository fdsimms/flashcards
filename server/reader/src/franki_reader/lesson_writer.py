"""Claude's part of an audio lesson (lesson.py): the content, and only the content. It's asked for a
short dialogue and a few phrases to teach, each split into parts; how the lesson runs is code.

Generate, then verify: `lesson.clean_plan` keeps only phrases whose parts put back together are the
phrase, and a plan with fewer than `lesson.MIN_PHRASES` of them is asked for again, once, with the
reason. The second answer is kept or the lesson isn't made.
"""

import json
from collections.abc import Awaitable, Callable
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader import gender, lesson
from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker
from franki_reader.generator import CHEAP_MODEL, MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.register import DEFAULT, Register, instruction

MAX_TOKENS = 4000
MAX_ATTEMPTS = 2
MAX_SCENE = 200
# How many unknown words a retry names.
MAX_NAMED_WORDS = 12
# The longest line A (the learner's part in the role-play) is asked for, in words; Thai and Japanese
# words are shorter, so they get more.
A_LINE_WORDS_SPACED = 8
A_LINE_WORDS_UNSPACED = 12
# A phrase this long has to be built up from its end in at least two parts.
LONG_PHRASE_WORDS = 4
# The model that checks a written lesson's wording (Haiku writes it; `lesson_words` moved up to Sonnet
# for the same reason, since the cheaper model's own judgment of a sentence is what's in question).
REVIEW_MAX_TOKENS = 1500

_REQUEST = """\
Write the content of a short spoken {language} lesson for a beginner, set in this situation:
{scene}

It will be recorded as audio: an English narrator and native {language} voices, with pauses for the
learner to say each phrase aloud. You choose what is taught; the lesson's structure is built from
what you give. Give:

- title: a short English title for the lesson (two to five words) saying what the learner will be
  able to do, in your own words rather than the situation as typed ("Getting your coffee", not
  "Ordering a coffee")
- dialogue: {low} to {high} lines of natural, spoken conversation in {language} in that situation,
  between A ({a}) and B ({b}). A speaks first. Each line: speaker (A or B), text ({language}),
  english. Every phrase below comes up in it word for word, in A's lines where they fit. The
  learner hears it first and acts out A's part last, so build it from the phrases taught and very
  basic everyday words, with no rarer vocabulary. Each of A's lines is one short sentence of at
  most {a_words} words.
- phrases: {target} to {many} phrases the learner will practice saying, simplest first, each one
  something a person would really say in that situation. Each: text ({language}), english (what it
  means in this situation, in the natural English for it rather than word for word, and not
  misleading when read alone), and parts.
- mixes: up to {mixes} new {language} sentences the learner has never heard whole, made only of
  words that appear in the phrases above (a word may be reused, none may be new). Check each as a
  native speaker would: it is grammatical, it means what its english says, and it is something the
  learner could say in this situation. Pieces that merely fit together are not a sentence, and
  neither are two phrases put side by side. Give fewer, or none, rather than one that fails.
  Each: text and english.

Rules for the phrases:
- 2 to 8 words each, and not a lone "Yes." or "Thanks."
- `parts` are the phrase split in order into 1 to {parts} pieces at natural breaks, so that the
  learner can build it up from its end (the last piece first). Put back together, the parts must be
  the phrase exactly: the same words in the same order, nothing added or left out. A short phrase
  can be one part.
- {register_rule}
{gender_rule}- Each phrase does a different job in the situation, so the lesson covers it rather than repeating
  one thing: for example asking, answering, asking back, reacting, thanking, saying you didn't
  understand. Never two phrases that say nearly the same thing with a word added or changed ("How
  are you?" and "How are you today?"). A narrow situation still needs {target} to {many} different
  things a person says in it, so go to what comes right before and after it.
- The phrases are a ladder, in the order they come up in the dialogue: a phrase may reuse a word or
  a piece from an earlier one (a verb, a polite ending), but it means something new and has at
  least two words the earlier phrases don't.
{understand_rule}
Plain text only: no `|`, asterisks, tildes or em dashes.{note}"""

# A lesson made from the learner's own words and phrases (a cram in the app): every one is taught
# as it is, and Claude writes the conversation around them, the parts and the mixes.
_GIVEN_REQUEST = """\
Write the content of a short spoken {language} lesson for a learner who needs to use these {language}
words and phrases soon, in this situation:
{scene}

The words and phrases, each with its meaning:
{given}

It will be recorded as audio: an English narrator and native {language} voices, with pauses for the
learner to say each phrase aloud. Give:

- title: a short English title for the lesson (two to five words) saying what the learner will be
  able to do, in your own words rather than the situation as typed
- dialogue: {low} to {high} lines of natural, spoken conversation in {language} in that situation,
  between A ({a}) and B ({b}). A speaks first. Each line: speaker (A or B), text ({language}),
  english. Use every one of the words and phrases above that fits naturally, in A's lines, and
  otherwise only very basic everyday words. The learner acts out A's part at the end, so keep A's
  lines short and made mostly of those words and phrases.
- phrases: every one of the words and phrases above, written exactly as given (the same text,
  letter for letter: don't correct, complete or add to one, even a single word), in the order they
  come up in the dialogue, any that don't come up last. Each: text, english (as given), and parts.
- mixes: {mixes} new {language} sentences the learner has never heard whole, made only of words that
  appear in the phrases above (a word may be reused, none may be new). Each must be one complete
  sentence a person would really say, never two of the phrases put side by side. Each: text and
  english. Check each as a native speaker would: it is grammatical, it means what its english says,
  and it is something the learner could say in this situation. Fewer, or none, when the phrases
  don't make a sentence that passes.

Rules for the parts: the phrase split in order into 1 to {parts} pieces at natural breaks, so that
the learner can build it up from its end (the last piece first). Put back together, the parts must
be the phrase exactly. A single word or a short phrase is one part.

The dialogue and the new sentences are what you write, and the words and phrases above stay as
given. {register_rule}

Plain text only: no `|`, asterisks, tildes or em dashes.{note}"""

# What the learner must follow to carry on (a price, a time, directions) is something B says, so one
# phrase is B's line, taught like the others. Not for Thai: every Thai phrase taught carries the
# learner's own polite particle (`thai_problems`), which B's line wouldn't.
_UNDERSTAND = (
    "- One phrase is the thing B says that A must understand to carry on (a price, a time, "
    "directions, an answer), taught like the others and in the dialogue word for word.\n"
)

_NEUTRAL = "- The learner may be a man or a woman, so use no form that changes with the speaker's gender.\n"

# Thai's polite particle and its word for "I" depend on the speaker's gender, so a Thai lesson is
# written for the learner's own: every phrase taught carries the learner's particle, which is the
# point of choosing it, and A (the learner's part in the role-play) speaks as the learner does.
_THAI_PARTICLES: dict[lesson.Learner, str] = {
    "male": (
        "ครับ for a man: end every phrase taught with ครับ (a question too, ครับ never ค่ะ or คะ),"
        ' and write "I" as ผม, never ฉัน'
    ),
    "female": (
        "ค่ะ for a woman: end every phrase taught that is a statement with ค่ะ and every question"
        ' with คะ, and write "I" as ดิฉัน or ฉัน, never ผม'
    ),
}


def _thai_note(learner: lesson.Learner) -> str:
    speaker = "man" if learner == "male" else "woman"
    their = "woman" if learner == "male" else "man"
    return (
        "\n\nThai: write Thai script only, with spaces only between clauses, never between words, and"
        " cut `parts` where a person would pause. The learner is a "
        f"{speaker}, and Thai's polite particles and \"I\" depend on the speaker's gender, so write "
        f"every line of A for a {speaker}: {_THAI_PARTICLES[learner]}. The same particle ends each of"
        " the new sentences in `mixes`, and the dialogue's A ends polite lines with it too. B (a "
        f'{their}) uses the {their}\'s particle and "I" in the dialogue only, never in a phrase '
        "taught."
    )


# Japanese has no spaces either, and its script and politeness are worth saying: a lesson teaches
# what a learner says to a stranger (a shop, a station), which is the polite です/ます form, unless
# the lesson is casual, for friends, which is the plain form.
_JAPANESE_NOTE = (
    "\n\nJapanese: write standard Japanese in kanji and kana as a native speaker would, never"
    " romaji, with no spaces between words, and cut `parts` where a person would pause. Phrases"
    " taught and the new sentences in `mixes` use "
)
_JAPANESE_POLITE = "the polite です/ます form."
_JAPANESE_PLAIN = "the plain form friends use, not です/ます."


def _thai_given_note(learner: lesson.Learner) -> str:
    speaker = "man" if learner == "male" else "woman"
    their = "woman" if learner == "male" else "man"
    particle = "ครับ" if learner == "male" else "ค่ะ (คะ for a question)"
    first = "ผม" if learner == "male" else "ดิฉัน or ฉัน"
    return (
        "\n\nThai: write Thai script only, with spaces only between clauses, never between words, and"
        f" cut `parts` where a person would pause. The learner is a {speaker}: A's polite lines end"
        f' with {particle} and A says "I" as {first}. B (a {their}) uses the {their}\'s particle'
        ' and "I". Leave the phrases taught as given, with or without a particle.'
    )


def _language_note(language: Code, learner: lesson.Learner, register: Register = DEFAULT) -> str:
    """What the request adds for one language: Thai's script and gendered particles, Japanese's
    script and politeness, nothing for the rest."""
    if language == "th":
        return _thai_note(learner)
    if language == "ja":
        return _JAPANESE_NOTE + (_JAPANESE_PLAIN if register == "casual" else _JAPANESE_POLITE)
    return ""


def _speakers(language: Code, learner: lesson.Learner) -> tuple[str, str]:
    """Who A and B are: the learner is A, and in every language but Thai that is a man."""
    if language == "th" and learner == "female":
        return "a woman", "a man"
    return "a man", "a woman"


# What a speaker of each gender must not say in Thai: a man isn't taught ฉัน (a woman's word in a
# polite lesson), a woman isn't taught ผม.
_FIRST_PERSON: dict[lesson.Learner, tuple[str, ...]] = {
    "male": ("ฉัน", "ดิฉัน"),
    "female": ("ผม", "กระผม"),
}


def _has_particle(text: str, learner: lesson.Learner) -> bool:
    """Whether a Thai phrase carries the learner's polite particle (คะ counts for a woman's
    question, but only as a word of its own, since it also starts คะแนน, "score")."""
    if learner == "male":
        return "ครับ" in text
    return "ค่ะ" in text or "คะ" in lesson.tokens(text)


def thai_problems(plan: lesson.Plan, learner: lesson.Learner, *, phrases: bool = True) -> list[str]:
    """What's wrong with a Thai plan for this learner, as sentences for the revision message: a
    phrase taught without the learner's polite particle (unless `phrases` is False: the learner's
    own words, taught as they are), or a speaker using the other gender's particle or "I"."""
    problems: list[str] = []
    missing = [p.text for p in plan.phrases if phrases and not _has_particle(p.text, learner)]
    if missing:
        particle = "ครับ" if learner == "male" else "ค่ะ (คะ for a question)"
        problems.append(
            f"Every phrase taught must carry the polite particle {particle}. These don't: "
            + "; ".join(missing)
        )
    genders: dict[str, lesson.Learner] = {"A": learner, "B": lesson.other(learner)}
    lines = [(line.speaker, line.text) for line in plan.dialogue]
    problems += gender.gender_problems("th", lines, genders)
    for speaker, text in lines:
        said = set(lesson.tokens(text))
        for word in _FIRST_PERSON[genders[speaker]]:
            if word in said:
                who = "a man" if genders[speaker] == "male" else "a woman"
                problems.append(
                    f"Speaker {speaker} is {who} and shouldn't say {word} in: {text}. Rewrite it."
                )
    return problems


def craft_problems(plan: lesson.Plan, language: Code, *, phrases: bool = True) -> list[str]:
    """What's weak in a plan that is usable, as sentences for the revision message: too few phrases,
    a phrase of `LONG_PHRASE_WORDS` or more taught in one piece, a phrase the dialogue never says, or
    a line for A (the learner's part) longer than they can be asked for. These are asked for again
    but never refuse a lesson (`_first_usable` keeps the plan with the fewest). `phrases` is False for
    a lesson on the learner's own words, whose phrases are theirs: only A's lines are checked."""
    out: list[str] = []
    limit = A_LINE_WORDS_UNSPACED if language in ("th", "ja") else A_LINE_WORDS_SPACED
    long_a = [
        l.text for l in plan.dialogue if l.speaker == "A" and lesson.word_count(l.text) > limit
    ]
    if long_a:
        out.append(
            f"A's lines must be one short sentence of at most {limit} words. Shorten: "
            + "; ".join(long_a)
        )
    if not phrases:
        return out
    if len(plan.phrases) < lesson.TARGET_PHRASES:
        out.append(
            f"Teach {lesson.TARGET_PHRASES} to {lesson.MAX_PHRASES} phrases, not {len(plan.phrases)}."
        )
    one_piece = [
        p.text
        for p in plan.phrases
        if len(p.parts) == 1 and lesson.word_count(p.text) >= LONG_PHRASE_WORDS
    ]
    if one_piece:
        out.append("These phrases need at least two parts: " + "; ".join(one_piece))
    said = "".join(lesson.plain(l.text) for l in plan.dialogue)
    missing = [p.text for p in plan.phrases if lesson.plain(p.text) not in said]
    if missing:
        out.append(
            "These phrases don't come up in the dialogue word for word: " + "; ".join(missing)
        )
    return out


SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "dialogue": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "speaker": {"type": "string", "enum": ["A", "B"]},
                    "text": {"type": "string"},
                    "english": {"type": "string"},
                },
                "required": ["speaker", "text", "english"],
                "additionalProperties": False,
            },
        },
        "mixes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"text": {"type": "string"}, "english": {"type": "string"}},
                "required": ["text", "english"],
                "additionalProperties": False,
            },
        },
        "phrases": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "english": {"type": "string"},
                    "parts": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "english", "parts"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "dialogue", "phrases", "mixes"],
    "additionalProperties": False,
}


class LessonFailed(Exception):
    """A lesson couldn't be written; the message is shown as it is. `usage` is what the calls were
    billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Asks Claude for a lesson's content: the language, the scene, what to say about the last attempt
# (empty the first time) and whose part the learner plays. Returns Claude's raw answer and what the
# call cost.
WritePlan = Callable[[Code, str, str, lesson.Learner, Register], Awaitable[tuple[Any, Usage]]]
# The same, for a lesson around the learner's own words and phrases (the language, the scene, the
# phrases, the feedback, the learner, the register).
WriteGiven = Callable[
    [Code, str, tuple[lesson.Phrase, ...], str, lesson.Learner, Register],
    Awaitable[tuple[Any, Usage]],
]

_RETRY = (
    "That answer had fewer than {n} usable phrases. A phrase is dropped when its parts, put back"
    " together, aren't the phrase exactly, or it is repeated. Write the lesson again."
)

_RETRY_GIVEN = "That answer had no usable dialogue. Write the lesson again."

_RETRY_WORDS = (
    "The learner doesn't know these words from the dialogue: {words}. The dialogue is played first and"
    " acted out last, so it may use only the phrases taught and very basic everyday words. Write the"
    " lesson again with simpler dialogue lines, replacing those words or teaching them in a phrase."
)


def request_message(
    language: Code, scene: str, learner: lesson.Learner = "male", register: Register = DEFAULT
) -> str:
    a, b = _speakers(language, learner)
    return _REQUEST.format(
        a=a,
        b=b,
        gender_rule="" if language == "th" else _NEUTRAL,
        language=LANGUAGES[language].name,
        scene=scene,
        low=4,
        high=lesson.MAX_DIALOGUE,
        target=lesson.TARGET_PHRASES,
        many=lesson.MAX_PHRASES,
        a_words=A_LINE_WORDS_UNSPACED if language in ("th", "ja") else A_LINE_WORDS_SPACED,
        understand_rule="" if language == "th" else _UNDERSTAND,
        mixes=lesson.MAX_MIXES,
        parts=lesson.MAX_PARTS,
        note=_language_note(language, learner, register),
        register_rule=instruction(register),
    )


def given_request_message(
    language: Code,
    scene: str,
    given: tuple[lesson.Phrase, ...],
    learner: lesson.Learner = "male",
    register: Register = DEFAULT,
) -> str:
    a, b = _speakers(language, learner)
    note = (
        _thai_given_note(learner)
        if language == "th"
        else _language_note(language, learner, register)
    )
    return _GIVEN_REQUEST.format(
        a=a,
        b=b,
        language=LANGUAGES[language].name,
        scene=scene,
        given="\n".join(f"- {p.text} ({p.english})" for p in given),
        low=4,
        high=lesson.MAX_GIVEN_DIALOGUE,
        mixes=lesson.MAX_MIXES,
        parts=lesson.MAX_PARTS,
        note=note,
        register_rule=instruction(register),
    )


async def _first_usable(
    write: Callable[[str], Awaitable[tuple[Any, Usage]]],
    clean: Callable[[Any], lesson.Plan | None],
    problems: Callable[[lesson.Plan], list[str]],
    weak: Callable[[lesson.Plan], list[str]],
    unusable: str,
    lexicon: Checker | None,
) -> tuple[lesson.Plan, Usage]:
    """Asks with `write` (given what to say about the last attempt) up to `MAX_ATTEMPTS` times,
    until a plan `clean` accepts has no `problems`, nothing `weak`, nothing the reviewer found
    (`REVIEW_KEY` in the answer) and no words the learner doesn't know; else the usable plan with the
    fewest unknown words, then the fewest other weaknesses. What the calls cost comes back with it,
    or on the failure."""
    used = Usage()
    feedback = ""
    closest: tuple[tuple[int, int], lesson.Plan] | None = None
    for _ in range(MAX_ATTEMPTS):
        try:
            raw, spent = await write(feedback)
        except LessonFailed as e:
            raise LessonFailed(str(e), used + e.usage) from e
        used = used + spent
        plan = clean(raw)
        if plan is None:
            feedback = unusable
            continue
        wrong = problems(plan)
        if wrong:
            feedback = "Fix this and write the lesson again. " + " ".join(wrong)
            continue
        others = weak(plan) + reviewed(raw)
        strangers = lesson.unfamiliar_words(plan, lexicon) if lexicon is not None else []
        if not strangers and not others:
            return plan, used
        score = (len(strangers), len(others))
        if closest is None or score < closest[0]:
            closest = (score, plan)
        feedback = (
            "Fix this and write the lesson again. " + " ".join(others) + " " if others else ""
        )
        if strangers:
            feedback += _RETRY_WORDS.format(words=", ".join(strangers[:MAX_NAMED_WORDS]))
        feedback = feedback.strip()
    if closest is not None:
        return closest[1], used
    raise LessonFailed("Claude didn't write a usable lesson. Try again.", used)


async def write_given_plan(
    write: WriteGiven,
    language: Code,
    scene: str,
    given: tuple[lesson.Phrase, ...],
    learner: lesson.Learner = "male",
    lexicon: Checker | None = None,
    register: Register = DEFAULT,
) -> tuple[lesson.Plan, Usage]:
    """The plan for a lesson teaching the learner's own `given` words and phrases in `scene`, asked
    for as `write_plan` asks (`lesson.clean_given_plan` keeps every given phrase). A Thai plan is
    checked for its speakers' particles and "I", never the phrases', which are the learner's."""

    async def ask(feedback: str) -> tuple[Any, Usage]:
        return await write(language, scene, given, feedback, learner, register)

    return await _first_usable(
        ask,
        lambda raw: lesson.clean_given_plan(raw, scene, given),
        lambda plan: thai_problems(plan, learner, phrases=False) if language == "th" else [],
        lambda plan: craft_problems(plan, language, phrases=False),
        _RETRY_GIVEN,
        lexicon,
    )


async def write_plan(
    write: WritePlan,
    language: Code,
    scene: str,
    learner: lesson.Learner = "male",
    lexicon: Checker | None = None,
    register: Register = DEFAULT,
) -> tuple[lesson.Plan, Usage]:
    """The plan for a lesson on `scene`, asked for up to `MAX_ATTEMPTS` times; what the calls cost
    comes back with it, or on the failure. A Thai plan whose phrases lack the learner's polite
    particle, or whose speakers use the other gender's, is asked for again with what's wrong. With
    the learner's `lexicon`, a dialogue with words they don't know (`lesson.unfamiliar_words`) is
    asked for again naming them; when no attempt gets clear of them, the usable plan with the
    fewest is kept rather than no lesson."""

    async def ask(feedback: str) -> tuple[Any, Usage]:
        return await write(language, scene, feedback, learner, register)

    return await _first_usable(
        ask,
        lambda raw: lesson.clean_plan(raw, scene),
        lambda plan: thai_problems(plan, learner) if language == "th" else [],
        lambda plan: craft_problems(plan, language),
        _RETRY.format(n=lesson.MIN_PHRASES),
        lexicon,
    )


# The reviewer's findings travel in Claude's answer under this key (`clean_plan` ignores it), so the
# retry loop that already reads the answer needs no second channel.
REVIEW_KEY = "review_problems"

_REVIEW = """\
You are a native {language} speaker and a language teacher checking a beginner's audio lesson before
it is recorded. The situation: {scene}
{speakers}
Dialogue (A is the learner's part):
{dialogue}

Phrases taught:
{phrases}

New sentences the learner will be asked for (made from the phrases' words):
{mixes}

List only real problems, each as kind ("dialogue", "phrase" or "mix"), index (the number shown) and
problem (one plain sentence saying what is wrong and what to do). A problem is: ungrammatical or
unnatural {language}, something nobody would say in this situation, an English meaning that doesn't
match or that misleads when read alone, or a new sentence that is only pieces stuck together or
means something odd. If everything is fine, list nothing."""

REVIEW_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "problems": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["dialogue", "phrase", "mix"]},
                    "index": {"type": "integer"},
                    "problem": {"type": "string"},
                },
                "required": ["kind", "index", "problem"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["problems"],
    "additionalProperties": False,
}


def _numbered(items: list[tuple[str, str]]) -> str:
    return "\n".join(f"{i}. {t} ({e})" for i, (t, e) in enumerate(items, 1)) or "(none)"


def review_message(language: Code, learner: lesson.Learner, plan: lesson.Plan) -> str:
    a, b = _speakers(language, learner)
    return _REVIEW.format(
        language=LANGUAGES[language].name,
        scene=plan.scene,
        speakers=f"A is {a}, B is {b}.\n" if language == "th" else "",
        dialogue=_numbered([(f"{l.speaker}: {l.text}", l.english) for l in plan.dialogue]),
        phrases=_numbered([(p.text, p.english) for p in plan.phrases]),
        mixes=_numbered([(m.text, m.english) for m in plan.mixes]),
    )


def reviewed(raw: Any) -> list[str]:
    """What the reviewer found in `raw`, as sentences for the revision message."""
    found = raw.get(REVIEW_KEY) if isinstance(raw, dict) else None
    return [x for x in found if isinstance(x, str)] if isinstance(found, list) else []


def apply_review(raw: dict[str, Any], plan: lesson.Plan, found: Any, *, phrases: bool) -> None:
    """Acts on the reviewer's `found` list in `raw` (`plan` is `raw` as cleaned): a flagged new
    sentence is dropped, since a lesson is fine with fewer; a flagged phrase or dialogue line goes
    under `REVIEW_KEY`, to be asked for again. `phrases` is False when the phrases are the learner's
    own, which aren't Claude's to change. A malformed finding is ignored."""
    drop: set[str] = set()
    notes: list[str] = []
    for item in found if isinstance(found, list) else []:
        if not isinstance(item, dict):
            continue
        kind, index, problem = item.get("kind"), item.get("index"), item.get("problem")
        if not isinstance(index, int) or not isinstance(problem, str) or not problem.strip():
            continue
        group = {"dialogue": plan.dialogue, "phrase": plan.phrases, "mix": plan.mixes}.get(
            str(kind)
        )
        if group is None or not 1 <= index <= len(group):
            continue
        if kind == "mix":
            drop.add(plan.mixes[index - 1].text)
        elif kind == "phrase" and phrases:
            notes.append(f"Phrase {index} ({plan.phrases[index - 1].text}): {problem.strip()}")
        elif kind == "dialogue":
            notes.append(
                f"Dialogue line {index} ({plan.dialogue[index - 1].text}): {problem.strip()}"
            )
    if drop:
        raw["mixes"] = [
            m
            for m in raw.get("mixes", [])
            if not (
                isinstance(m, dict)
                and isinstance(m.get("text"), str)
                and lesson._squash(m["text"]) in drop
            )
        ]
    if notes:
        raw[REVIEW_KEY] = notes


async def _review_claude(
    client: anthropic.AsyncAnthropic,
    language: Code,
    learner: lesson.Learner,
    raw: Any,
    plan: lesson.Plan | None,
    *,
    phrases: bool,
) -> Usage:
    """Has a second model read the plan Claude wrote (`plan`, `raw` cleaned) and acts on what it
    finds (`apply_review`). The check improves a lesson and never blocks one: a failed or unreadable
    review leaves the plan as written."""
    if plan is None or not isinstance(raw, dict):
        return Usage()
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": REVIEW_SCHEMA},
    }
    try:
        response = await client.beta.messages.create(
            model=MODEL,
            max_tokens=REVIEW_MAX_TOKENS,
            messages=[{"role": "user", "content": review_message(language, learner, plan)}],
            output_config=output_config,
        )
    except anthropic.APIError:
        return Usage()
    used = usage_of(response)
    text = next((b.text for b in response.content if b.type == "text"), None)
    if response.stop_reason in ("refusal", "max_tokens") or text is None:
        return used
    try:
        found = json.loads(text).get("problems")
    except (json.JSONDecodeError, AttributeError):
        return used
    apply_review(raw, plan, found, phrases=phrases)
    return used


async def _ask_claude(
    client: anthropic.AsyncAnthropic, request: str, feedback: str
) -> tuple[Any, Usage]:
    messages: list[dict[str, Any]] = [{"role": "user", "content": request}]
    if feedback:
        messages.append({"role": "user", "content": feedback})
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }
    try:
        response = await client.beta.messages.create(
            model=CHEAP_MODEL,
            max_tokens=MAX_TOKENS,
            messages=cast(list[BetaMessageParam], messages),
            output_config=output_config,
        )
    except anthropic.APIError as e:
        raise LessonFailed(didnt_answer(e, ". Try again in a moment.")) from e
    used = usage_of(response)
    text = next((b.text for b in response.content if b.type == "text"), None)
    if response.stop_reason in ("refusal", "max_tokens") or text is None:
        raise LessonFailed("Claude didn't answer. Try again in a moment.", used)
    try:
        return json.loads(text), used
    except json.JSONDecodeError as e:
        raise LessonFailed("Claude's answer couldn't be read. Try again.", used) from e


def claude_plan(client: anthropic.AsyncAnthropic) -> WritePlan:
    async def write(
        language: Code, scene: str, feedback: str, learner: lesson.Learner, register: Register
    ) -> tuple[Any, Usage]:
        request = request_message(language, scene, learner, register)
        raw, used = await _ask_claude(client, request, feedback)
        plan = lesson.clean_plan(raw, scene)
        return raw, used + await _review_claude(client, language, learner, raw, plan, phrases=True)

    return write


def claude_given_plan(client: anthropic.AsyncAnthropic) -> WriteGiven:
    async def write(
        language: Code,
        scene: str,
        given: tuple[lesson.Phrase, ...],
        feedback: str,
        learner: lesson.Learner,
        register: Register,
    ) -> tuple[Any, Usage]:
        request = given_request_message(language, scene, given, learner, register)
        raw, used = await _ask_claude(client, request, feedback)
        plan = lesson.clean_given_plan(raw, scene, given)
        return raw, used + await _review_claude(client, language, learner, raw, plan, phrases=False)

    return write
