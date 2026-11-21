"""Grammar drills (docs/grammar.md, step 5): short questions on a grammar point, asked by the app's
Grammar tool and answered there. Results stay on the phone; nothing here grades a card.

Two kinds of question:

- **Which is this?** A line from a text read to the end, with the words a point's finder matched,
  and the point and its related ones to choose from. Built when asked, from texts already checked,
  so it costs nothing and its answer is the finder's. A line where a related point's finder also
  matches the same words is left out, since its answer would be ambiguous.
- **Fill the gap.** A short sentence Claude writes from the known words (the same cached word list
  the texts are written from), with a gap for the point and three wrong choices. Written in the
  background, `BATCH` at a time, and kept up to `STOCK` a point, so a drill never waits on Claude.
  Generate, then verify: a question is kept only if the point's finder finds it in the answer,
  finds it in none of the wrong choices, and the sentence has at most `MAX_UNKNOWN` words outside
  the known ones. Anything else is dropped, never repaired.

A point whose name is the word itself (`Point.word_named`: all of Thai's, Greek θα) gets neither
kind as above: tapping the point already names the answer, so a "which" question is pointless, and
a gap whose answer is always that word teaches nothing. Its drill is gap questions only, about
half (rounded up) from its own stock and the rest from the stock of its related word_named points,
taken in turn, so the choices are rival words for the same slot. Rival questions are asked and
marked served as ever, and each carries `for`, the drilled point's id. Where the rivals have no
stock, its own fills in. Their stock is written whenever the point is drilled (`with_rivals`).
"""

import json
import logging
import random
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam, BetaTextBlockParam

from franki_reader import grammar, store
from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker, is_word, parse_line
from franki_reader.generator import MODEL, Usage, system_prompt, usage_of
from franki_reader.grammar import Point
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry

log = logging.getLogger(__name__)

STOCK = 24  # fill-the-gap questions kept for a point
BATCH = 12  # asked for in one call
MAX_UNKNOWN = 1  # words in a question outside the known ones
BATCHES_PER_DAY = 2  # calls a point may make in a day, so a point whose questions keep failing
# their checks, or whose call keeps failing after Claude answered, doesn't spend on every drill
MAX_TOKENS = 8000
WRONG = 3  # wrong choices a question carries

_REQUEST = """\
Write {count} practice questions for one grammar point in {language}: {name} ({note}).

Each question is one short, natural sentence of 4 to 10 words, using only words from the list, with
one gap where the {name} goes. Give:
- before: the sentence up to the gap
- answer: the word or words that fill the gap, using the {name}
- after: the rest of the sentence
- english: the whole sentence in English
- wrong: {wrong} other forms that fit the gap's slot but are not the {name} (the same verb in other
  tenses or moods, or for a particle, other particles), each wrong in this sentence{rivals}
- hint: for a verb, its infinitive and person, like "ir, nosotros"; empty otherwise

Write the sentences the way people really talk, not the way a textbook puts it, unless the {name}
is itself a formal or written form.

before + answer + after must read as the whole sentence{spacing}. Write plain text: no `|`, no
asterisks, no tildes. Vary the verbs, people and situations, and don't repeat a sentence. Do not
use em dashes."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "before": {"type": "string"},
                    "answer": {"type": "string"},
                    "after": {"type": "string"},
                    "english": {"type": "string"},
                    "wrong": {"type": "array", "items": {"type": "string"}},
                    "hint": {"type": "string"},
                },
                "required": ["before", "answer", "after", "english", "wrong", "hint"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["questions"],
    "additionalProperties": False,
}


class DrillsFailed(Exception):
    """Claude couldn't write a batch; logged, and tried again on a later drill. `usage` is what the
    failed call was billed for, when Claude answered at all."""

    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Writes up to `count` raw questions for a point from the language's entries, and what that cost.
WriteDrills = Callable[[list[Entry], Code, Point, int], Awaitable[tuple[list[Any], Usage]]]


@dataclass(frozen=True)
class GapQuestion:
    before: str
    answer: str
    after: str
    english: str
    wrong: tuple[str, ...]
    hint: str


def rivals_of(point: Point) -> tuple[Point, ...]:
    """The related points of a word_named point that are word_named too: words that compete with it
    for the same slot. None for any other point."""
    if not point.word_named:
        return ()
    return tuple(
        r
        for rid in point.related
        if (r := grammar.POINTS.get(rid)) is not None and r.word_named and r.id != point.id
    )


def with_rivals(point_ids: tuple[str, ...]) -> tuple[str, ...]:
    """The points, then the rivals of each word_named one, so a drill's rival questions have stock."""
    out = list(point_ids)
    for pid in point_ids:
        point = grammar.POINTS.get(pid)
        if point is not None:
            out += [r.id for r in rivals_of(point)]
    return tuple(dict.fromkeys(out))


def _rivals_note(point: Point) -> str:
    """For a word_named point, what the wrong choices should be: words that compete for the slot."""
    if not point.word_named:
        return ""
    names = ", ".join(r.name for r in rivals_of(point))
    return (
        f". For this point the wrong choices must be rival words that genuinely compete for the "
        f"slot: other particles or markers of the same kind"
        f"{f', such as {names}' if names else ''}, never the {point.name} itself"
    )


def request_message(language: Code, point: Point, count: int) -> str:
    spaced = LANGUAGES[language].spaced
    return _REQUEST.format(
        count=count,
        language=LANGUAGES[language].name,
        name=point.name,
        note=point.note,
        wrong=WRONG,
        rivals=_rivals_note(point),
        spacing=", spaces included" if spaced else ", with no spaces between words",
    )


def _found_in(line: str, part: str, point: Point, lexicon: Checker) -> bool:
    """Whether the point's finder matches words inside `part` of the line (finders lowercase a
    spaced language's words)."""
    matches = grammar.find_in_lines([line], lexicon, (point.id,))[point.id]
    within = part.lower() if lexicon.spaced else part
    return any(m and m in within for m in matches)


def check(raw: object, point: Point, lexicon: Checker) -> GapQuestion | None:
    """A question Claude wrote, kept only if the code agrees with it (see the module's docstring)."""
    if not isinstance(raw, dict):
        return None
    fields = {k: raw.get(k) for k in ("before", "answer", "after", "english", "hint")}
    if not all(isinstance(v, str) for v in fields.values()) or not isinstance(
        raw.get("wrong"), list
    ):
        return None
    before, answer, after, english, hint = (cast(str, fields[k]) for k in fields)
    answer, english, hint = answer.strip(), english.strip(), hint.strip()
    wrong = tuple(
        dict.fromkeys(w.strip() for w in raw["wrong"] if isinstance(w, str) and w.strip())
    )
    if not answer or not english or len(wrong) < WRONG:
        return None
    wrong = tuple(w for w in wrong if w.casefold() != answer.casefold())[:WRONG]
    text = before + answer + after + english + hint + "".join(wrong)
    if len(wrong) < WRONG or "—" in text or any(c in before + answer + after for c in "|*~"):
        return None
    line = before + answer + after
    if not _found_in(line, answer, point, lexicon):
        return None
    if any(_found_in(before + w + after, w, point, lexicon) for w in wrong):
        return None
    plain, _ = parse_line(line, lexicon.spaced)
    unknown = [t for t in lexicon.segment(plain) if is_word(t) and lexicon.status(t) != "known"]
    if len(unknown) > MAX_UNKNOWN:
        return None
    return GapQuestion(before, answer, after, english, wrong, hint)


async def top_up(
    conn: sqlite3.Connection,
    snapshot: Callable[[Code], tuple[list[Entry], Checker]],
    write: WriteDrills,
    point_ids: tuple[str, ...],
    now: Callable[[], datetime],
    writing: set[str],
) -> None:
    """Writes a batch for each point under `STOCK`, one point at a time, skipping a point already
    being written (`writing`, shared between requests) or that made `BATCHES_PER_DAY` calls today.
    A call that failed after Claude answered is kept as a batch with no questions, for its cost, and
    counts as one of the day's calls."""
    for pid in point_ids:
        point = grammar.POINTS.get(pid)
        if point is None or pid in writing or store.drill_stock(conn, pid) >= STOCK:
            continue
        if store.drill_batches_since(conn, pid, now() - timedelta(days=1)) >= BATCHES_PER_DAY:
            continue
        writing.add(pid)
        try:
            entries, lexicon = snapshot(point.language)
            raw, used = await write(entries, point.language, point, BATCH)
            kept = [q for q in (check(r, point, lexicon) for r in raw) if q is not None]
            store.save_drill_batch(
                conn, pid, point.language, kept, len(raw), now(), used.cost_usd()
            )
        except DrillsFailed as e:
            log.warning("Couldn't write drill questions for %s: %s", pid, e)
            if e.usage != Usage():
                store.save_drill_batch(conn, pid, point.language, [], 0, now(), e.usage.cost_usd())
        finally:
            writing.discard(pid)


# ==== Which is this? ====


@dataclass(frozen=True)
class WhichQuestion:
    point_id: str
    text_id: int
    title: str
    line: str
    english: str
    words: tuple[str, ...]
    choices: tuple[str, ...]  # point ids: the point and its related ones


def which_questions(
    conn: sqlite3.Connection, lexicon: Checker, point_id: str, count: int, rng: random.Random
) -> list[WhichQuestion]:
    """Up to `count` lines from texts read that use the point, one per text, in a random order.
    None for a point with nothing related to choose from."""
    point = grammar.POINTS[point_id]
    related = tuple(r for r in point.related if r in grammar.POINTS and r != point_id)
    if not related:
        return []
    spaced = LANGUAGES[point.language].spaced
    choices = (point_id, *related)
    read = store.finished_texts(conn, point.language)
    rng.shuffle(read)
    out: list[WhichQuestion] = []
    for text, _ in read:
        for ln in text.lines:
            found = grammar.find_in_lines([ln.text], lexicon, choices)
            words = found[point_id]
            # The same words matched by a related point would make the answer ambiguous.
            if not words or any(set(found[r]) & set(words) for r in related):
                continue
            plain = parse_line(ln.text, spaced)[0]
            out.append(
                WhichQuestion(
                    point_id, text.id, text.title, plain, ln.english, tuple(words[:1]), choices
                )
            )
            break
        if len(out) >= count:
            break
    return out


MAX_DRILL = 30  # questions one drill may ask for


def serve(
    conn: sqlite3.Connection,
    snapshot: Callable[[Code], tuple[list[Entry], Checker]],
    point_ids: tuple[str, ...],
    count: int,
    now: datetime,
    rng: random.Random,
) -> list[dict[str, Any]]:
    """A drill's questions: `count` shared among the points in turn, each point's half from lines
    read ("which") and the rest from its stock of gap questions, either kind making up for the
    other running short, then mixed. A point with neither gets none; the caller says so. A
    word_named point gets gap questions only, its own and its rivals' (see the module's docstring)."""
    points = [p for p in dict.fromkeys(point_ids) if p in grammar.POINTS]
    if not points:
        return []
    shares = {
        p: count // len(points) + (1 if i < count % len(points) else 0)
        for i, p in enumerate(points)
    }
    out: list[dict[str, Any]] = []
    for pid in points:
        share = shares[pid]
        if not share:
            continue
        if grammar.POINTS[pid].word_named:
            out += _word_named_gaps(conn, pid, share, now)
            continue
        _, lexicon = snapshot(grammar.POINTS[pid].language)
        which = which_questions(conn, lexicon, pid, share, rng)[: (share + 1) // 2]
        gaps = store.take_drill_questions(conn, pid, share - len(which), now)
        if len(which) + len(gaps) < share:
            which = which_questions(conn, lexicon, pid, share - len(gaps), rng)
        out += [
            {
                "kind": "which",
                "point": w.point_id,
                "line": w.line,
                "words": list(w.words),
                "english": w.english,
                "title": w.title,
                "choices": list(w.choices),
            }
            for w in which
        ]
        out += [_gap_json(g) for g in gaps]
    rng.shuffle(out)
    # A question can come up twice when two drilled points are each other's rivals.
    return _unique(out)


def _unique(out: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[int] = set()
    kept: list[dict[str, Any]] = []
    for q in out:
        if q["kind"] == "gap":
            if q["id"] in seen:
                continue
            seen.add(q["id"])
        kept.append(q)
    return kept


def _gap_json(g: store.StoredGap, drilled: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "kind": "gap",
        "id": g.id,
        "point": g.point_id,
        "before": g.before,
        "answer": g.answer,
        "after": g.after,
        "english": g.english,
        "wrong": list(g.wrong),
        "hint": g.hint,
    }
    if drilled is not None:
        out["for"] = drilled
    return out


def _word_named_gaps(
    conn: sqlite3.Connection, pid: str, share: int, now: datetime
) -> list[dict[str, Any]]:
    """`share` gap questions for a word_named point: half (rounded up) its own, the rest its
    rivals' in turn, any the rivals can't supply its own too. Each rival is asked once for all its
    questions, so none is served twice in the drill."""
    mine = (share + 1) // 2
    rivals = [r.id for r in rivals_of(grammar.POINTS[pid])]
    room = {r: store.drill_stock(conn, r) for r in rivals}
    quota = dict.fromkeys(rivals, 0)
    for _ in range(share - mine):
        open_ = [r for r in rivals if quota[r] < room[r]]
        if not open_:
            break
        # The rival with the fewest so far, the earlier one first: in turn.
        quota[min(open_, key=lambda r: quota[r])] += 1
    # Its own stock covers what's left, and if that runs short the rivals' spare covers the rest.
    own = min(share - sum(quota.values()), store.drill_stock(conn, pid))
    for _ in range(share - sum(quota.values()) - own):
        open_ = [r for r in rivals if quota[r] < room[r]]
        if not open_:
            break
        quota[min(open_, key=lambda r: quota[r])] += 1
    gaps = store.take_drill_questions(conn, pid, own, now)
    for r in rivals:
        if quota[r]:
            gaps += store.take_drill_questions(conn, r, quota[r], now)
    return [_gap_json(g, pid) for g in gaps]


def claude_drills(client: anthropic.AsyncAnthropic) -> WriteDrills:
    output_config: BetaOutputConfigParam = {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(
        entries: list[Entry], language: Code, point: Point, count: int
    ) -> tuple[list[Any], Usage]:
        # The texts' own word list, cached, so a batch after a text reads it from the cache.
        system: list[BetaTextBlockParam] = [
            {
                "type": "text",
                "text": system_prompt(entries, language),
                "cache_control": {"type": "ephemeral"},
            }
        ]
        messages = [{"role": "user", "content": request_message(language, point, count)}]
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
            raise DrillsFailed(didnt_answer(e)) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise DrillsFailed(f"No questions ({response.stop_reason})", used)
        try:
            questions = json.loads(text).get("questions")
        except (json.JSONDecodeError, AttributeError) as e:
            raise DrillsFailed("The answer wasn't valid JSON", used) from e
        return (questions if isinstance(questions, list) else []), used

    return write
