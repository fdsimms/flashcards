"""Words to learn for a cram's topic (cram_words.py)."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from franki_reader import cram_phrases, cram_words, lesson_words, store
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lesson import MAX_CHARS
from franki_reader.lexicon import lexicon_from
from franki_reader.register import Register
from franki_reader.routes.context import NO_CLAUDE, AppContext


class WordsIn(BaseModel):
    language: Code
    # What the cram is for, as the learner named it; empty for a cram with no subject yet.
    topic: str = Field(default="", max_length=cram_words.MAX_TEXT)
    # What really happened, in the learner's words (the cram's note).
    facts: str = Field(default="", max_length=cram_words.MAX_TEXT * 2)
    # What the learner typed to steer the words ("how the race felt").
    focus: str = Field(default="", max_length=cram_words.MAX_TEXT)
    # Words already in the cram or already shown, which are left out.
    exclude: list[str] = Field(default_factory=list, max_length=cram_words.MAX_EXCLUDED)


class PhraseWordIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    english: str = Field(min_length=1, max_length=MAX_CHARS)


class PhrasesIn(BaseModel):
    language: Code
    topic: str = Field(default="", max_length=cram_words.MAX_TEXT)
    facts: str = Field(default="", max_length=cram_words.MAX_TEXT * 2)
    focus: str = Field(default="", max_length=cram_words.MAX_TEXT)
    # The cram's words, for the phrases to use.
    words: list[PhraseWordIn] = Field(default_factory=list, max_length=cram_phrases.MAX_WORDS)
    # Phrases already on the cram or already shown, which are left out.
    exclude: list[str] = Field(default_factory=list, max_length=cram_phrases.MAX_EXCLUDED)
    # Named `register_level` because a pydantic model has a `register` of its own (ABCMeta's).
    register_level: Register | None = Field(default=None, alias="register")
    # Thai only: the learner's polite ending, so the phrases are in their gender.
    particle: Literal["khrap", "kha"] | None = None


class PhraseOut(BaseModel):
    text: str  # in the language's own script
    reading: str
    english: str


class PhrasesOut(BaseModel):
    phrases: list[PhraseOut]


class SuggestedWordOut(BaseModel):
    text: str  # in the language's own script
    reading: str
    english: str
    commonness: str
    # Named `register_level` because a pydantic model has a `register` of its own (ABCMeta's).
    register_level: str = Field(alias="register")


class WordsOut(BaseModel):
    words: list[SuggestedWordOut]


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    suggest = ctx.suggest_cram_words
    write_phrases = ctx.write_cram_phrases

    @routes.post("/api/cram/words", dependencies=authed)
    async def cram_words_route(body: WordsIn) -> WordsOut:
        """Words Claude suggests for a cram's topic, for the learner to pick from. Writes nothing:
        the app tags the ones the deck has and queues the rest, each behind the learner's tap."""
        if suggest is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "suggest words"))
        if body.language == "en":
            raise HTTPException(
                422, f"Words aren't suggested in {LANGUAGES[body.language].name} yet."
            )
        exclude = tuple(dict.fromkeys(" ".join(w.split()) for w in body.exclude if w.strip()))
        try:
            found, used = await suggest(
                body.language,
                " ".join(body.topic.split()),
                " ".join(body.facts.split()),
                " ".join(body.focus.split()),
                exclude,
            )
        except lesson_words.LessonWordsFailed as e:
            ctx.keep_failed_cost("cram_words", body.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "cram_words", body.language, engine.clock(), used.cost_usd()
        )
        return WordsOut(
            words=[
                SuggestedWordOut(
                    text=w.text,
                    reading=w.reading,
                    english=w.english,
                    commonness=w.commonness,
                    register=w.register,
                )
                for w in found
            ]
        )

    @routes.post("/api/cram/phrases", dependencies=authed)
    async def cram_phrases_route(body: PhrasesIn) -> PhrasesOut:
        """Phrases Claude writes for a cram's topic from its words, for the learner to pick from.
        Writes nothing: the app keeps the checked ones on the cram, and none is a note."""
        if write_phrases is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "suggest phrases"))
        if body.language == "en":
            raise HTTPException(
                422, f"Phrases aren't suggested in {LANGUAGES[body.language].name} yet."
            )
        entries, _ = engine.snapshot(body.language)
        wanikani = engine.wanikani_entries(body.language)
        settings = store.load_settings(engine.conn)
        # Known for the check: what the deck knows, and the cram's words, which the phrases are
        # meant to use even though they aren't studied yet.
        known = lexicon_from(
            entries,
            body.language,
            settings.common_for(body.language),
            [*(e.text for e in wanikani), *(w.text for w in body.words)],
        )
        seeds = cram_phrases.PhraseSeeds(
            topic=" ".join(body.topic.split()),
            facts=" ".join(body.facts.split()),
            focus=" ".join(body.focus.split()),
            words=tuple(
                (" ".join(w.text.split()), " ".join(w.english.split())) for w in body.words
            ),
            exclude=tuple(dict.fromkeys(" ".join(p.split()) for p in body.exclude if p.strip())),
            register=body.register_level or settings.register,
            learner="female" if body.language == "th" and body.particle == "kha" else "male",
        )
        try:
            found, used = await cram_phrases.suggest_phrases(
                write_phrases, body.language, seeds, known
            )
        except lesson_words.LessonWordsFailed as e:
            ctx.keep_failed_cost("cram_phrases", body.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "cram_phrases", body.language, engine.clock(), used.cost_usd()
        )
        return PhrasesOut(
            phrases=[PhraseOut(text=p.text, reading=p.reading, english=p.english) for p in found]
        )

    return routes
