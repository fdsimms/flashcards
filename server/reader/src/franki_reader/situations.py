"""Situations (docs/read-and-listen/architecture.md, Situations): a scene talked through with Claude,
who plays the other person using words from the owner's deck. The owner's lines are theirs to write
(an English word in [brackets] where they don't know one), and at the end Claude says what to fix
in each and which words are worth adding.

Nothing is kept on the server: the app holds the conversation and sends it with each turn, and
Claude is asked only when the owner sends a line (one call a turn, never ahead of time). Nothing
here grades a card or writes a note; a word to add goes to the note queue only on the owner's tap,
and into the deck only when they save it in the note editor.

Generate, then verify: each line of the other person's is re-segmented with the texts' writing
lexicon (words due today and not yet reviewed count as unknown, so a line before their review
doesn't prime them) and sent back once, naming the words, if it uses more than `MAX_UNKNOWN`
outside the known ones. The second try is kept either way, with its unknown words marked and
glossed, since a conversation can't wait for a third.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam, BetaTextBlockParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker, is_word
from franki_reader.gender import wrong_gender_words
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lesson import Learner
from franki_reader.lexicon import Entry
from franki_reader.production import MAX_CHARS, VERDICTS
from franki_reader.register import DEFAULT, Register, instruction

MAX_UNKNOWN = 2  # words in one of their lines outside the known ones
MAX_LINES = 40  # lines in a conversation
MAX_LINE = 400  # characters in one line
MAX_WORDS = 6  # words to add
MAX_REHEARSAL_WORDS = (
    15  # words a cram's rehearsal asks the other person to work in (an audio lesson's limit)
)
MAX_REHEARSAL_WORD = 200  # characters in one of them, with its meaning
MAX_PREPARED = 16  # lines of a cram's talking points a rehearsal is given
MAX_PREPARED_LINE = 240  # characters in one of them, with its label
MAX_TOKENS = 3000
FEEDBACK_TOKENS = 6000

Speaker = Literal["them", "you"]
GENDERS = ("male", "female")

_PLAY = """\
You are playing one side of a spoken conversation with a learner of {language}, as practice. The
situation: {scene}. Stay in role as a real person in that situation would: short, natural spoken
lines, one or two sentences, never a lesson, never English. Ask at most one question in a line,
and react to what the learner just said before asking another; never stack questions. Use words from the list (in any of their
forms) wherever you can; where the situation needs a word that isn't in it, use it. `glosses` gives
the English of every word in your line that isn't in the list, however common the word is (a tap on
a word with no gloss shows no meaning), as a few words for the sense it has in your line.
The learner may write an English word in [brackets] for a word they don't know: carry on as a
helpful native speaker would, and where it's natural, use the {language} word for it in your reply.
Don't correct the learner during the conversation. When the situation has naturally come to an end
(the order is taken, the ride is over), say a natural closing line and set `done`. Plain text only:
no `|`, asterisks, tildes or em dashes.

The word list (word | meaning | M mature, Y young):
"""

START_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "you": {"type": "string"},
        "them": {"type": "string"},
        "name": {"type": "string"},
        "gender": {"type": "string", "enum": list(GENDERS)},
        "line": {"type": "string"},
        "english": {"type": "string"},
        "glosses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"word": {"type": "string"}, "english": {"type": "string"}},
                "required": ["word", "english"],
                "additionalProperties": False,
            },
        },
        "done": {"type": "boolean"},
    },
    "required": ["you", "them", "name", "gender", "line", "english", "glosses", "done"],
    "additionalProperties": False,
}
TURN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        k: START_SCHEMA["properties"][k] for k in ("line", "english", "glosses", "done")
    },
    "required": ["line", "english", "glosses", "done"],
    "additionalProperties": False,
}

FEEDBACK_SYSTEM = (
    "You are a native-speaker tutor. The learner just talked through a situation in the language "
    "with a partner who played the other person. Judge each of the learner's lines (numbered) in "
    'its place in the conversation. For each, give `index`, `verdict` ("right": correct and '
    'natural there; "almost": one or two small slips; "wrong": doesn\'t make sense, says something '
    "else, or has more than two mistakes), `corrected` (the learner's line with only the mistakes "
    "fixed, and any English in [brackets] put in the language; exactly their line when it is right) "
    "and `note` (one short plain English sentence on the main thing that changed, or on why it works "
    f"when it is right; under {MAX_CHARS} characters). Then give `words`: up to {MAX_WORDS} words "
    "worth adding to their deck, most useful first: each word the learner asked for in [brackets] "
    "(as the language says it), then words their partner used that they likely didn't know. Each is "
    'the dictionary form (`word`), its English (`english`) and `why`: "asked" or "heard". Do not '
    "use em dashes."
)

FEEDBACK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "verdict": {"type": "string", "enum": list(VERDICTS)},
                    "corrected": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["index", "verdict", "corrected", "note"],
                "additionalProperties": False,
            },
        },
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "word": {"type": "string"},
                    "english": {"type": "string"},
                    "why": {"type": "string", "enum": ["asked", "heard"]},
                },
                "required": ["word", "english", "why"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["lines", "words"],
    "additionalProperties": False,
}


class SituationFailed(Exception):
    """Written to be shown as it is. `usage` is what the failed call was billed for, when Claude
    answered at all: the caller keeps it (store.save_call_cost)."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class Roles:
    you: str  # the learner's part ("a customer")
    them: str  # the other person's ("the vendor")
    name: str  # the other person's first name
    gender: str  # theirs, for the voice: "male" or "female"


@dataclass(frozen=True)
class Line:
    speaker: Speaker
    text: str


@dataclass(frozen=True)
class Focus:
    """A grammar structure the owner is practicing in this scene (one of Your topics): its title
    and its one-line lead."""

    title: str
    lead: str = ""


@dataclass(frozen=True)
class Conversation:
    language: Code
    scene: str
    roles: Roles | None  # None until the first turn sets them
    lines: tuple[Line, ...]
    focus: Focus | None = None
    # Words the learner wants to use, from a cram they're rehearsing (each "word (meaning)"). The
    # other person is only asked to work them in where the scene allows; none is required.
    words: tuple[str, ...] = ()
    # How casual or formal the other person's lines are, and what the feedback judges them against.
    register: Register = DEFAULT
    # Whether the learner is a man or a woman, which Thai's "I" and polite ending follow.
    learner: Learner = "male"
    # The other person is the learner's own tutor in a lesson, not someone the scene calls for.
    tutor: bool = False
    # What the learner prepared for the lesson (a cram's talking points), as labeled lines.
    prepared: tuple[str, ...] = ()


# One of their lines as Claude wrote it: {line, english, glosses, done}, plus the roles on the
# first turn. `feedback` names the words to avoid on a second try.
Play = Callable[[list[Entry], Conversation, str], Awaitable[tuple[dict[str, Any], Usage]]]
GiveFeedback = Callable[[Conversation], Awaitable[tuple[dict[str, Any], Usage]]]


def _focus_text(focus: Focus) -> str:
    return f"{focus.title} ({focus.lead})" if focus.lead else focus.title


def play_intro(conversation: Conversation) -> str:
    """The cached start of a turn's system prompt: the role, the scene and, when the owner is
    practicing a structure or rehearsing words, a sentence asking the other person to work them in."""
    intro = _PLAY.format(language=LANGUAGES[conversation.language].name, scene=conversation.scene)
    notes: list[str] = []
    if conversation.focus is not None:
        notes.append(
            f"The learner is practicing this structure: {_focus_text(conversation.focus)}. Use it "
            "naturally in your own lines where the scene allows, and phrase your questions so the "
            "learner has a natural chance to use it too. Never name it or explain it during the scene."
        )
    if conversation.words:
        listed = "; ".join(conversation.words)
        notes.append(
            f"The learner is rehearsing for a lesson and wants to use these words: {listed}. Use "
            "them naturally in your own lines where the scene allows, and phrase your questions so the "
            "learner has a natural chance to use them too. Never list them, name them or explain them "
            "during the scene, and do not force one in where it doesn't fit."
        )
    if conversation.tutor:
        notes.append(
            "You are the learner's own tutor, in a lesson, and the situation is the topic you are "
            "talking through with them. Ask about it and react to their answers as a friendly tutor "
            "would, staying on the topic."
        )
    if conversation.prepared:
        listed = "\n".join(f"- {p}" for p in conversation.prepared)
        notes.append(
            "The learner has prepared for this conversation:\n"
            f"{listed}\n"
            "This is background for you, not a script to get through. Have the conversation a "
            "real person would: follow what the learner actually says, and answer or ask about "
            "that before anything else. If they bring up something new, stay with it for as "
            "long as it is natural. Only when the conversation has reached one of these topics "
            "on its own, ask the question they expect about it, in your own words, and leave "
            "room for them to ask theirs and tell their story. Never steer back to the list, "
            "never change the subject to reach an item, and don't try to cover all of it: it is "
            "fine if some of it never comes up. Never read this list out or mention that they "
            "prepared."
        )
    if conversation.register != DEFAULT:
        notes.append(f"Register for your lines: {instruction(conversation.register)}")
    if not notes:
        return intro
    head, _, words = intro.rpartition("The word list")
    return f"{head}{chr(10).join(notes)}\n\nThe word list{words}"


# The learner's lines are said as themselves, so they are judged and corrected as a man's or a
# woman's Thai (lesson_writer.thai_problems has the same rule for a lesson's phrases).
_THAI_LEARNER: dict[Learner, str] = {
    "male": (
        " The learner is a man: ผม and ครับ are right for him, and ฉัน, ดิฉัน, ค่ะ and คะ are not."
        " In `corrected`, change those to ผม and ครับ, and never add them to a line that is right."
    ),
    "female": (
        " The learner is a woman: ดิฉัน or ฉัน, ค่ะ (statements) and คะ (questions) are right for"
        " her, and ผม and ครับ are not. In `corrected`, change those, and never add them to a line"
        " that is right."
    ),
}


def feedback_system(conversation: Conversation) -> str:
    """The feedback prompt, with a sentence about the structure being practiced when there is one,
    and one about the register when it isn't the default."""
    text = FEEDBACK_SYSTEM
    if conversation.focus is not None:
        text += (
            f" The learner was practicing this structure: {_focus_text(conversation.focus)}. In "
            "each `note`, say how that line used it, or where it could have, whenever that is the "
            "most useful thing to say about the line."
        )
    if conversation.register != DEFAULT:
        text += (
            f" The learner chose a {conversation.register} register for this scene, so judge"
            " how natural each line is for that register, not for everyday speech."
        )
    if conversation.language == "th":
        text += _THAI_LEARNER[conversation.learner]
    return text


def word_list(entries: list[Entry]) -> str:
    """The deck's studied words as the texts' prompt lists them, without the texts' own writing
    rules (`|` between words, asterisks), which a conversation doesn't use. Sorted by note id so it's
    byte-identical between turns on the same snapshot, for the cache."""
    known = sorted((e for e in entries if e.tier != "unreviewed"), key=lambda e: e.note_id)
    return "\n".join(
        f"{e.text} | {e.meaning} | {'M' if e.tier == 'mature' else 'Y'}" for e in known
    )


_THAI_FIT = {
    "male": " In Thai, say ผม and ครับ, never ดิฉัน, ค่ะ or คะ.",
    "female": " In Thai, say ดิฉัน or ฉัน, ค่ะ and คะ, never ผม or ครับ.",
}
_THAI_SPEAKER = {
    "th": (
        " Your gender decides your Thai: a man says ผม and ครับ, a woman ดิฉัน, ค่ะ and คะ."
        " Pick a name that fits it, and write every line to match."
    )
}


def conversation_message(conversation: Conversation) -> str:
    """The user message of a turn: the parts, then the conversation so far."""
    roles = conversation.roles
    language = conversation.language
    parts = []
    if roles is None and conversation.tutor:
        parts.append(
            "Start the conversation. The learner's part (`you`) is their student and yours (`them`) "
            "is their tutor; give yourself a first name and gender, and say the first line."
            + _THAI_SPEAKER.get(language, "")
        )
    elif roles is None:
        parts.append(
            "Start the conversation. Choose the two parts the situation calls for (`you`: the "
            'learner\'s, like "a customer"; `them`: yours, like "the vendor"), a first name and '
            "gender for yourself, and say the first line." + _THAI_SPEAKER.get(language, "")
        )
    else:
        parts.append(
            f"The learner is {roles.you}. You are {roles.them}, {roles.name}, "
            f"{'a woman' if roles.gender == 'female' else 'a man'}."
            + (
                _THAI_FIT[roles.gender]
                if conversation.language == "th" and roles.gender in _THAI_FIT
                else ""
            )
        )
        parts.append("The conversation so far:")
        for line in conversation.lines:
            who = roles.name if line.speaker == "them" else "Learner"
            parts.append(f"{who}: {line.text}")
        parts.append(f"Say {roles.name}'s next line.")
    return "\n".join(parts)


def unknown_words(line: str, checker: Checker) -> list[str]:
    """The words in one of their lines that count as unknown, each once, in order."""
    out: list[str] = []
    for token in checker.segment(line):
        if is_word(token) and checker.status(token) != "known" and token not in out:
            out.append(token)
    return out


def clean_line(answer: dict[str, Any]) -> dict[str, Any] | None:
    """Their line, its English, its glosses and whether it ends the scene, trimmed; None without a
    line or with markup left in it. On a first turn, the roles too (None if they're missing)."""
    line, english = answer.get("line"), answer.get("english")
    if not isinstance(line, str) or not isinstance(english, str):
        return None
    line = " ".join(line.split())
    if not line or any(c in line for c in "|*~—"):
        return None
    glosses: dict[str, str] = {}
    for g in answer.get("glosses") or []:
        if not isinstance(g, dict):
            continue
        word, meaning = g.get("word"), g.get("english")
        if isinstance(word, str) and isinstance(meaning, str) and word.strip() and meaning.strip():
            glosses[word.strip()] = meaning.strip()[:MAX_CHARS]
    out: dict[str, Any] = {
        "line": line[:MAX_LINE],
        "english": english.strip()[:MAX_LINE],
        "glosses": glosses,
        "done": answer.get("done") is True,
    }
    if "you" in answer:
        roles = {k: answer.get(k) for k in ("you", "them", "name", "gender")}
        if not all(isinstance(v, str) and v.strip() for v in roles.values()):
            return None
        if roles["gender"] not in GENDERS:
            return None
        out["roles"] = {k: cast(str, v).strip()[:80] for k, v in roles.items()}
    return out


async def next_line(
    play: Play, entries: list[Entry], conversation: Conversation, checker: Checker
) -> tuple[dict[str, Any], list[str], Usage]:
    """Their next line, sent back once naming its unknown words when it has more than
    `MAX_UNKNOWN`. Returns the cleaned line, its unknown words and what both calls cost."""
    raw, used = await play(entries, conversation, "")
    line = clean_line(raw)
    # A first turn sets the parts; without them the app can't carry on.
    if line is not None and conversation.roles is None and "roles" not in line:
        line = None
    if line is None:
        raise SituationFailed("Claude's line couldn't be used. Try again.", used)
    line, used = await _fit_gender(play, entries, conversation, line, used)
    unknown = unknown_words(line["line"], checker)
    if len(unknown) <= MAX_UNKNOWN:
        return line, unknown, used
    feedback = (
        f"Your line used {len(unknown)} words outside the list: {', '.join(unknown)}. Say it again "
        f"with at most {MAX_UNKNOWN}, keeping it natural."
    )
    try:
        raw2, used2 = await play(entries, conversation, feedback)
    except SituationFailed as e:
        # The first line is still usable: keep it rather than lose the turn.
        return line, unknown, used + e.usage
    second = clean_line(raw2)
    total = used + used2
    if second is None or ("roles" in line and "roles" not in second):
        return line, unknown, total
    return second, unknown_words(second["line"], checker), total


def _speaker_gender(conversation: Conversation, line: dict[str, Any]) -> str | None:
    roles = line.get("roles") or (conversation.roles and {"gender": conversation.roles.gender})
    return roles["gender"] if roles else None


async def _fit_gender(
    play: Play,
    entries: list[Entry],
    conversation: Conversation,
    line: dict[str, Any],
    used: Usage,
) -> tuple[dict[str, Any], Usage]:
    """A Thai line that uses the other gender's words (a man's ครับ said in a woman's voice) is
    sent back once. When it still doesn't fit on a first turn, the speaker's gender follows the
    line, so the voice at least matches what is said; a later turn keeps the line, since the
    speaker's gender is already set."""
    gender = _speaker_gender(conversation, line)
    wrong = wrong_gender_words(conversation.language, line["line"], gender or "")
    if not wrong:
        return line, used
    who = "a man" if gender == "male" else "a woman"
    feedback = (
        f"Your line used {wrong[0]}, which doesn't fit {who}. You are {who}: say it again "
        + ("with ผม and ครับ." if gender == "male" else "with ดิฉัน, ค่ะ and คะ.")
    )
    try:
        raw2, used2 = await play(entries, conversation, feedback)
    except SituationFailed as e:
        return line, used + e.usage
    second = clean_line(raw2)
    total = used + used2
    if second is not None and ("roles" in line) == ("roles" in second):
        if "roles" in second:
            second["roles"]["gender"] = line["roles"]["gender"]
        if not wrong_gender_words(conversation.language, second["line"], gender or ""):
            return second, total
        line = second
    if "roles" in line:
        line["roles"]["gender"] = "female" if gender == "male" else "male"
    return line, total


def feedback_message(conversation: Conversation) -> str:
    roles = conversation.roles
    parts = [
        f"Language: {LANGUAGES[conversation.language].name}",
        f"Situation: {conversation.scene}",
    ]
    if roles is not None:
        parts.append(f"The learner was {roles.you}; their partner was {roles.them}, {roles.name}.")
    parts.append("The conversation:")
    for i, line in enumerate(conversation.lines):
        who = f"Learner line {i}" if line.speaker == "you" else (roles.name if roles else "Partner")
        parts.append(f"{who}: {line.text}")
    return "\n".join(parts)


def clean_feedback(
    answer: dict[str, Any], conversation: Conversation, checker: Checker
) -> dict[str, Any]:
    """Each of the learner's lines with its verdict, corrected version and note (lines Claude said
    nothing of left out), and the words worth adding: each one kept only if it isn't already known,
    and, if heard, if it was in one of their lines."""
    theirs = " ".join(ln.text for ln in conversation.lines if ln.speaker == "them").casefold()
    yours = {i for i, ln in enumerate(conversation.lines) if ln.speaker == "you"}
    lines: list[dict[str, Any]] = []
    seen: set[int] = set()
    for item in answer.get("lines") or []:
        if not isinstance(item, dict):
            continue
        index, verdict = item.get("index"), item.get("verdict")
        corrected, note = item.get("corrected"), item.get("note")
        if not isinstance(index, int) or index not in yours or index in seen:
            continue
        if verdict not in VERDICTS or not isinstance(corrected, str) or not isinstance(note, str):
            continue
        own = conversation.lines[index].text
        fixed = own if verdict == "right" else " ".join(corrected.split())
        if not fixed or "—" in fixed:
            continue
        seen.add(index)
        lines.append(
            {
                "index": index,
                "verdict": verdict,
                "corrected": fixed,
                "note": note.strip()[:MAX_CHARS],
            }
        )
    words: list[dict[str, str]] = []
    taken: set[str] = set()
    for item in answer.get("words") or []:
        if not isinstance(item, dict):
            continue
        word, english, why = item.get("word"), item.get("english"), item.get("why")
        if (
            not isinstance(word, str)
            or not isinstance(english, str)
            or why not in ("asked", "heard")
        ):
            continue
        word, english = word.strip(), english.strip()
        key = word.casefold()
        if not word or not english or key in taken or checker.status(word) == "known":
            continue
        if why == "heard" and key not in theirs:
            continue
        taken.add(key)
        words.append({"word": word, "english": english[:MAX_CHARS], "why": cast(str, why)})
    return {"lines": sorted(lines, key=lambda x: x["index"]), "words": words[:MAX_WORDS]}


async def _ask(
    client: anthropic.AsyncAnthropic,
    system: list[BetaTextBlockParam] | str,
    messages: list[dict[str, Any]],
    schema: dict[str, Any],
    max_tokens: int,
) -> tuple[dict[str, Any], Usage]:
    output_config: BetaOutputConfigParam = {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": schema},
    }
    try:
        response = await client.beta.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=cast(list[BetaMessageParam], messages),
            output_config=output_config,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIError as e:
        raise SituationFailed(didnt_answer(e, ". Try again in a moment.")) from e
    used = usage_of(response)
    text = next((b.text for b in response.content if b.type == "text"), None)
    if response.stop_reason in ("refusal", "max_tokens") or text is None:
        raise SituationFailed("Claude didn't answer. Try again in a moment.", used)
    try:
        answer = json.loads(text)
    except json.JSONDecodeError as e:
        raise SituationFailed("Claude's answer couldn't be read. Try again.", used) from e
    if not isinstance(answer, dict):
        raise SituationFailed("Claude's answer couldn't be read. Try again.", used)
    return answer, used


def claude_play(client: anthropic.AsyncAnthropic) -> Play:
    async def play(
        entries: list[Entry], conversation: Conversation, feedback: str
    ) -> tuple[dict[str, Any], Usage]:
        intro = play_intro(conversation)
        # The scene is fixed for a conversation and the word list for a snapshot, so both are cached
        # from the second turn on; the conversation, which grows, is the message.
        system: list[BetaTextBlockParam] = [
            {
                "type": "text",
                "text": intro + word_list(entries),
                "cache_control": {"type": "ephemeral"},
            }
        ]
        messages: list[dict[str, Any]] = [
            {"role": "user", "content": conversation_message(conversation)}
        ]
        if feedback:
            messages.append({"role": "user", "content": feedback})
        schema = START_SCHEMA if conversation.roles is None else TURN_SCHEMA
        return await _ask(client, system, messages, schema, MAX_TOKENS)

    return play


def claude_feedback(client: anthropic.AsyncAnthropic) -> GiveFeedback:
    async def give(conversation: Conversation) -> tuple[dict[str, Any], Usage]:
        messages = [{"role": "user", "content": feedback_message(conversation)}]
        system = feedback_system(conversation)
        return await _ask(client, system, messages, FEEDBACK_SCHEMA, FEEDBACK_TOKENS)

    return give
