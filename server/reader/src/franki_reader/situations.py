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

from franki_reader.coverage import Checker, is_word
from franki_reader.generator import MODEL, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry
from franki_reader.production import MAX_CHARS, VERDICTS

MAX_UNKNOWN = 2  # words in one of their lines outside the known ones
MAX_LINES = 40  # lines in a conversation
MAX_LINE = 400  # characters in one line
MAX_WORDS = 6  # words to add
MAX_TOKENS = 3000
FEEDBACK_TOKENS = 6000

Speaker = Literal["them", "you"]
GENDERS = ("male", "female")

_PLAY = """\
You are playing one side of a spoken conversation with a learner of {language}, as practice. The
situation: {scene}. Stay in role as a real person in that situation would: short, natural spoken
lines, one or two sentences, never a lesson, never English. Use words from the list (in any of their
forms) wherever you can; where the situation needs a word that isn't in it, use it and gloss it.
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
class Conversation:
    language: Code
    scene: str
    roles: Roles | None  # None until the first turn sets them
    lines: tuple[Line, ...]


# One of their lines as Claude wrote it: {line, english, glosses, done}, plus the roles on the
# first turn. `feedback` names the words to avoid on a second try.
Play = Callable[[list[Entry], Conversation, str], Awaitable[tuple[dict[str, Any], Usage]]]
GiveFeedback = Callable[[Conversation], Awaitable[tuple[dict[str, Any], Usage]]]


def word_list(entries: list[Entry]) -> str:
    """The deck's studied words as the texts' prompt lists them, without the texts' own writing
    rules (`|` between words, asterisks), which a conversation doesn't use. Sorted by note id so it's
    byte-identical between turns on the same snapshot, for the cache."""
    known = sorted((e for e in entries if e.tier != "unreviewed"), key=lambda e: e.note_id)
    return "\n".join(
        f"{e.text} | {e.meaning} | {'M' if e.tier == 'mature' else 'Y'}" for e in known
    )


def conversation_message(conversation: Conversation) -> str:
    """The user message of a turn: the parts, then the conversation so far."""
    roles = conversation.roles
    parts = []
    if roles is None:
        parts.append(
            "Start the conversation. Choose the two parts the situation calls for (`you`: the "
            'learner\'s, like "a customer"; `them`: yours, like "the vendor"), a first name and '
            "gender for yourself, and say the first line."
        )
    else:
        parts.append(f"The learner is {roles.you}. You are {roles.them}, {roles.name}.")
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
        "effort": "low",
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
        raise SituationFailed(
            f"Claude didn't answer ({type(e).__name__}). Try again in a moment."
        ) from e
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
        language = LANGUAGES[conversation.language].name
        intro = _PLAY.format(language=language, scene=conversation.scene)
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
        return await _ask(client, FEEDBACK_SYSTEM, messages, FEEDBACK_SCHEMA, FEEDBACK_TOKENS)

    return give
