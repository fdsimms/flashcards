"""The owner's own writing checked by Claude (production.py, a retelling) and sentences to say."""

from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from franki_reader import (
    production,
    sentences,
    store,
)
from franki_reader.coverage import parse_line
from franki_reader.languages import (
    LANGUAGES,
    Code,
)
from franki_reader.lexicon import Entry
from franki_reader.routes.context import AppContext
from franki_reader.stretch import reviewed_words
from franki_reader.stretch import waiting as waiting_for_review


class AttemptIn(BaseModel):
    kind: production.Kind
    language: Code
    attempt: str = Field(min_length=1, max_length=production.MAX_ATTEMPT)
    word: str = Field(default="", max_length=200)
    meaning: str = Field(default="", max_length=300)
    english: str = Field(default="", max_length=500)
    reference: str = Field(default="", max_length=500)


class RetellIn(BaseModel):
    attempt: str = Field(min_length=1, max_length=production.MAX_ATTEMPT)


class SentencesIn(BaseModel):
    language: Code
    count: int = Field(default=10, ge=1, le=20)


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    check_attempt = ctx.check_attempt
    check_retell = ctx.check_retell
    write_sentences = ctx.write_sentences
    keep_failed_cost = ctx.keep_failed_cost
    # Languages whose sentences are being written (sentences.top_up).
    sentences_writing: set[Code] = set()

    NO_CLAUDE = (
        "Claude isn't set up on the server, so it can't check your writing"
        " (ANTHROPIC_API_KEY in server/.env turns this on)."
    )

    @routes.post("/api/production/check", dependencies=authed)
    async def check_attempt_route(body: AttemptIn) -> dict[str, Any]:
        """Never writes to Anki or grades a card: it only answers."""
        if check_attempt is None:
            raise HTTPException(503, NO_CLAUDE)
        if body.kind == "sentence" and not body.word.strip():
            raise HTTPException(422, "A sentence is checked for a word: send `word`.")
        if body.kind == "translate" and not body.english.strip():
            raise HTTPException(422, "A translation is checked against `english`: send it.")
        request = production.AttemptRequest(
            body.language,
            body.kind,
            body.attempt.strip(),
            body.word.strip(),
            body.meaning.strip(),
            body.english.strip(),
            body.reference.strip(),
        )
        try:
            answer, used = await check_attempt(request)
        except production.ProductionFailed as e:
            keep_failed_cost("production", body.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "production", body.language, engine.clock(), used.cost_usd()
        )
        return answer

    @routes.post("/api/texts/{text_id}/retell", dependencies=authed)
    async def retell(text_id: int, body: RetellIn) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None:
            raise HTTPException(404, "No such text.")
        if check_retell is None:
            raise HTTPException(503, NO_CLAUDE)
        spaced = LANGUAGES[text.language].spaced
        lines = tuple((parse_line(ln.text, spaced)[0], ln.english) for ln in text.lines)
        try:
            answer, used = await check_retell(
                production.RetellRequest(text.language, body.attempt.strip(), lines)
            )
        except production.ProductionFailed as e:
            keep_failed_cost("production", text.language, e.usage)
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "production", text.language, engine.clock(), used.cost_usd()
        )
        return answer

    async def top_up_sentences(language: Code, words: list[Entry]) -> None:
        if write_sentences is None:
            return
        await engine.refresh_lexicon(language)
        entries, full = engine.snapshot(language)
        days = engine.snapshot_days(language)
        held = frozenset(
            e.text
            for e in entries
            if e.tier != "unreviewed"
            and waiting_for_review(e, days)
            and e.text not in {w.text for w in words}
        )
        await sentences.top_up(
            engine.conn,
            language,
            words,
            lambda code, keep: engine.writing_lexicon(code, keep),
            full,
            held,
            write_sentences,
            engine.clock,
            sentences_writing,
        )

    @routes.post("/api/sentences", dependencies=authed)
    async def sentences_route(body: SentencesIn, background: BackgroundTasks) -> dict[str, Any]:
        """Never writes to Anki or grades a card: it only reads the snapshot of the deck."""
        entries, _ = engine.snapshot(body.language)
        days = engine.snapshot_days(body.language)
        words = sentences.candidates(entries, days, engine.rng)
        reviewed = frozenset(e.text for e in reviewed_words(entries, days))
        served = sentences.serve(
            engine.conn, body.language, words, body.count, engine.clock(), reviewed
        )
        background.add_task(top_up_sentences, body.language, words)
        return {"sentences": served, "writing": write_sentences is not None}

    return routes
