"""Whether the server is up and the passphrase right, the status another app reads
(/api/status), and the deck list counts the app reports for it."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from franki_reader import store
from franki_reader.gateway import AnkiUnavailable
from franki_reader.languages import LANGUAGES
from franki_reader.routes.context import AppContext
from franki_reader.routes.views import instant


class FrankiCountsIn(BaseModel):
    # The deck list's totals across the top-level decks: due (reviews and learning) and new.
    due: int = Field(ge=0, le=1_000_000)
    new: int = Field(ge=0, le=1_000_000)


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    status_auth = ctx.status_auth
    engine = ctx.engine
    read_due = ctx.read_due

    @routes.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @routes.get("/api/check", status_code=204, dependencies=authed)
    async def check() -> Response:
        return Response(status_code=204)

    @routes.get("/api/status", dependencies=status_auth)
    async def status() -> dict[str, Any]:
        if read_due is None:
            raise HTTPException(
                503,
                "The server can't read Anki: ANKI_SYNC_ENDPOINT, ANKI_USER and ANKI_PASSWORD "
                "aren't all set.",
            )
        try:
            due = await read_due()
        except AnkiUnavailable as e:
            raise HTTPException(503, f"Couldn't read Anki. {e}") from e
        language = engine.language()
        last_read = store.last_finished_reading(engine.conn, language)
        day_starts_at = due.day_ends_at - timedelta(days=1)
        reported = store.load_franki_counts(engine.conn)
        # Only today's: yesterday's new cards left say nothing about today's.
        if reported and reported.reported_at.replace(tzinfo=UTC) < day_starts_at:
            reported = None

        def naive_utc(at: datetime) -> datetime:
            return at.astimezone(UTC).replace(tzinfo=None)

        return {
            "reviews": due.reviews,
            "learning": due.learning,
            "learning_later": [{"at": instant(x.at), "count": x.count} for x in due.learning_later],
            "decks": [
                {"name": d.name, "reviews": d.reviews, "learning": d.learning} for d in due.decks
            ],
            "day_ends_at": instant(due.day_ends_at),
            "read_and_listen": {
                "language": language,
                "name": LANGUAGES[language].name,
                "waiting": store.ready_counts(engine.conn).get(language, 0),
                "last_read_at": instant(last_read) if last_read else None,
            },
            "study_days": [
                {
                    "starts_at": instant(d.starts_at),
                    "cards": d.cards,
                    "answer_seconds": d.answer_seconds,
                    "reading_seconds": store.reading_seconds(
                        engine.conn,
                        naive_utc(d.starts_at),
                        naive_utc(d.starts_at + timedelta(days=1)),
                    ),
                }
                for d in due.study_days
            ],
            "franki": (
                {
                    "due": reported.due,
                    "new": reported.new,
                    "reported_at": instant(reported.reported_at),
                }
                if reported
                else None
            ),
        }

    @routes.put("/api/franki-counts", status_code=204, dependencies=authed)
    async def franki_counts(body: FrankiCountsIn) -> Response:
        store.save_franki_counts(
            engine.conn, store.FrankiCounts(body.due, body.new, engine.clock())
        )
        return Response(status_code=204)

    return routes
