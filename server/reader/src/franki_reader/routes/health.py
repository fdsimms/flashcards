"""Whether the server is up and the passphrase right, the status another app reads
(/api/status), and the deck list counts and crams the app reports for it."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import AwareDatetime, BaseModel, Field

from franki_reader import read_plan, store
from franki_reader.gateway import AnkiUnavailable
from franki_reader.languages import HIDDEN_LANGUAGES, LANGUAGES, TEXT_LANGUAGES
from franki_reader.routes.context import AppContext
from franki_reader.routes.views import instant


class FrankiCountsIn(BaseModel):
    # The deck list's totals across the top-level decks: due (reviews and learning) and new.
    due: int = Field(ge=0, le=1_000_000)
    new: int = Field(ge=0, le=1_000_000)


class FrankiCramIn(BaseModel):
    # One open cram (src/core/cramsReport.ts in the app): instants are ISO with their offset.
    id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=200)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    ends_at: AwareDatetime
    practiced_at: AwareDatetime | None = None
    finished_at: AwareDatetime | None = None


class FrankiCramsIn(BaseModel):
    # Every cram the app reports, replacing the last list; empty takes them all away.
    crams: list[FrankiCramIn] = Field(max_length=50)  # the app's MAX_REPORTED_CRAMS


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
        # Unlike the counts, crams are kept whatever day they were sent: they change only when
        # Franki is open, and one practiced today is still running tomorrow.
        crams = store.load_franki_crams(engine.conn)

        def naive_utc(at: datetime) -> datetime:
            return at.astimezone(UTC).replace(tzinfo=None)

        # Every language the app can show, with what is waiting in it (often nothing), so the other
        # app can offer a choice per language and decide which get a task today.
        ready = store.ready_counts(engine.conn)
        languages = []
        readings = []
        for code, lang in TEXT_LANGUAGES.items():
            if code in HIDDEN_LANGUAGES:
                continue
            read_at = store.last_finished_reading(engine.conn, code)
            readings.append(read_plan.Reading(code, lang.name, ready.get(code, 0), read_at))
            languages.append(
                {
                    "language": code,
                    "name": lang.name,
                    "waiting": ready.get(code, 0),
                    "last_read_at": instant(read_at) if read_at else None,
                }
            )

        # Which languages get a reading task today, decided here (read_plan.py) for the other app to show.
        today = read_plan.today(
            engine.conn, readings, store.load_settings(engine.conn), naive_utc(day_starts_at)
        )

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
                "waiting": ready.get(language, 0),
                "last_read_at": instant(last_read) if last_read else None,
            },
            "read_and_listen_languages": languages,
            "read_and_listen_today": [
                {
                    "language": e.language,
                    "name": e.name,
                    "mode": e.mode,
                    "waiting": e.waiting,
                    "done": e.done,
                }
                for e in today
            ],
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
            # null until Franki first reports, which is not the same as no crams.
            "franki_crams": (
                {
                    "crams": [
                        {
                            "id": c.id,
                            "name": c.name,
                            "date": c.date,
                            "ends_at": c.ends_at,
                            "practiced_at": c.practiced_at,
                            "finished_at": c.finished_at,
                        }
                        for c in crams.crams
                    ],
                    "reported_at": instant(crams.reported_at),
                }
                if crams
                else None
            ),
        }

    @routes.put("/api/franki-counts", status_code=204, dependencies=authed)
    async def franki_counts(body: FrankiCountsIn) -> Response:
        store.save_franki_counts(
            engine.conn, store.FrankiCounts(body.due, body.new, engine.clock())
        )
        return Response(status_code=204)

    @routes.put("/api/franki-crams", status_code=204, dependencies=authed)
    async def franki_crams(body: FrankiCramsIn) -> Response:
        def iso(at: datetime | None) -> str | None:
            return instant(at.astimezone(UTC)) if at else None

        store.save_franki_crams(
            engine.conn,
            store.FrankiCrams(
                [
                    store.FrankiCram(
                        c.id,
                        c.name,
                        c.date,
                        instant(c.ends_at.astimezone(UTC)),
                        iso(c.practiced_at),
                        iso(c.finished_at),
                    )
                    for c in body.crams
                ],
                engine.clock(),
            ),
        )
        return Response(status_code=204)

    return routes
