"""Grammar points Claude writes once a language's catalog is nearly used up (docs/read-and-listen/
architecture.md, Grammar, "Points Claude writes"), so rotation (rotation.py) always has a next point.

When a language has at most `LEFT` points neither practiced nor known, the engine asks for one new
point (`Engine.write_next_point`), at most `PER_DAY` a study day. Claude proposes the next point to
learn and describes how to find it as data (`grammar.FinderSpec`: marker words and the neighbors that
rule a match out, the shape every Thai finder in the catalog already has), with example lines and
look-alike lines that use a marker word in another sense.

Generate, then verify. A point is kept only when:
- at least `MIN_EXAMPLES` examples pass Your topics' checks (no markup, at most
  `grammar_topics.MAX_UNKNOWN` unknown words) and its finder finds it in every one of them;
- its finder finds nothing in any look-alike line;
- no point the language already has finds it in most of the examples (a duplicate).
Code can't check that the explanation is right, so the app labels the point "Written by Claude".
Japanese isn't written for: its finders need Sudachi's morphemes (`grammar.SPEC_LANGUAGES`).

Nothing here schedules or grades a card.
"""

import json
import logging
import sqlite3
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam, BetaTextBlockParam

from franki_reader import grammar, grammar_topics, store
from franki_reader.claude_errors import spend_limit_message
from franki_reader.coverage import Checker, parse_line
from franki_reader.generator import MODEL, Usage, system_prompt, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry

log = logging.getLogger(__name__)

LEFT = 1  # points neither practiced nor known at or below which a new one is written
PER_DAY = 1  # writes a language, a study day
MIN_EXAMPLES = 3
MAX_NAME = 60
MAX_NOTE = 60
MAX_MARKERS = 4
MAX_MARKER_WORDS = 3
MAX_TOKENS = 6000

_REQUEST = """\
The learner is working through {language} grammar. These are the points they have, easiest first, \
and they have practiced or know nearly all of them:
{points}

Propose the next grammar point for them to learn: one a little harder than these, common in \
everyday {language}, and not the same as any listed. It must be recognizable in a sentence from \
its marker word or words alone, with no parsing: a particle, a fixed word or a fixed phrase \
({kind}). Give:
- name: as the list names points, {name_example}, at most {max_name} characters
- note: what it does in a few words, with no example in it, at most {max_note} characters
- example: one or two short examples with their English, as the list does
- explanation: 2 to 4 short paragraphs separated by a blank line: when to use it, how it is \
formed, and what it is easy to confuse with. Put each {language} word or phrase in **double \
asterisks**, closed, followed by its English in quotes.
- markers: the word or words that show the point, as they are written in a sentence{case}
- not_these: {not_these}
- not_before: words that, right after a marker, mean the marker is used in another sense
- not_after: words that, right before a marker, mean the same
- not_first: true if the marker is another word when it opens a sentence
- examples: 4 to 6 short, natural sentences of 4 to 10 words that use the point, using only words \
from the list above. Give each its `line`, its `english`, and `words`: the marker as it appears \
in the line.
- lookalikes: 0 to 3 short sentences that use a marker word in another sense, with their \
`english`; the point must not be found in them.

Plain text only: no `|`, no tildes, no asterisks except in the explanation, and no em dashes. Use \
American English for the English."""

_THAI = {
    "kind": "like เคย or ที่สุด",
    "name_example": 'the marker then its English in brackets, like "เคย (have ever)"',
    "case": "",
    "not_these": "longer words that merely start with a marker and are something else, like "
    "กำลังใจ for กำลัง",
}
_SPACED = {
    "kind": 'like Polish "czy" or Norwegian "skal"',
    "name_example": 'in English, like "Questions with czy" or "Future with skal"',
    "case": ", in lower case; a phrase with its words separated by spaces",
    "not_these": "leave empty",
}

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "note": {"type": "string"},
        "example": {"type": "string"},
        "explanation": {"type": "string"},
        "markers": {"type": "array", "items": {"type": "string"}},
        "not_these": {"type": "array", "items": {"type": "string"}},
        "not_before": {"type": "array", "items": {"type": "string"}},
        "not_after": {"type": "array", "items": {"type": "string"}},
        "not_first": {"type": "boolean"},
        "examples": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "line": {"type": "string"},
                    "english": {"type": "string"},
                    "words": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["line", "english", "words"],
                "additionalProperties": False,
            },
        },
        "lookalikes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"line": {"type": "string"}, "english": {"type": "string"}},
                "required": ["line", "english"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "name",
        "note",
        "example",
        "explanation",
        "markers",
        "not_these",
        "not_before",
        "not_after",
        "not_first",
        "examples",
        "lookalikes",
    ],
    "additionalProperties": False,
}


class PointFailed(Exception):
    """Claude couldn't write; `usage` is what a call that Claude answered was billed for."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Writes a proposed point as raw JSON, and what it cost.
WritePoint = Callable[[list[Entry], Code, str], Awaitable[tuple[dict[str, Any], Usage]]]


def needs_point(language: Code, choices: Mapping[str, str]) -> bool:
    """Whether the language is short of points to learn next (at most `LEFT` neither practiced nor
    known), and Claude can write one for it."""
    if language not in grammar.SPEC_LANGUAGES:
        return False
    left = [
        p for p in grammar.points_for(language) if choices.get(p.id, "unset") in ("unset", "avoid")
    ]
    return len(left) <= LEFT


def request_message(language: Code) -> str:
    points = "\n".join(
        f"- {p.name}: {p.note} (e.g. {p.example})"
        for p in sorted(grammar.points_for(language), key=lambda p: p.level)
    )
    return _REQUEST.format(
        language=LANGUAGES[language].name,
        points=points,
        max_name=MAX_NAME,
        max_note=MAX_NOTE,
        **(_THAI if language == "th" else _SPACED),
    )


def _strings(raw: object, limit: int = 20) -> tuple[str, ...] | None:
    if not isinstance(raw, list) or len(raw) > limit:
        return None
    out = []
    for item in raw:
        if not isinstance(item, str) or not item.strip() or any(c in item for c in "|*~—"):
            return None
        out.append(" ".join(item.split()))
    return tuple(out)


def check_point(
    raw: dict[str, Any], checker: Checker, language: Code, point_id: str, level: int
) -> tuple[dict[str, Any] | None, str]:
    """The point to keep as `store.save_written_point` takes it, or None and why it was dropped
    (see the module's docstring)."""
    name, note, example = (grammar_topics._clean(raw.get(k)) for k in ("name", "note", "example"))
    explanation = grammar_topics.check_explanation(raw.get("explanation"))
    if not name or len(name) > MAX_NAME or not note or len(note) > MAX_NOTE or not example:
        return None, "name, note or example missing or too long"
    if explanation is None or any(c in name + note + example for c in "|*~"):
        return None, "markup in the text"
    markers = _strings(raw.get("markers"), MAX_MARKERS)
    if not markers or any(len(m.split()) > MAX_MARKER_WORDS for m in markers):
        return None, "no usable markers"
    not_these, not_before, not_after = (
        _strings(raw.get(k)) for k in ("not_these", "not_before", "not_after")
    )
    if not_these is None or not_before is None or not_after is None:
        return None, "unusable exclusions"
    spec = grammar.FinderSpec(
        markers, not_these, not_before, not_after, raw.get("not_first") is True
    )
    find = grammar.finder_from_spec(language, spec)

    def found(line: str) -> bool:
        plain = parse_line(line, checker.spaced)[0]
        return bool(find(grammar.words(plain, checker)))

    examples = grammar_topics.check_examples(raw.get("examples"), checker)
    examples = [e for e in examples if found(e["line"])]
    if len(examples) < MIN_EXAMPLES:
        return None, "too few examples where its finder finds it"
    lookalikes = raw.get("lookalikes")
    if not isinstance(lookalikes, list):
        return None, "no look-alike list"
    for item in lookalikes:
        line = item.get("line") if isinstance(item, dict) else None
        if isinstance(line, str) and found(line):
            return None, "its finder fires on a look-alike line"

    # The same point when another finds it on the same words, not anywhere in the line: case and
    # aspect are found in nearly every line, whatever point it was written for.
    def overlaps(line: str, other: grammar.Point) -> bool:
        ws = grammar.words(parse_line(line, checker.spaced)[0], checker)
        mine = {k for a, b in find(ws) for k in range(a, b)}
        return any(k in mine for a, b in other.find(ws) for k in range(a, b))

    for other in grammar.points_for(language):
        hits = sum(1 for e in examples if overlaps(e["line"], other))
        if hits * 2 > len(examples):
            return None, f"the same as {other.id}"
    data = {
        "name": name,
        "note": note,
        "example": example,
        "explanation": explanation,
        "level": level,
        "related": [],
        # A Thai point is named after its marker, like every Thai point in the catalog.
        "word_named": language == "th" or name.casefold().startswith(markers[0].casefold()),
        "spec": {
            "markers": list(markers),
            "not_these": list(not_these),
            "not_before": list(not_before),
            "not_after": list(not_after),
            "not_first": spec.not_first,
        },
    }
    return data, ""


def next_id(conn: sqlite3.Connection, language: Code) -> str:
    """`<language>.c<n>`: c for Claude, never one of the catalog's ids."""
    taken = {p.id for p in grammar.points_for(language)} | {
        p.id for p in store.written_points(conn, language)
    }
    n = 1
    while f"{language}.c{n}" in taken:
        n += 1
    return f"{language}.c{n}"


async def write_point(
    conn: sqlite3.Connection,
    snapshot: Callable[[Code], tuple[list[Entry], Checker]],
    write: WritePoint,
    language: Code,
    now: datetime,
) -> grammar.Point | None:
    """Asks Claude for the language's next point and keeps it if it passes; the point, or None.
    Never raises: this runs unattended, and its cost is kept either way."""
    cost = 0.0
    try:
        entries, checker = snapshot(language)
        try:
            raw, used = await write(entries, language, request_message(language))
        except PointFailed as e:
            cost = e.usage.cost_usd()
            log.warning("Couldn't write a %s grammar point: %s", language, e)
            return None
        cost = used.cost_usd()
        level = max((p.level for p in grammar.points_for(language)), default=0) + 1
        point_id = next_id(conn, language)
        data, why = check_point(raw, checker, language, point_id, level)
        if data is None:
            log.warning("Dropped a %s grammar point Claude wrote: %s", language, why)
            return None
        point = store.save_written_point(conn, point_id, language, data, now)
        log.info("Claude wrote the %s grammar point %s: %s", language, point_id, point.name)
        return point
    except Exception:
        log.exception("Writing a %s grammar point failed", language)
        return None
    finally:
        store.save_call_cost(conn, "written_points", language, now, cost)


def claude_points(client: anthropic.AsyncAnthropic) -> WritePoint:
    output: BetaOutputConfigParam = {
        "effort": "high",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(
        entries: list[Entry], language: Code, message: str
    ) -> tuple[dict[str, Any], Usage]:
        system: list[BetaTextBlockParam] = [
            {
                "type": "text",
                "text": system_prompt(entries, language),
                "cache_control": {"type": "ephemeral"},
            }
        ]
        messages = [{"role": "user", "content": message}]
        try:
            response = await client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=cast(list[BetaMessageParam], messages),
                output_config=output,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            raise PointFailed(spend_limit_message(e) or "Claude didn't answer.") from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise PointFailed("Claude didn't write a point.", used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise PointFailed("Claude's answer couldn't be read.", used) from e
        if not isinstance(answer, dict):
            raise PointFailed("Claude's answer couldn't be read.", used)
        return answer, used

    return write
