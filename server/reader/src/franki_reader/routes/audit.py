"""Review after the fact of what Claude wrote beyond the texts (audit.py), for the MCP: audio
lessons, grammar pages and practice items. The texts' own review routes are in texts.py. Every
route here only reads: none starts a write, records audio or changes a row."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query

from franki_reader import audit
from franki_reader.routes.context import AppContext


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine

    @routes.get("/api/audit/lessons", dependencies=authed)
    async def audit_lessons(
        language: str | None = None,
        days: Annotated[int | None, Query(ge=1, le=3650)] = None,
        limit: Annotated[int, Query(ge=1, le=200)] = 50,
    ) -> list[dict[str, Any]]:
        return audit.list_lessons(
            engine.conn, engine.clock(), language=language, days=days, limit=limit
        )

    @routes.get("/api/audit/lessons/{lesson_id}", dependencies=authed)
    async def audit_lesson(lesson_id: int) -> dict[str, Any]:
        found = audit.lesson(engine.conn, lesson_id)
        if found is None:
            raise HTTPException(404, "No such lesson.")
        return found

    @routes.get("/api/audit/grammar", dependencies=authed)
    async def audit_grammar(language: str | None = None) -> list[dict[str, Any]]:
        return audit.list_grammar_pages(engine.conn, language=language)

    @routes.get("/api/audit/grammar/{kind}/{page_id}", dependencies=authed)
    async def audit_grammar_page(kind: Literal["topic", "point"], page_id: str) -> dict[str, Any]:
        found = audit.grammar_page(engine.conn, kind, page_id)
        if found is None:
            raise HTTPException(404, "No such grammar page.")
        return found

    @routes.get("/api/audit/practice", dependencies=authed)
    async def audit_practice(
        kind: Literal["drill", "sentence", "vocab", "meaning", "sentence_meaning"],
        language: str | None = None,
        point: str | None = None,
        word: str | None = None,
        days: Annotated[int | None, Query(ge=1, le=3650)] = None,
        limit: Annotated[int, Query(ge=1, le=200)] = 50,
    ) -> dict[str, Any]:
        return audit.practice(
            engine.conn,
            engine.clock(),
            kind,
            language=language,
            point=point,
            word=word,
            days=days,
            limit=limit,
        )

    return routes
