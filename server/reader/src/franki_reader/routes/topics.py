"""Reading topics, the shelf, stories, and the next text for a topic."""

from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from franki_reader import store
from franki_reader.engine import Engine, NotAvailable, NotFound, TopicState
from franki_reader.generator import (
    MODEL,
    Form,
    TextModel,
)
from franki_reader.genre import Genre
from franki_reader.languages import Code
from franki_reader.routes.context import AppContext
from franki_reader.routes.views import listed_story_json, rendered_text, shelf_json, stories_json
from franki_reader.store import Topic
from franki_reader.suggestions import suggest


class TopicOut(BaseModel):
    """A reading topic as the app lists it, its count and state in the language being shown."""

    id: int
    name: str
    ready: int  # texts on this topic waiting to be read
    state: TopicState


class SuggestionOut(BaseModel):
    name: str
    fit: float  # the share of the idea's words the deck knows


def topic_json(t: Topic, engine: Engine, language: Code) -> TopicOut:
    # A topic's ready count is per language, so it's read again for the one being shown.
    t = store.get_topic(engine.conn, t.id, language) or t
    return TopicOut(id=t.id, name=t.name, ready=t.ready, state=engine.topic_state(t, language))


class NewTopic(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class WriteIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    form: Form = "dialogue"
    # Which model writes it; an app from before the choice leaves it out and gets Sonnet.
    model: TextModel = MODEL
    # The kind of text (genre.py); an app from before the choice leaves it out and gets "any".
    genre: Genre = "any"


class StoryIn(BaseModel):
    # What the story is about; empty lets the model choose.
    about: str = Field(default="", max_length=200)
    # The kind of story (genre.py), kept for every episode; an older app leaves it out.
    genre: Genre = "any"


class NextIn(BaseModel):
    # The cards just studied, to write a text that practices them (the app's "Read a text with
    # these words"). Each is a note's Entry, as the deck has it.
    words: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=500)
    # What really happened, for a text about the owner's own day (a cram's "what really happened"):
    # the text is written from it. It never tells two texts apart, only how this one is written.
    about: str = Field(default="", max_length=300)


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine

    @routes.get("/api/topics", dependencies=authed)
    async def topics(background: BackgroundTasks) -> list[TopicOut]:
        background.add_task(engine.top_up)
        language = engine.language()
        return [topic_json(t, engine, language) for t in store.list_topics(engine.conn, language)]

    @routes.post("/api/topics", dependencies=authed)
    async def add_topic(body: NewTopic, background: BackgroundTasks) -> TopicOut:
        try:
            topic = store.add_topic(engine.conn, body.name, engine.clock())
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        background.add_task(engine.top_up)
        return topic_json(topic, engine, engine.language())

    @routes.delete("/api/topics/{topic_id}", status_code=204, dependencies=authed)
    async def remove_topic(topic_id: int) -> Response:
        if not store.remove_topic(engine.conn, topic_id):
            raise HTTPException(404, "No such topic.")
        return Response(status_code=204)

    @routes.get("/api/suggestions", dependencies=authed)
    async def suggestions() -> list[SuggestionOut]:
        language = engine.language()
        _, lexicon = engine.snapshot(language)
        taken = store.topic_names(engine.conn)
        return [SuggestionOut(name=s.name, fit=s.fit) for s in suggest(lexicon, taken, language)]

    @routes.post("/api/topics/{topic_id}/next", dependencies=authed)
    async def next_text(
        topic_id: int, background: BackgroundTasks, body: NextIn | None = None
    ) -> Any:
        try:
            text = await engine.next_text(
                topic_id, body.words if body else (), body.about if body else ""
            )
        except NotFound as e:
            raise HTTPException(404, "No such topic.") from e
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        if text is None:
            stage = engine.writing_stage(topic_id, body.words if body else ())
            return JSONResponse({"writing": True, "stage": stage}, status_code=202)
        background.add_task(engine.top_up)
        return rendered_text(text, engine)

    @routes.get("/api/shelf", dependencies=authed)
    async def shelf(background: BackgroundTasks, language: Code | None = None) -> dict[str, Any]:
        # Another language's shelf (the app keeping every language's texts for offline) is only
        # read: the reader's language stays, and nothing is topped up for it.
        if language is not None:
            return shelf_json(engine, language)
        # Started before the shelf is built, so a story with no episode waiting reads "Writing
        # episode N" in this answer, not "not written yet" with the writing begun after it.
        engine.start_missing_episodes()
        background.add_task(engine.top_up)
        return shelf_json(engine)

    @routes.post("/api/shelf/write", status_code=202, dependencies=authed)
    async def write(body: WriteIn) -> dict[str, Any]:
        try:
            topic = engine.write_about(body.name, body.form, body.model, body.genre)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return {"writing": True, "topic": topic.name}

    @routes.post("/api/story", status_code=202, dependencies=authed)
    async def start_story(body: StoryIn) -> dict[str, Any]:
        try:
            story = engine.start_story(body.about, body.genre)
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return {"writing": True, "id": story.id}

    @routes.get("/api/stories", dependencies=authed)
    async def stories(background: BackgroundTasks) -> dict[str, Any]:
        # The reader's language's stories, running and ended. Started before the answer is built, as
        # for the shelf.
        engine.start_missing_episodes()
        background.add_task(engine.top_up)
        return stories_json(engine)

    @routes.get("/api/stories/{story_id}", dependencies=authed)
    async def story(story_id: int) -> dict[str, Any]:
        # One story for its own page: as the card has it (Last time, the next episode's practice
        # words), whichever story it is.
        found = store.get_story(engine.conn, story_id)
        if found is None:
            raise HTTPException(404, "No such series.")
        # A story with nothing waiting reads "not written yet" here, so opening its page starts it.
        engine.start_missing_episodes()
        return listed_story_json(engine, found, card=True)

    @routes.post("/api/stories/{story_id}/pin", status_code=204, dependencies=authed)
    async def pin_story(story_id: int) -> Response:
        # Shows a running story on the shelf's card, in place of the one there.
        if not store.pin_story(engine.conn, story_id):
            raise HTTPException(404, "That series isn't running.")
        return Response(status_code=204)

    @routes.post("/api/stories/{story_id}/end", status_code=204, dependencies=authed)
    async def end_story(story_id: int) -> Response:
        # No more episodes; the ones written stay in Past texts.
        if not store.end_story(engine.conn, story_id):
            raise HTTPException(404, "That series has already ended.")
        return Response(status_code=204)

    @routes.post("/api/stories/{story_id}/continue", status_code=204, dependencies=authed)
    async def continue_story(story_id: int, background: BackgroundTasks) -> Response:
        # Runs an ended story again; its next episode is written in the background.
        if not store.continue_story(engine.conn, story_id):
            raise HTTPException(404, "That series is already running.")
        background.add_task(engine.top_up)
        return Response(status_code=204)

    @routes.post("/api/texts/{text_id}/skip", status_code=204, dependencies=authed)
    async def skip(text_id: int, background: BackgroundTasks) -> Response:
        if not store.skip_text(engine.conn, text_id):
            raise HTTPException(404, "That text has already been read or removed.")
        background.add_task(engine.top_up)
        return Response(status_code=204)

    return routes
