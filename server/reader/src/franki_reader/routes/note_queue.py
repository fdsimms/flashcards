"""Quick add's queue of words for Claude to fill in (note_queue.py), and its lookup of words for a
meaning (word_lookup.py)."""

from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from pydantic import BaseModel, Field

from franki_reader import (
    note_queue,
    store,
    word_lookup,
)
from franki_reader.languages import Code
from franki_reader.routes.context import AppContext


class QueuedEntry(BaseModel):
    entry: str = Field(min_length=1, max_length=200)
    meaning: str = Field(default="", max_length=300)


class NoteQueueIn(BaseModel):
    language: Code
    deck: str = Field(min_length=1, max_length=500)
    entries: list[QueuedEntry] = Field(min_length=1, max_length=note_queue.MAX_QUEUED)


class WordLookupIn(BaseModel):
    language: Code
    meaning: str = Field(min_length=1, max_length=200)


class FoundWordOut(BaseModel):
    entry: str
    meaning: str
    # What tells it apart from the other words found; empty when there's nothing to say.
    note: str


class WordLookupOut(BaseModel):
    words: list[FoundWordOut]


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    write_notes = ctx.write_notes
    look_up_words = ctx.look_up_words
    keep_failed_cost = ctx.keep_failed_cost
    # Whether the note queue is being filled in, so a poll or a second Quick add doesn't start a
    # second pass (the running one picks up whatever was added meanwhile).
    queue_filling: list[bool] = [False]

    async def fill_note_queue() -> None:
        assert write_notes is not None
        queue_filling[0] = True
        try:
            await note_queue.fill_pending(engine.conn, write_notes, engine.clock)
        finally:
            queue_filling[0] = False

    def start_filling(background: BackgroundTasks) -> None:
        """Starts a pass over the words that are due, unless one is running or there's nothing to do."""
        if (
            write_notes is not None
            and not queue_filling[0]
            and note_queue.pending(engine.conn, engine.clock())
        ):
            queue_filling[0] = True  # before the response, so the next poll sees it
            background.add_task(fill_note_queue)

    def queue_view() -> dict[str, Any]:
        return {
            "available": write_notes is not None,
            "items": [
                {
                    "id": n.id,
                    "language": n.language,
                    "deck": n.deck,
                    "entry": n.entry,
                    "meaning": n.meaning,
                    "state": n.state,
                    "fields": n.fields,
                    "error": n.error,
                    "retrying": note_queue.retrying(n),
                    "spelling": n.spelling,
                    "alternatives": n.alternatives,
                }
                for n in store.queued_notes(engine.conn)
            ],
        }

    @routes.get("/api/note-queue", dependencies=authed)
    async def get_note_queue(background: BackgroundTasks) -> dict[str, Any]:
        """The queued words (note_queue.py). Also the way a pass starts again after the server
        restarted, or a failed word's wait is over."""
        start_filling(background)
        return queue_view()

    @routes.post("/api/note-queue", dependencies=authed, status_code=202)
    async def add_to_note_queue(body: NoteQueueIn, background: BackgroundTasks) -> dict[str, Any]:
        if write_notes is None:
            raise HTTPException(
                503, "Claude isn't set up on the server, so notes can't be filled in for you."
            )
        seen: set[str] = set()
        entries: list[tuple[str, str]] = []
        for e in body.entries:
            entry = " ".join(e.entry.split())
            if entry and entry not in seen:
                seen.add(entry)
                entries.append((entry, " ".join(e.meaning.split())))
        if not entries:
            raise HTTPException(422, "Type at least one word.")
        store.add_queued(engine.conn, body.language, body.deck, entries, engine.clock())
        start_filling(background)
        return queue_view()

    @routes.post("/api/note-queue/{note_id}/retry", dependencies=authed, status_code=202)
    async def retry_queued_note(note_id: int, background: BackgroundTasks) -> dict[str, Any]:
        if not store.retry_queued(engine.conn, note_id):
            raise HTTPException(404, "That word isn't waiting to be tried again.")
        start_filling(background)
        return queue_view()

    @routes.delete("/api/note-queue/{note_id}", dependencies=authed, status_code=204)
    async def remove_queued_note(note_id: int) -> Response:
        # Asking again for one already gone (a save that was sent twice) is fine.
        store.delete_queued(engine.conn, note_id)
        return Response(status_code=204)

    @routes.post("/api/word-lookup", dependencies=authed)
    async def look_up(body: WordLookupIn) -> WordLookupOut:
        """Words for a meaning typed in English (Quick add's "Don't know the word?"). Only returns
        words: a picked one is queued like any other."""
        if look_up_words is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't look up words"
                " (ANTHROPIC_API_KEY in server/.env turns it on).",
            )
        meaning = " ".join(body.meaning.split())
        if not meaning:
            raise HTTPException(422, "Type what you want to say.")
        try:
            words, used = await look_up_words(body.language, meaning)
        except word_lookup.LookupFailed as e:
            keep_failed_cost("word_lookup", body.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "word_lookup", body.language, engine.clock(), used.cost_usd()
        )
        return WordLookupOut(
            words=[FoundWordOut(entry=w.entry, meaning=w.meaning, note=w.note) for w in words]
        )

    return routes
