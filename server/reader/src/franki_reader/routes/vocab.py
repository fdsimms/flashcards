"""The vocabulary check's questions (vocab_check.py)."""

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException

from franki_reader import (
    store,
    vocab_check,
)
from franki_reader.languages import (
    LANGUAGES,
    Code,
)
from franki_reader.routes.context import AppContext

VOCAB_RETRY = timedelta(minutes=10)  # before a vocabulary check bank that failed is written again


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    write_vocab = ctx.write_vocab
    # Languages whose vocabulary check words are being written, and when one last failed, so a
    # language Claude can't gloss isn't asked again on every poll of the quiz.
    vocab_writing: set[Code] = set()
    vocab_failed: dict[Code, datetime] = {}

    async def write_vocab_bank(language: Code) -> None:
        assert write_vocab is not None
        vocab_writing.add(language)
        try:
            if await vocab_check.write_bank(engine.conn, write_vocab, language, engine.clock):
                vocab_failed.pop(language, None)
            else:
                vocab_failed[language] = engine.clock()
        finally:
            vocab_writing.discard(language)

    @routes.get("/api/vocab-check", dependencies=authed)
    async def get_vocab_check(language: Code, background: BackgroundTasks) -> dict[str, Any]:
        """The vocabulary check's questions for a language (vocab_check.py). `state` is "ready" with
        the `items`, "preparing" while Claude writes them (ask again in a few seconds), "failed"
        when it couldn't (not asked again for `VOCAB_RETRY`), or "unavailable" with no Claude key."""
        if not LANGUAGES[language].counts_common:
            raise HTTPException(422, f"{LANGUAGES[language].name} counts only its deck.")
        stored = store.vocab_items(engine.conn, language)
        retry_due = (failed := vocab_failed.get(language)) is None or (
            engine.clock() - failed >= VOCAB_RETRY
        )
        if stored:
            items = vocab_check.serve(engine.conn, engine.snapshot(language)[1], language)
            # A bank written when fewer words were asked for, or before a band was added, is topped
            # up in the background; the quiz uses what's there meanwhile.
            failed = vocab_failed.get(language)
            if (
                write_vocab is not None
                and language not in vocab_writing
                and (failed is None or engine.clock() - failed >= VOCAB_RETRY)
                and store.vocab_asked(engine.conn, language) < len(vocab_check.sample(language))
            ):
                vocab_writing.add(language)
                background.add_task(write_vocab_bank, language)
            return {"state": "ready", "items": items}
        if write_vocab is None:
            return {"state": "unavailable", "items": []}
        if language in vocab_writing:
            return {"state": "preparing", "items": []}
        if not retry_due:
            return {"state": "failed", "items": []}
        vocab_writing.add(language)  # before the response, so the next poll sees it
        background.add_task(write_vocab_bank, language)
        return {"state": "preparing", "items": []}

    return routes
