"""Your topics (docs/read-and-listen/architecture.md, Your topics): a grammar page on a topic the
owner names (Thai "Serial verbs") that the fixed catalog (grammar_points.json) doesn't have. Claude
writes it, in the background, from the known words: a one-line `lead`, an `explanation` in the
catalog's format and a few `examples`.

Generate, then verify, with what code can verify: each example is kept only if it has at most
`MAX_UNKNOWN` words outside the known ones (the check drills.check applies), has no markup, has its
`words` (the part that shows the structure) in the line in order, and isn't a repeat. An example
that fails is dropped, never repaired, and fewer than `MIN_EXAMPLES` left fails the write. Code does
not check that the grammar is right: the app labels the page "Written by Claude".

Nothing here finds the structure in texts, counts exposure, schedules, grades a card or writes a
note. A page is asked for, so each write is counted: at most `MAX_WRITES_PER_DAY` in a study day,
and `MAX_TOPICS` pages a language.

A write that fails leaves what the page already had: a page never written is `failed`, one with
content stays `ready` and carries a `note` saying what happened, until the next write succeeds.
"""

import json
import logging
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam, BetaTextBlockParam

from franki_reader import store
from franki_reader.claude_errors import spend_limit_message
from franki_reader.coverage import Checker, is_word, parse_line
from franki_reader.generator import MODEL, Usage, system_prompt, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry

log = logging.getLogger(__name__)

MAX_UNKNOWN = 1  # words in an example outside the known ones
MIN_EXAMPLES = 3
MAX_EXAMPLES = 6
MAX_LEAD = 120
MAX_TITLE = 80
MAX_WRITES_PER_DAY = 10  # Claude writes a study day, across every page
MAX_TOPICS = 30  # pages a language
MAX_TOKENS = 6000

Kind = Literal["page", "examples"]

TOO_FEW = (
    "Couldn't write enough examples from words you know. Try again, or name the topic another way."
)
UNUSABLE = (
    "Couldn't use what Claude wrote for this topic. Try again, or name the topic another way."
)

INTERRUPTED = "This page didn't finish writing. Try again."

_FORMAT = """\
Plain text only: no `|`, no tildes, no asterisks except as described, and no em dashes anywhere.
Use American English for the English."""

_EXAMPLES = """\
- examples: {count} short, natural sentences of 4 to 10 words that show the structure, using only
  words from the list. Give each its `line`, its `english`, and `words`: the part or parts of `line`
  that show the structure, copied exactly from it and in the order they appear."""

_PAGE = (
    """\
Write a short grammar page for a learner of {language} on this topic: {title}

The learner's known words are listed above; the page is for someone who knows only those. Give:
- lead: one line of at most {lead} characters stating the idea, which is shown as the headline
- explanation: 2 to 4 short paragraphs separated by a blank line. Say when to use the structure,
  how it is formed, and what it is easy to confuse with. Put each {language} word or phrase in
  **double asterisks**, closed, followed by its English in quotes, the way the examples in this
  catalog entry do: {sample}
"""
    + _EXAMPLES.format(count="3 to 6")
    + "\n"
    + _FORMAT
)

_EXAMPLES_ONLY = (
    """\
Write a fresh set of examples for this grammar page on {title} in {language}.

The page's headline: {lead}

{explanation}

These examples are already shown, so write different ones: {old}

Give:
"""
    + _EXAMPLES.format(count="3 to 6")
    + "\n"
    + _FORMAT
)

_SAMPLE = (
    '"Regular endings: -ar verbs take **-é, -aste, -ó** (hablé, habló). It is for things that '
    'finished: **ayer comí paella**, \\"I ate paella yesterday\\"."'
)

_EXAMPLE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "line": {"type": "string"},
        "english": {"type": "string"},
        "words": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["line", "english", "words"],
    "additionalProperties": False,
}
_EXAMPLES_SCHEMA: dict[str, Any] = {"type": "array", "items": _EXAMPLE_SCHEMA}
PAGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "lead": {"type": "string"},
        "explanation": {"type": "string"},
        "examples": _EXAMPLES_SCHEMA,
    },
    "required": ["lead", "explanation", "examples"],
    "additionalProperties": False,
}
EXAMPLES_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"examples": _EXAMPLES_SCHEMA},
    "required": ["examples"],
    "additionalProperties": False,
}


class TopicFailed(Exception):
    """Claude couldn't write; the message is shown to the owner as it is. `usage` is what the
    failed call was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


@dataclass(frozen=True)
class Page:
    """What a write is for: the topic's title, and for fresh examples what's already on the page."""

    title: str
    lead: str = ""
    explanation: str = ""
    examples: tuple[str, ...] = ()  # lines already shown


# Writes a page (`kind` "page") or a fresh set of examples (`kind` "examples") as raw JSON:
# {lead, explanation, examples} or {examples}, and what it cost.
WriteTopic = Callable[[list[Entry], Code, Page, Kind], Awaitable[tuple[dict[str, Any], Usage]]]


def request_message(language: Code, page: Page, kind: Kind) -> str:
    name = LANGUAGES[language].name
    if kind == "page":
        return _PAGE.format(language=name, title=page.title, lead=MAX_LEAD, sample=_SAMPLE)
    return _EXAMPLES_ONLY.format(
        language=name,
        title=page.title,
        lead=page.lead,
        explanation=page.explanation,
        old="; ".join(page.examples) or "(none)",
    )


def _clean(text: object) -> str | None:
    """A string with no em dash or table markup in it, trimmed; None otherwise."""
    if not isinstance(text, str) or "—" in text:
        return None
    return text.strip() or None


def check_example(raw: object, checker: Checker) -> dict[str, Any] | None:
    """An example Claude wrote, kept only if the code agrees with it (see the module's docstring)."""
    if not isinstance(raw, dict):
        return None
    line, english, words = _clean(raw.get("line")), _clean(raw.get("english")), raw.get("words")
    if line is None or english is None or not isinstance(words, list) or not words:
        return None
    line = " ".join(line.split())
    if any(c in line + english for c in "|*~"):
        return None
    kept: list[str] = []
    at = 0
    for w in words:
        if not isinstance(w, str) or not w.strip() or "—" in w:
            return None
        w = w.strip()
        found = line.find(w, at)
        if found < 0:
            return None
        kept.append(w)
        at = found + len(w)
    plain, _ = parse_line(line, checker.spaced)
    unknown = [t for t in checker.segment(plain) if is_word(t) and checker.status(t) != "known"]
    if len(unknown) > MAX_UNKNOWN:
        return None
    return {"line": line, "english": english, "words": kept}


def check_examples(raw: object, checker: Checker) -> list[dict[str, Any]]:
    """The examples that pass, without repeats, at most `MAX_EXAMPLES`."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw if isinstance(raw, list) else []:
        kept = check_example(item, checker)
        if kept is None or kept["line"].casefold() in seen:
            continue
        seen.add(kept["line"].casefold())
        out.append(kept)
    return out[:MAX_EXAMPLES]


def check_lead(raw: object) -> str | None:
    lead = _clean(raw)
    if lead is None or len(lead) > MAX_LEAD or any(c in lead for c in "|*~\n"):
        return None
    return lead


def check_explanation(raw: object) -> str | None:
    """Paragraphs separated by a blank line, with every `**` closed."""
    text = _clean(raw)
    if text is None or text.count("**") % 2 or "|" in text or "~" in text:
        return None
    paragraphs = [" ".join(p.split()) for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        return None
    return "\n\n".join(paragraphs)


async def write_page(
    conn: sqlite3.Connection,
    snapshot: Callable[[Code], tuple[list[Entry], Checker]],
    write: WriteTopic,
    topic_id: int,
    kind: Kind,
    write_id: int,
) -> None:
    """Writes a page, or fresh examples, for a topic and stores the result; the caller has already
    marked it writing and counted the write (`write_id`). Never raises: a failure is on the page."""
    topic = store.get_grammar_topic(conn, topic_id)
    if topic is None:
        store.finish_grammar_topic_write(conn, write_id, 0.0)
        return
    cost = 0.0
    try:
        entries, checker = snapshot(topic.language)
        page = Page(
            topic.title, topic.lead, topic.explanation, tuple(e["line"] for e in topic.examples)
        )
        try:
            raw, used = await write(entries, topic.language, page, kind)
        except TopicFailed as e:
            cost = e.usage.cost_usd()
            log.warning("Couldn't write the page on %s: %s", topic.title, e)
            store.fail_grammar_topic_write(conn, topic_id, str(e))
            return
        cost = used.cost_usd()
        examples = check_examples(raw.get("examples"), checker)
        if len(examples) < MIN_EXAMPLES:
            store.fail_grammar_topic_write(conn, topic_id, TOO_FEW)
            return
        lead = explanation = None
        if kind == "page":
            lead, explanation = (
                check_lead(raw.get("lead")),
                check_explanation(raw.get("explanation")),
            )
            if lead is None or explanation is None:
                store.fail_grammar_topic_write(conn, topic_id, UNUSABLE)
                return
        store.save_grammar_topic_page(conn, topic_id, lead, explanation, examples)
    except Exception:
        # A background task: the page must not be left "writing".
        log.exception("Writing the page on topic %s failed", topic_id)
        store.fail_grammar_topic_write(conn, topic_id, UNUSABLE)
    finally:
        store.finish_grammar_topic_write(conn, write_id, cost)


def claude_topics(client: anthropic.AsyncAnthropic) -> WriteTopic:
    page_format: BetaOutputConfigParam = {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": PAGE_SCHEMA},
    }
    examples_format: BetaOutputConfigParam = {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": EXAMPLES_SCHEMA},
    }

    async def write(
        entries: list[Entry], language: Code, page: Page, kind: Kind
    ) -> tuple[dict[str, Any], Usage]:
        # The texts' own word list, cached, as the drills use it.
        system: list[BetaTextBlockParam] = [
            {
                "type": "text",
                "text": system_prompt(entries, language),
                "cache_control": {"type": "ephemeral"},
            }
        ]
        messages = [{"role": "user", "content": request_message(language, page, kind)}]
        try:
            response = await client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=cast(list[BetaMessageParam], messages),
                output_config=page_format if kind == "page" else examples_format,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            raise TopicFailed(
                spend_limit_message(e) or "Claude didn't answer. Try again in a moment."
            ) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise TopicFailed("Claude didn't write this topic. Try again in a moment.", used)
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise TopicFailed("Claude's answer couldn't be read. Try again.", used) from e
        if not isinstance(answer, dict):
            raise TopicFailed("Claude's answer couldn't be read. Try again.", used)
        return answer, used

    return write
