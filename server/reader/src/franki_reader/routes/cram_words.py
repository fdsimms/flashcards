"""Words to learn for a cram's topic (cram_words.py)."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from franki_reader import cram_words, lesson_words, store
from franki_reader.languages import LANGUAGES, Code
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

    return routes
