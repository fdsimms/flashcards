"""Words to add to a language's deck when its new cards run low (word_suggestions.py)."""

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from franki_reader import store, word_suggestions
from franki_reader.languages import Code
from franki_reader.routes.context import AppContext


class WordSuggestionOut(BaseModel):
    word: str  # its dictionary form
    meaning: str  # "" when nothing glosses it yet
    rank: int | None  # its place among the language's most common words, None past the list
    texts: int  # texts read to the end it was in; 0 for a common word


class WordSuggestionsOut(BaseModel):
    """The words from texts read, then the common words the deck lacks, each source best first."""

    texts: list[WordSuggestionOut]
    common: list[WordSuggestionOut]


class DismissWordIn(BaseModel):
    language: Code
    word: str = Field(min_length=1, max_length=200)


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine

    def out(s: word_suggestions.Suggestion) -> WordSuggestionOut:
        return WordSuggestionOut(word=s.word, meaning=s.meaning, rank=s.rank, texts=s.texts)

    @routes.get("/api/word-suggestions", dependencies=authed)
    async def get_word_suggestions(language: Code) -> WordSuggestionsOut:
        """Reads the snapshot of the deck only: nothing here adds a note or grades a card. A word
        saved since the snapshot was read can still be listed; the app leaves out what its own
        copy of the deck already has."""
        entries, lexicon = engine.snapshot(language)
        texts, common = word_suggestions.suggest(
            engine.conn,
            language,
            entries,
            lexicon,
            engine.wanikani_entries(language),
            engine.meanings(language),
        )
        return WordSuggestionsOut(texts=[out(s) for s in texts], common=[out(s) for s in common])

    @routes.post("/api/word-suggestions/dismiss", dependencies=authed, status_code=204)
    async def dismiss_word(body: DismissWordIn) -> Response:
        """Not interested: the word isn't suggested for the language again."""
        store.dismiss_word(engine.conn, body.language, " ".join(body.word.split()), engine.clock())
        return Response(status_code=204)

    return routes
