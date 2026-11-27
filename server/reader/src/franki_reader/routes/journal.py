"""The writing journal (journal.py): entries checked by Claude and kept, and the kinds of mistake
their first checks found."""

import random
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from franki_reader import journal, journal_store, production, store
from franki_reader.languages import Code
from franki_reader.routes.context import AppContext
from franki_reader.routes.views import instant
from franki_reader.stretch import pick_stretch
from franki_reader.study_day import study_day


class JournalCheckIn(BaseModel):
    language: Code
    text: str = Field(min_length=1, max_length=journal.MAX_ENTRY)
    prompt: str = Field(default="", max_length=journal.MAX_PROMPT)
    # The entry this is written again for; none for a new one.
    entry_id: int | None = None
    # The phone's own id for a new entry, so one sent twice (held offline) is checked once.
    key: str | None = Field(default=None, max_length=64)


class JournalMistakeOut(BaseModel):
    was: str
    now: str
    kind: str
    name: str
    case: str | None
    governor: str | None
    note: str
    hint: str


class JournalSentenceOut(BaseModel):
    written: str
    verdict: Literal["right", "almost", "wrong"]
    corrected: str
    english: str
    mistakes: list[JournalMistakeOut]


class JournalFilledOut(BaseModel):
    english: str
    word: str


class JournalCheckOut(BaseModel):
    verdict: Literal["right", "almost", "wrong"]
    sentences: list[JournalSentenceOut]
    filled: list[JournalFilledOut]


class JournalEntryOut(BaseModel):
    id: int
    language: Code
    prompt: str
    text: str
    tries: int
    created_at: str
    check: JournalCheckOut


class JournalSummaryOut(BaseModel):
    id: int
    prompt: str
    text: str
    created_at: str
    sentences: int
    fixed: int


class JournalKindOut(BaseModel):
    # What it's counted under: a kind, or "case:<case>" for a case ending.
    group: str
    kind: str
    name: str
    # The grammar point it is, when it is one.
    point: str | None
    count: int
    was: str
    now: str
    written: str
    corrected: str


class JournalIdeaWordOut(BaseModel):
    word: str
    meaning: str


class JournalIdeaOut(BaseModel):
    prompt: str
    words: list[JournalIdeaWordOut]


class JournalHomeOut(BaseModel):
    entries: list[JournalSummaryOut]
    kinds: list[JournalKindOut]
    idea: JournalIdeaOut
    # Whether the server can check an entry (Claude is set up).
    checks: bool


def _entry_out(entry: journal_store.Entry) -> JournalEntryOut:
    return JournalEntryOut(
        id=entry.id,
        language=entry.language,
        prompt=entry.prompt,
        text=entry.text,
        tries=entry.tries,
        created_at=instant(entry.created_at),
        check=JournalCheckOut.model_validate(entry.check),
    )


def _summary(entry: journal_store.Entry) -> JournalSummaryOut:
    sentences = entry.check.get("sentences", [])
    return JournalSummaryOut(
        id=entry.id,
        prompt=entry.prompt,
        text=entry.text,
        created_at=instant(entry.created_at),
        sentences=len(sentences),
        fixed=sum(1 for s in sentences if s.get("verdict") != "right"),
    )


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    check_entry = ctx.check_journal
    keep_failed_cost = ctx.keep_failed_cost

    NO_CLAUDE = (
        "Claude isn't set up on the server, so it can't check your writing"
        " (ANTHROPIC_API_KEY in server/.env turns this on)."
    )

    @routes.get("/api/journal", dependencies=authed, response_model=JournalHomeOut)
    async def journal_home(language: Code, days: int = journal.MISTAKE_DAYS) -> JournalHomeOut:
        """The language's entries, newest first; the kinds of mistake their first checks found in
        the last `days` days (0: all of them), most frequent first; and the study day's idea, with
        a few of the words being learned. Reads only."""
        now = engine.clock()
        since = now - timedelta(days=days) if days > 0 else None
        entries, _ = engine.snapshot(language)
        day = study_day(now, engine.rollover(), engine.zone)
        # The same words all day, as the idea is.
        rng = random.Random(f"{day}|{language}")
        words = pick_stretch(entries, journal.IDEA_WORDS, rng, days=engine.snapshot_days(language))
        return JournalHomeOut(
            entries=[_summary(e) for e in journal_store.entries(engine.conn, language)],
            kinds=[
                JournalKindOut(
                    group=t.group,
                    kind=t.kind,
                    name=journal.kind_name(
                        t.kind, t.group[5:] if t.group.startswith("case:") else None
                    ),
                    point=t.kind if t.kind not in journal.GENERAL else None,
                    count=t.count,
                    was=t.was,
                    now=t.now,
                    written=t.written,
                    corrected=t.corrected,
                )
                for t in journal_store.tallies(engine.conn, language, since)
            ],
            idea=JournalIdeaOut(
                prompt=journal.idea(language, str(day)),
                words=[JournalIdeaWordOut(word=w.text, meaning=w.meaning) for w in words],
            ),
            checks=check_entry is not None,
        )

    @routes.post("/api/journal/check", dependencies=authed, response_model=JournalEntryOut)
    async def journal_check(body: JournalCheckIn) -> JournalEntryOut:
        """Checks an entry (one call to Claude) and keeps it: a new one, or `entry_id` written again.
        A new entry whose `key` was already checked comes back as it was, with no call."""
        text = body.text.strip()
        if not text:
            raise HTTPException(422, "Write something to check.")
        before = None
        if body.entry_id is not None:
            before = journal_store.get(engine.conn, body.entry_id)
            if before is None:
                raise HTTPException(404, "That entry was deleted.")
        elif body.key and (kept := journal_store.by_key(engine.conn, body.key)) is not None:
            return _entry_out(kept)
        if check_entry is None:
            raise HTTPException(503, NO_CLAUDE)
        language = before.language if before else body.language
        prompt = before.prompt if before else body.prompt.strip()
        request = journal.CheckRequest(language, text, prompt)
        try:
            checked, used = await check_entry(request)
        except production.ProductionFailed as e:
            keep_failed_cost("journal", language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        now = engine.clock()
        store.save_call_cost(engine.conn, "journal", language, now, used.cost_usd())
        if before is not None:
            entry = journal_store.recheck(engine.conn, before.id, text, checked, now)
            if entry is None:
                raise HTTPException(404, "That entry was deleted.")
        else:
            entry = journal_store.add(engine.conn, language, body.key, prompt, text, checked, now)
        return _entry_out(entry)

    @routes.get("/api/journal/{entry_id}", dependencies=authed, response_model=JournalEntryOut)
    async def journal_entry(entry_id: int) -> JournalEntryOut:
        entry = journal_store.get(engine.conn, entry_id)
        if entry is None:
            raise HTTPException(404, "That entry was deleted.")
        return _entry_out(entry)

    @routes.delete("/api/journal/{entry_id}", status_code=204, dependencies=authed)
    async def journal_delete(entry_id: int) -> Response:
        """Deletes an entry and takes its mistakes out of the counts."""
        journal_store.remove(engine.conn, entry_id)
        return Response(status_code=204)

    return routes
