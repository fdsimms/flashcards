""" "Your topics": grammar pages the owner asked for by name (grammar_topics.py)."""

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from franki_reader import (
    grammar_topics,
    store,
    topic_image,
)
from franki_reader.languages import Code
from franki_reader.routes.context import NO_CLAUDE, AppContext
from franki_reader.routes.views import instant
from franki_reader.study_day import study_day_start


class GrammarTopicIn(BaseModel):
    language: Code
    title: str = Field(min_length=1, max_length=grammar_topics.MAX_TITLE)


class TopicImageIn(BaseModel):
    language: Code
    image: str = Field(min_length=1, max_length=topic_image.MAX_IMAGE_CHARS)  # base64
    media_type: Literal["image/jpeg", "image/png", "image/webp", "image/gif"]


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    write_topic = ctx.write_topic
    # Your topics' pages being written (grammar_topics.write_page), shared by every request.
    grammar_topics_writing: set[int] = set()
    read_topic_image = ctx.read_topic_image
    # Images read for a topic's title in each study day (topic_image.py); a restart resets it.
    topic_image_reads: dict[datetime, int] = {}

    def grammar_topic_json(t: store.GrammarTopic) -> dict[str, Any]:
        status = t.status
        if status == "writing" and t.id not in grammar_topics_writing:
            # Left "writing" by a restart: nothing is writing it, so say what the page has.
            store.fail_grammar_topic_write(engine.conn, t.id, grammar_topics.INTERRUPTED)
            fresh = store.get_grammar_topic(engine.conn, t.id)
            t = fresh or t
            status = t.status
        return {
            "id": t.id,
            "language": t.language,
            "title": t.title,
            "status": status,
            "note": t.note,
            "lead": t.lead,
            "explanation": t.explanation,
            "examples": t.examples,
            "created_at": instant(t.created_at),
        }

    def start_grammar_topic_write(
        topic: store.GrammarTopic, kind: grammar_topics.Kind, background: BackgroundTasks
    ) -> None:
        """Marks the page writing and counts the write now, so the response and the next request
        see it; the write itself runs after the response."""
        assert write_topic is not None
        grammar_topics_writing.add(topic.id)
        store.mark_grammar_topic_writing(engine.conn, topic.id)
        write_id = store.start_grammar_topic_write(
            engine.conn, topic.id, topic.language, engine.clock()
        )
        writer = write_topic

        async def run() -> None:
            try:
                await grammar_topics.write_page(
                    engine.conn, engine.snapshot, writer, topic.id, kind, write_id
                )
            finally:
                grammar_topics_writing.discard(topic.id)

        background.add_task(run)

    def check_grammar_topic_write() -> None:
        """Refuses a write when Claude isn't set up or the day's writes are used."""
        if write_topic is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "write a topic"))
        since = study_day_start(engine.clock(), engine.rollover(), engine.zone)
        if (
            store.grammar_topic_writes_since(engine.conn, since)
            >= grammar_topics.MAX_WRITES_PER_DAY
        ):
            raise HTTPException(
                429,
                f"You've asked for {grammar_topics.MAX_WRITES_PER_DAY} topic pages today. "
                "Try again after your study day starts.",
            )

    @routes.get("/api/grammar-topics", dependencies=authed)
    async def list_grammar_topics(language: Code) -> dict[str, Any]:
        return {
            "topics": [
                {
                    "id": t["id"],
                    "title": t["title"],
                    "status": t["status"],
                    "created_at": t["created_at"],
                }
                for t in map(grammar_topic_json, store.list_grammar_topics(engine.conn, language))
            ]
        }

    @routes.post("/api/grammar-topics", dependencies=authed)
    async def add_grammar_topic(body: GrammarTopicIn, background: BackgroundTasks) -> Response:
        title = " ".join(body.title.split())
        if not title:
            raise HTTPException(422, "Type a topic to write about.")
        existing = store.find_grammar_topic(engine.conn, body.language, title)
        if existing is not None:
            return JSONResponse(grammar_topic_json(existing), status_code=200)
        if store.count_grammar_topics(engine.conn, body.language) >= grammar_topics.MAX_TOPICS:
            raise HTTPException(
                409,
                f"You have {grammar_topics.MAX_TOPICS} topics in this language. "
                "Delete one to add another.",
            )
        check_grammar_topic_write()
        topic = store.add_grammar_topic(engine.conn, body.language, title, engine.clock())
        start_grammar_topic_write(topic, "page", background)
        return JSONResponse(grammar_topic_json(topic), status_code=202)

    @routes.post("/api/grammar-topics/read-image", dependencies=authed)
    async def read_grammar_topic_image(body: TopicImageIn) -> dict[str, str]:
        """The grammar point an image (a photo of a book's page, a screenshot) is about, as a title
        to put in the New topic screen. Nothing is stored: the topic is made by a separate call
        once the owner has looked at the title."""
        if read_topic_image is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "read an image"))
        since = study_day_start(engine.clock(), engine.rollover(), engine.zone)
        if topic_image_reads.get(since, 0) >= topic_image.MAX_READS_PER_DAY:
            raise HTTPException(
                429,
                f"You've read {topic_image.MAX_READS_PER_DAY} images today. "
                "Type the topic, or try again after your study day starts.",
            )
        if since not in topic_image_reads:
            topic_image_reads.clear()  # an earlier day's count is no use
        topic_image_reads[since] = topic_image_reads.get(since, 0) + 1
        try:
            title, used = await read_topic_image(body.language, body.image, body.media_type)
        except topic_image.ReadFailed as e:
            ctx.keep_failed_cost("topic_image", body.language, e.usage)
            raise HTTPException(502, str(e)) from e
        store.save_call_cost(
            engine.conn, "topic_image", body.language, engine.clock(), used.cost_usd()
        )
        if title is None:
            raise HTTPException(422, topic_image.NOT_FOUND)
        return {"title": title}

    @routes.get("/api/grammar-topics/{topic_id}", dependencies=authed)
    async def get_grammar_topic(topic_id: int) -> dict[str, Any]:
        topic = store.get_grammar_topic(engine.conn, topic_id)
        if topic is None:
            raise HTTPException(404, "This topic is gone.")
        return grammar_topic_json(topic)

    async def regenerate_grammar_topic(
        topic_id: int, kind: grammar_topics.Kind, background: BackgroundTasks
    ) -> Response:
        topic = store.get_grammar_topic(engine.conn, topic_id)
        if topic is None:
            raise HTTPException(404, "This topic is gone.")
        if topic_id in grammar_topics_writing:
            return JSONResponse(grammar_topic_json(topic), status_code=202)
        check_grammar_topic_write()
        if kind == "examples" and not topic.lead:
            kind = "page"  # nothing to add examples to: write the whole page
        start_grammar_topic_write(topic, kind, background)
        fresh = store.get_grammar_topic(engine.conn, topic_id) or topic
        return JSONResponse(grammar_topic_json(fresh), status_code=202)

    @routes.post("/api/grammar-topics/{topic_id}/examples", dependencies=authed)
    async def new_grammar_examples(topic_id: int, background: BackgroundTasks) -> Response:
        return await regenerate_grammar_topic(topic_id, "examples", background)

    @routes.post("/api/grammar-topics/{topic_id}/rewrite", dependencies=authed)
    async def rewrite_grammar_topic(topic_id: int, background: BackgroundTasks) -> Response:
        return await regenerate_grammar_topic(topic_id, "page", background)

    @routes.delete("/api/grammar-topics/{topic_id}", status_code=204, dependencies=authed)
    async def delete_grammar_topic(topic_id: int) -> Response:
        store.remove_grammar_topic(engine.conn, topic_id)
        return Response(status_code=204)

    return routes
