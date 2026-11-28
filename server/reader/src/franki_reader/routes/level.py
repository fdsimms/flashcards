"""Your level (level.py): how many of a language's most common words are studied, and its trend."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from franki_reader import level_store
from franki_reader.languages import LANGUAGES, Code
from franki_reader.level import HEADLINE
from franki_reader.routes.context import AppContext
from franki_reader.study_day import study_day


class LevelBand(BaseModel):
    start: int
    end: int
    known: int


class LevelDayOut(BaseModel):
    day: str
    known_top: int
    speech: float | None


class LevelOut(BaseModel):
    top: int
    known_top: int
    speech: float | None
    studied: int
    bands: list[LevelBand]
    history: list[LevelDayOut]


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine

    @routes.get("/api/level", dependencies=authed)
    async def get_level(language: Code) -> LevelOut:
        """The language's level from its last snapshot of the deck: known words by frequency band
        (`bands`, each `start` to `end` places in the list), how many of the `top` most common are
        known, the share of everyday speech they make up (`speech`, 0 to 1, null without
        frequencies), and `history`, one figure a study day, oldest first, today's included. 404 for
        a language with no frequency list (Toki Pona), 409 before its deck has been read."""
        if LANGUAGES[language].common_fixed:
            raise HTTPException(404, f"{LANGUAGES[language].name} has no list of common words.")
        figure = engine.level(language)
        if figure is None:
            raise HTTPException(409, f"Your {LANGUAGES[language].name} deck hasn't been read yet.")
        day = study_day(engine.clock(), engine.rollover(), engine.zone)
        level_store.keep(engine.conn, language, day, figure)
        return LevelOut(
            top=HEADLINE,
            known_top=figure.known_top,
            speech=figure.speech,
            studied=figure.studied,
            bands=[LevelBand(start=b.start, end=b.end, known=b.known) for b in figure.bands],
            history=[
                # A study day, a calendar date with no time or zone: not an instant().
                LevelDayOut(day=str(d.day), known_top=d.known_top, speech=d.speech)
                for d in level_store.history(engine.conn, language)
            ],
        )

    return routes
