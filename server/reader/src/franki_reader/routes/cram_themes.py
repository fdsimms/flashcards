"""Themes to talk about for a cram (cram_themes.py)."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from franki_reader import cram_themes, store, word_suggestions
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lesson import MAX_CHARS
from franki_reader.register import Register
from franki_reader.routes.context import NO_CLAUDE, AppContext


class PoolIn(BaseModel):
    # The app's own id for the note, handed back with the themes that use it.
    id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    english: str = Field(min_length=1, max_length=MAX_CHARS)
    kind: cram_themes.Kind


class ThemesIn(BaseModel):
    language: Code
    # Words from the learner's deck to build themes from, each with why it is on offer.
    words: list[PoolIn] = Field(min_length=1, max_length=cram_themes.MAX_POOL)
    # What Practice has been missing, as the app words it.
    weak_spots: list[str] = Field(default_factory=list, max_length=cram_themes.MAX_WEAK)
    # Titles of crams already made and themes already on screen.
    avoid: list[str] = Field(default_factory=list, max_length=cram_themes.MAX_AVOID)
    # Questions and a story a little above the learner's level.
    stretch: bool = False
    # What the lesson is for, as the learner named the cram: every theme is an angle on it.
    topic: str = Field(default="", max_length=cram_themes.MAX_TITLE * 2)
    # How casual or formal the questions and the story sound; the Settings default when left out.
    # Named `register_level` because a pydantic model has a `register` of its own (ABCMeta's).
    register_level: Register | None = Field(default=None, alias="register")


class LineOut(BaseModel):
    text: str
    english: str


class WordOut(BaseModel):
    word: str  # a common word the deck lacks, as the note's Entry would start
    english: str


class ThemeOut(BaseModel):
    title: str
    why: str  # "" when Claude's reason couldn't be shown
    word_ids: list[str]  # the `id`s of the deck words the theme uses
    new_words: list[WordOut]
    questions: list[LineOut]
    story: LineOut | None


class ThemesOut(BaseModel):
    themes: list[ThemeOut]


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    write_cram_themes = ctx.write_cram_themes

    @routes.post("/api/cram/themes", dependencies=authed)
    async def cram_themes_route(body: ThemesIn) -> ThemesOut:
        """Themes for a lesson, written by Claude from the learner's words. Reads the snapshot of
        the deck for the common words it lacks; adds no note, writes no card and grades nothing."""
        if write_cram_themes is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "suggest themes"))
        if body.language == "en":
            raise HTTPException(
                422, f"Themes aren't made in {LANGUAGES[body.language].name} words yet."
            )
        entries, lexicon = engine.snapshot(body.language)
        from_texts, common = word_suggestions.suggest(
            engine.conn,
            body.language,
            entries,
            lexicon,
            engine.wanikani_entries(body.language),
            engine.meanings(body.language),
        )
        seeds = cram_themes.Seeds(
            pool=tuple(
                cram_themes.PoolWord(
                    w.id, " ".join(w.text.split()), " ".join(w.english.split()), w.kind
                )
                for w in body.words
            ),
            candidates=tuple(
                cram_themes.Candidate(s.word, s.meaning)
                for s in [*from_texts, *common][: cram_themes.MAX_CANDIDATES]
            ),
            weak_spots=tuple(
                " ".join(s.split())[: cram_themes.MAX_WEAK_CHARS] for s in body.weak_spots
            ),
            avoid=tuple(" ".join(a.split())[: cram_themes.MAX_TITLE * 2] for a in body.avoid),
            stretch=body.stretch,
            topic=" ".join(body.topic.split()),
            register=body.register_level or store.load_settings(engine.conn).register,
        )
        try:
            raw, used = await write_cram_themes(body.language, seeds)
        except cram_themes.ThemesFailed as e:
            ctx.keep_failed_cost("cram_themes", body.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "cram_themes", body.language, engine.clock(), used.cost_usd()
        )
        themes = cram_themes.clean_themes(raw, seeds, body.language)
        if not themes:
            raise HTTPException(503, "Claude had no new themes. Try again.")
        return ThemesOut(
            themes=[
                ThemeOut(
                    title=t.title,
                    why=t.why,
                    word_ids=list(t.word_ids),
                    new_words=[WordOut(word=c.text, english=c.english) for c in t.new_words],
                    questions=[LineOut(text=q.text, english=q.english) for q in t.questions],
                    story=LineOut(text=t.story.text, english=t.story.english) if t.story else None,
                )
                for t in themes
            ]
        )

    return routes
