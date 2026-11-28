"""Videos (video.py): a YouTube video's subtitles, previewed and then added as a text to read along."""

import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from franki_reader import video
from franki_reader.engine import NotAvailable
from franki_reader.languages import HIDDEN_LANGUAGES, LANGUAGES, Code
from franki_reader.routes.context import AppContext

# A video's subtitles are kept this long after a preview, so adding it doesn't ask YouTube again.
KEEP_SECONDS = 30 * 60
KEEP_MOST = 20


class VideoIn(BaseModel):
    language: Code
    # A link someone shared or pasted (video.video_id reads the id out of it).
    link: str = Field(min_length=1, max_length=500)


class VideoPreviewOut(BaseModel):
    """What adding a video would give, before it's added."""

    video_id: str
    title: str
    channel: str
    generated: bool  # YouTube's automatic subtitles, not the channel's own
    seconds: int  # the video's length, as far as its subtitles go
    coverage: float  # the share of its words the deck knows
    words: int
    new_words: list[str]
    new_count: int
    lines: int
    cost_usd: float  # translating it, as an estimate


class VideoAddedOut(BaseModel):
    id: int  # pending until translated and glossed


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    fetch_captions = ctx.fetch_captions
    kept: dict[tuple[str, Code], tuple[float, video.Captions]] = {}

    def language_of(code: Code) -> Code:
        if code not in LANGUAGES or code in HIDDEN_LANGUAGES:
            raise HTTPException(422, "Read & Listen has no texts in that language.")
        return code

    async def captions_for(body: VideoIn) -> video.Captions:
        if fetch_captions is None:
            raise HTTPException(503, "Videos aren't set up on this server.")
        language = language_of(body.language)
        found = video.video_id(body.link)
        if found is None:
            raise HTTPException(
                422, "That isn't a link to a YouTube video. Share or paste the video's link."
            )
        now = time.monotonic()
        held = kept.get((found, language))
        if held and now - held[0] < KEEP_SECONDS:
            return held[1]
        try:
            captions = await fetch_captions(found, language)
        except video.VideoRefused as e:
            raise HTTPException(422, str(e)) from e
        for key in [k for k, (at, _) in kept.items() if now - at >= KEEP_SECONDS]:
            del kept[key]
        while len(kept) >= KEEP_MOST:
            del kept[next(iter(kept))]
        kept[(found, language)] = (now, captions)
        return captions

    @routes.post("/api/videos/preview", dependencies=authed, response_model=VideoPreviewOut)
    async def preview(body: VideoIn) -> VideoPreviewOut:
        captions = await captions_for(body)
        try:
            found = engine.video_preview(body.language, captions)
        except video.VideoRefused as e:
            raise HTTPException(422, str(e)) from e
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return VideoPreviewOut(
            video_id=captions.video_id,
            title=found.title,
            channel=captions.channel,
            generated=captions.generated,
            seconds=found.seconds,
            coverage=found.coverage,
            words=found.words,
            new_words=list(found.new_words),
            new_count=found.new_count,
            lines=found.lines,
            cost_usd=found.cost_usd,
        )

    @routes.post("/api/videos", status_code=202, dependencies=authed, response_model=VideoAddedOut)
    async def add(body: VideoIn) -> VideoAddedOut:
        captions = await captions_for(body)
        try:
            text_id = engine.add_video(body.language, captions)
        except video.VideoRefused as e:
            raise HTTPException(422, str(e)) from e
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return VideoAddedOut(id=text_id)

    return routes
