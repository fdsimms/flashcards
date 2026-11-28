"""Texts once written: past texts and the audit, listening again, one text and its lines'
audio, the end of a reading (a story's choice, the reading log), the marked words, and words' places
among the most common (/api/ranks)."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from franki_reader import (
    audit,
    store,
    timing,
)
from franki_reader.engine import NotFound
from franki_reader.frequency import entry_place
from franki_reader.ipa import ipa_for
from franki_reader.languages import Code
from franki_reader.reader import (
    from_wanikani,
    gloss_for,
    kanji_for,
    lemma_for,
    parts_for,
)
from franki_reader.routes.context import AppContext
from franki_reader.routes.views import instant, rendered_text
from franki_reader.store import Reading

# How many past texts the list shows.
PAST_TEXTS = 50


class ClearWord(BaseModel):
    word: str = Field(min_length=1, max_length=100)


MAX_RANKED = 1000


class RanksIn(BaseModel):
    language: Code
    words: list[str] = Field(min_length=1, max_length=MAX_RANKED)


class RanksOut(BaseModel):
    ranks: dict[str, int | None]
    phrases: list[str]


class ChoiceIn(BaseModel):
    choice: int = Field(ge=0)


class ListenIn(BaseModel):
    # The app's own id for this listen, sent again with it if the listen is sent again.
    key: str | None = Field(default=None, min_length=1, max_length=64)
    # How long it played, for the week's listening time; missing from an app older than it.
    seconds: int | None = Field(default=None, ge=0, le=86_400)


class ReadingIn(BaseModel):
    rating: Literal["too_easy", "about_right", "too_hard"] | None = None
    finished: bool = False
    words_glossed: list[str] = []
    words_flagged: list[str] = []
    audio_speed: float | None = Field(default=None, ge=0.5, le=1.5)
    listen_only: bool = False
    seconds: int = Field(default=0, ge=0)
    # The check after reading, when it was taken: answers right, of those asked.
    check_right: int | None = Field(default=None, ge=0)
    check_asked: int | None = Field(default=None, ge=1, le=20)
    # The meaning quiz on a tapped word: the words answered right and wrong.
    quiz_right: list[str] = []
    quiz_wrong: list[str] = []


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine

    def past_json(t: store.PastText) -> dict[str, Any]:
        return {
            "id": t.id,
            "topic": t.topic,
            "title": t.title,
            "rating": t.rating,
            "read_at": instant(t.read_at),
            "coverage": t.coverage,
            "form": t.form,
            "episode": t.episode,
        }

    @routes.get("/api/texts", dependencies=authed)
    async def past_texts(story: int | None = None) -> list[dict[str, Any]]:
        return [
            past_json(t)
            for t in store.past_texts(engine.conn, PAST_TEXTS, engine.language(), story)
        ]

    @routes.get("/api/audit/texts", dependencies=authed)
    async def audit_texts(
        language: str | None = None,
        story: int | None = None,
        days: Annotated[int | None, Query(ge=1, le=3650)] = None,
        limit: Annotated[int, Query(ge=1, le=200)] = 50,
        status: Literal["shown", "skipped", "dropped", "all"] = "shown",
    ) -> list[dict[str, Any]]:
        """Every language's texts, for review (audit.py): the shown ones unless `status` asks for
        those taken off the shelf unread, the dropped drafts, or all; `/api/texts` is the app's."""
        return audit.list_texts(
            engine.conn,
            engine.clock(),
            language=language,
            story_id=story,
            days=days,
            limit=limit,
            status=status,
        )

    @routes.get("/api/audit/texts/{text_id}", dependencies=authed)
    async def audit_text(text_id: int) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        status = store.text_status(engine.conn, text_id)
        if text is None or status not in audit.AUDITED:
            raise HTTPException(404, "No such text.")
        topic = store.get_topic(engine.conn, text.topic_id, text.language, include_removed=True)
        story = store.get_story(engine.conn, text.story_id) if text.story_id else None
        return audit.compact(
            text,
            rendered_text(text, engine),
            status,
            story,
            (story.title or "Your story") if story else (topic.name if topic else ""),
            audit.readings(engine.conn, text_id),
            audit.floor_of(engine.conn, text_id),
            audit.asked(engine.conn, text_id),
            audit.dropped_for(engine.conn, text_id),
        )

    @routes.get("/api/relisten", dependencies=authed)
    async def relisten_texts(
        listens: Annotated[int, Query(ge=0, le=3)] = 3,
    ) -> list[dict[str, Any]]:
        """Finished texts due to be heard again, as `/api/texts` lists them (relisten.py), with
        `listens` wanted per text: 3 (1, 4 and 10 days), 1 (3 days) or 0 (none)."""
        if listens == 2:
            raise HTTPException(422, "Ask for 0, 1 or 3 listens.")
        return [past_json(t) for t in engine.relisten(listens=listens)]

    @routes.post("/api/texts/{text_id}/listen", status_code=204, dependencies=authed)
    async def listened(text_id: int, body: ListenIn | None = None) -> Response:
        """A finished text heard again with its words hidden. Only counted: no reading, no
        difficulty change. 404 for a text that wasn't read to the end. With a `key`, a listen
        already counted under it isn't counted twice."""
        if not store.log_listen(
            engine.conn,
            text_id,
            engine.clock(),
            body.key if body else None,
            body.seconds if body else None,
        ):
            raise HTTPException(404, "No such text.")
        return Response(status_code=204)

    @routes.get("/api/texts/{text_id}", dependencies=authed)
    async def get_text(text_id: int) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None or store.text_status(engine.conn, text_id) == "dropped":
            raise HTTPException(404, "No such text.")
        return rendered_text(text, engine)

    @routes.get("/api/texts/{text_id}/lines/{line}/audio", dependencies=authed)
    async def line_audio(
        text_id: int, line: int, speed: Literal["normal", "slow"] = "normal"
    ) -> FileResponse:
        text = store.get_text(engine.conn, text_id)
        if text is None:
            raise HTTPException(404, "No such text.")
        path = await engine.line_audio(text, line, slow=speed == "slow")
        if path is None:
            raise HTTPException(404, "No audio for this line.")
        return FileResponse(path, media_type="audio/mpeg")

    @routes.get("/api/texts/{text_id}/lines/{line}/slow", dependencies=authed)
    async def slow_line(text_id: int, line: int) -> dict[str, Any]:
        """Records the line slowly if it isn't yet, and says when each of its words is spoken in
        that recording (`times`, one [start, end] in milliseconds or null per word of the line, as
        `words` has them), so the reader can follow along: the normal recording's times don't fit."""
        text = store.get_text(engine.conn, text_id)
        if text is None or store.text_status(engine.conn, text_id) == "dropped":
            raise HTTPException(404, "No such text.")
        if await engine.line_audio(text, line, slow=True) is None:
            raise HTTPException(404, "No slow audio for this line.")
        words = rendered_text(text, engine)["lines"][line]["words"]
        for word in words:
            word.pop("time", None)
        marks = engine.audio.marks(text.id, line, slow=True) if engine.audio else None
        timing.add_times(words, marks)
        return {"times": [w.get("time") for w in words]}

    @routes.post("/api/texts/{text_id}/choice", status_code=204, dependencies=authed)
    async def choose(text_id: int, body: ChoiceIn) -> Response:
        match store.set_choice(engine.conn, text_id, body.choice):
            case "unknown":
                raise HTTPException(404, "That choice isn't on this text.")
            case "read":
                raise HTTPException(
                    409, "This episode is already read, so its choice can't change."
                )
        return Response(status_code=204)

    @routes.post("/api/texts/{text_id}/reading", status_code=204, dependencies=authed)
    async def reading(text_id: int, body: ReadingIn, background: BackgroundTasks) -> Response:
        right, asked = body.check_right, body.check_asked
        checked = right is not None and asked is not None
        if right is not None and asked is not None and right > asked:
            raise HTTPException(422, "check_right can't be more than check_asked.")
        try:
            engine.record_reading(
                text_id,
                Reading(
                    rating=body.rating,
                    finished=body.finished,
                    words_glossed=tuple(body.words_glossed),
                    words_flagged=tuple(body.words_flagged),
                    audio_speed=body.audio_speed,
                    listen_only=body.listen_only,
                    seconds=body.seconds,
                    check_right=right if checked else None,
                    check_asked=asked if checked else None,
                    quiz_right=tuple(body.quiz_right),
                    quiz_wrong=tuple(body.quiz_wrong),
                ),
            )
        except NotFound as e:
            raise HTTPException(404, "No such text.") from e
        background.add_task(engine.top_up)
        return Response(status_code=204)

    @routes.get("/api/words", dependencies=authed)
    async def words() -> list[dict[str, Any]]:
        language = engine.language()
        lexicon = engine.snapshot(language)[1]
        known = engine.meanings(language)
        marked = store.marked_words(engine.conn, language)
        pronounced = {
            w.word: ipa_for(w.word, lexicon, None, engine.ai_ipa(language)) for w in marked
        }
        return [
            {
                "word": w.word,
                "gloss": (gloss := gloss_for(w.word, w.glosses, lexicon, known)),
                "ipa": (pronounced.get(w.word) or (None, None))[0],
                "ipa_source": (pronounced.get(w.word) or (None, None))[1],
                # A compound known from its parts, with no meaning of its own: the parts' meanings.
                "parts": None if gloss else parts_for(w.word, lexicon, known),
                "lemma": lemma_for(w.word, lexicon),
                "status": lexicon.status(w.word),
                "deck": lexicon.entry_of(w.word) is not None,
                "wanikani": from_wanikani(w.word, lexicon),
                "kanji": kanji_for(w.word, lexicon),
                "times": w.times,
                "last_marked": instant(w.last_marked),
            }
            for w in marked
        ]

    @routes.post("/api/ranks", dependencies=authed)
    async def ranks(body: RanksIn) -> RanksOut:
        """Where each deck entry stands among its language's most common words (frequency.entry_place):
        its place (1 is the most common), None past the list's end, and the entries that are phrases,
        which no list of single words ranks. Reads only: it never touches the deck or a card."""
        _, lexicon = engine.snapshot(body.language)
        places = {w: entry_place(w, lexicon) for w in dict.fromkeys(body.words)}
        return RanksOut(
            ranks={w: p.rank for w, p in places.items()},
            phrases=[w for w, p in places.items() if p.phrase],
        )

    @routes.post("/api/words/clear", status_code=204, dependencies=authed)
    async def clear_word(body: ClearWord) -> Response:
        store.clear_word(engine.conn, body.word, engine.clock())
        return Response(status_code=204)

    return routes
