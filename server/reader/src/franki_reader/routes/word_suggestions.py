"""Words to add to a language's deck when its new cards run low (word_suggestions.py)."""

import asyncio

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from franki_reader import rare_words, store, word_suggestions
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry
from franki_reader.routes.context import AppContext


class WordSuggestionOut(BaseModel):
    word: str  # its dictionary form
    meaning: str  # "" when nothing glosses it yet
    rank: int | None  # its place among the language's most common words, None past the list
    texts: int  # texts read to the end it was in; 0 for a common word


class WordSuggestionsOut(BaseModel):
    """The words from texts read, the common words the deck lacks and, for English, the rare words
    Claude wrote, each source best first. `written_error` says why Claude's words are missing."""

    texts: list[WordSuggestionOut]
    common: list[WordSuggestionOut]
    written: list[WordSuggestionOut]
    written_error: str


class DismissWordIn(BaseModel):
    language: Code
    word: str = Field(min_length=1, max_length=200)


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    write_rare_words = ctx.write_rare_words
    keep_failed_cost = ctx.keep_failed_cost
    asking = asyncio.Lock()  # two opens at once would each pay for a call

    def out(s: word_suggestions.Suggestion) -> WordSuggestionOut:
        return WordSuggestionOut(word=s.word, meaning=s.meaning, rank=s.rank, texts=s.texts)

    async def written(language: Code, entries: list[Entry]) -> tuple[list[WordSuggestionOut], str]:
        """The kept words Claude wrote, asking for more when fewer than REFILL_BELOW are left.
        A failed call is said, not dropped, and leaves the kept words as they are."""
        if write_rare_words is None:
            return [], (
                "Claude isn't set up on the server, so it can't suggest rare words"
                " (ANTHROPIC_API_KEY in server/.env turns it on)."
            )
        async with asking:
            skip = word_suggestions.skip_for(engine.conn, language, entries, [])
            kept = [
                (w, m)
                for w, m in store.written_words(engine.conn, language)
                if not word_suggestions.left_out(w, skip)
            ]
            error = ""
            if len(kept) < rare_words.REFILL_BELOW:
                avoid = [w for w, _ in store.written_words(engine.conn, language)]
                avoid += store.dismissed_words(engine.conn, language)
                try:
                    given, used = await write_rare_words(language, entries, avoid)
                except rare_words.RareWordsFailed as e:
                    keep_failed_cost("rare_words", language, e.usage)
                    error = str(e)
                else:
                    store.save_call_cost(
                        engine.conn, "rare_words", language, engine.clock(), used.cost_usd()
                    )
                    new = rare_words.clean(given, language, skip, [w for w, _ in kept])
                    store.save_written_words(
                        engine.conn, language, [(w.word, w.meaning) for w in new], engine.clock()
                    )
                    kept += [(w.word, w.meaning) for w in new]
        top = kept[: word_suggestions.MAX_EACH]
        return [WordSuggestionOut(word=w, meaning=m, rank=None, texts=0) for w, m in top], error

    @routes.get("/api/word-suggestions", dependencies=authed)
    async def get_word_suggestions(language: Code) -> WordSuggestionsOut:
        """Reads the snapshot of the deck only, and for English may ask Claude for rare words (a
        call only when the kept ones run short): nothing here adds a note or grades a card. A word
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
        picks, error = (
            await written(language, entries) if LANGUAGES[language].writes_rare_words else ([], "")
        )
        return WordSuggestionsOut(
            texts=[out(s) for s in texts],
            common=[out(s) for s in common],
            written=picks,
            written_error=error,
        )

    @routes.post("/api/word-suggestions/dismiss", dependencies=authed, status_code=204)
    async def dismiss_word(body: DismissWordIn) -> Response:
        """Not interested: the word isn't suggested for the language again."""
        store.dismiss_word(engine.conn, body.language, " ".join(body.word.split()), engine.clock())
        return Response(status_code=204)

    return routes
