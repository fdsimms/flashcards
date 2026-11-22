"""Talk it through in English, for a cram (cram_say.py)."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from franki_reader import cram_say, cram_themes, store
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import lexicon_from
from franki_reader.register import Register
from franki_reader.routes.context import NO_CLAUDE, AppContext
from franki_reader.routes.cram_themes import PoolIn, WordOut


class TurnIn(BaseModel):
    asker: Literal["claude", "you"]
    text: str = Field(min_length=1, max_length=cram_say.MAX_TURN_CHARS)


class QuestionIn(BaseModel):
    language: Code
    # What the lesson is for, as the learner named the cram.
    topic: str = Field(default="", max_length=cram_themes.MAX_TITLE * 2)
    # The chat so far, oldest first; empty asks the opening question.
    turns: list[TurnIn] = Field(default_factory=list, max_length=cram_say.MAX_TURNS)


class QuestionOut(BaseModel):
    question: str


class LinesIn(BaseModel):
    language: Code
    topic: str = Field(default="", max_length=cram_themes.MAX_TITLE * 2)
    # What the learner said in English: their answers, or one free write.
    said: str = Field(min_length=1, max_length=cram_say.MAX_SAID)
    # The learner's words to build the lines from, as the themes take them.
    words: list[PoolIn] = Field(default_factory=list, max_length=cram_themes.MAX_POOL)
    register_level: Register | None = Field(default=None, alias="register")
    particle: Literal["khrap", "kha"] | None = None


class SaidOut(BaseModel):
    english: str
    text: str
    known: int  # how many of the line's words the learner knows
    missing: list[WordOut]


class LinesOut(BaseModel):
    summary: str
    lines: list[SaidOut]


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    write = ctx.write_cram_say

    def check(language: Code) -> cram_say.WriteSay:
        if write is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "ask questions"))
        if language == "en":
            raise HTTPException(422, f"Not made in {LANGUAGES[language].name} words.")
        return write

    @routes.post("/api/cram/say/ask", dependencies=authed)
    async def cram_say_ask(body: QuestionIn) -> QuestionOut:
        """The next question of a talk in English about a lesson's topic, written by Claude. Reads
        nothing of the deck, writes no card and grades nothing."""
        writer = check(body.language)
        turns = tuple(cram_say.Turn(t.asker, " ".join(t.text.split())) for t in body.turns)
        try:
            text, used = await writer.question(body.language, " ".join(body.topic.split()), turns)
        except cram_say.SayFailed as e:
            ctx.keep_failed_cost("cram_say", body.language, e.usage)
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "cram_say", body.language, engine.clock(), used.cost_usd()
        )
        question = cram_say.clean_question(text)
        if not question:
            raise HTTPException(503, "Claude had no question. Try again.")
        return QuestionOut(question=question)

    @routes.post("/api/cram/say/lines", dependencies=authed)
    async def cram_say_lines(body: LinesIn) -> LinesOut:
        """What the learner would want to say, from what they said in English: a line in the
        language for each, built from their words, with the words they lack marked."""
        writer = check(body.language)
        entries, _ = engine.snapshot(body.language)
        wanikani = engine.wanikani_entries(body.language)
        seeds = cram_themes.Seeds(
            pool=tuple(
                cram_themes.PoolWord(
                    w.id, " ".join(w.text.split()), " ".join(w.english.split()), w.kind
                )
                for w in body.words
            ),
            candidates=(),
            weak_spots=(),
            avoid=(),
            stretch=False,
            topic=" ".join(body.topic.split()),
            register=body.register_level or store.load_settings(engine.conn).register,
            learner="female" if body.language == "th" and body.particle == "kha" else "male",
            deck=cram_themes.deck_of(entries),
            facts=" ".join(body.said.split()),
        )
        known = lexicon_from(
            entries,
            body.language,
            store.load_settings(engine.conn).common_for(body.language),
            [*(e.text for e in wanikani), *(w.text for w in seeds.pool)],
        )
        try:
            raw, used = await writer.lines(body.language, seeds)
        except cram_say.SayFailed as e:
            ctx.keep_failed_cost("cram_say", body.language, e.usage)
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "cram_say", body.language, engine.clock(), used.cost_usd()
        )
        summary, lines = cram_say.clean_lines(
            raw, seeds, body.language, known, engine.meanings(body.language)
        )
        if not lines:
            raise HTTPException(503, "Claude had nothing to suggest from that. Try again.")
        return LinesOut(
            summary=summary,
            lines=[
                SaidOut(
                    english=s.english,
                    text=s.text,
                    known=s.known,
                    missing=[WordOut(word=m.text, english=m.english) for m in s.missing],
                )
                for s in lines
            ],
        )

    return routes
