"""The learner's own texts: a pasted text's preview, and adding it (own_text.py)."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from franki_reader.engine import NotAvailable
from franki_reader.languages import HIDDEN_LANGUAGES, TEXT_LANGUAGES, Code
from franki_reader.own_text import MAX_CHARS, OwnTextRefused
from franki_reader.routes.context import AppContext


class OwnTextIn(BaseModel):
    language: Code
    # Longer than MAX_CHARS, so a text a little over it is refused with its count, not a bare 422.
    text: str = Field(min_length=1, max_length=MAX_CHARS * 2)
    # Empty: the first line's start (own_text.title_of).
    title: str = Field(default="", max_length=150)


class OwnPreviewOut(BaseModel):
    """What adding a text would give, before it's added."""

    title: str
    coverage: float  # the share of its words the deck knows
    words: int  # how many words were counted
    new_words: list[str]  # words not known, most frequent first, at most own_text.PREVIEW_WORDS
    new_count: int  # how many different words aren't known
    lines: int
    parts: int  # a long text is split into parts of about own_text.PART_CHARS characters
    characters: int
    seconds: int  # about how long it takes to hear read aloud
    cost_usd: float  # translating and recording it, as an estimate


class OwnAddedOut(BaseModel):
    ids: list[int]  # each part's text, in order: pending until translated and recorded


def _language(code: Code) -> Code:
    if code not in TEXT_LANGUAGES or code in HIDDEN_LANGUAGES:
        raise HTTPException(422, "Read & Listen has no texts in that language.")
    return code


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine

    @routes.post("/api/own-texts/preview", dependencies=authed, response_model=OwnPreviewOut)
    async def preview(body: OwnTextIn) -> OwnPreviewOut:
        try:
            found = engine.own_preview(_language(body.language), body.text, body.title)
        except OwnTextRefused as e:
            raise HTTPException(422, str(e)) from e
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return OwnPreviewOut(**found.json())

    @routes.post("/api/own-texts", status_code=202, dependencies=authed, response_model=OwnAddedOut)
    async def add(body: OwnTextIn) -> OwnAddedOut:
        try:
            ids = engine.add_own_text(_language(body.language), body.text, body.title)
        except OwnTextRefused as e:
            raise HTTPException(422, str(e)) from e
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return OwnAddedOut(ids=ids)

    return routes
