"""A text's line as it was said, as MP3 of its own: for a card that keeps the line a word was heard
in (its SourceAudio), and for shadowing a podcast's line (docs/read-and-listen/architecture.md,
"The speaker's voice")."""

import asyncio

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse
from franki_speech.loudness import LoudnessError, normalize_loudness

from franki_reader import podcast_store, store, video_store
from franki_reader.podcast import PodcastRefused
from franki_reader.routes.context import AppContext


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    engine = ctx.engine
    clip_episode = ctx.clip_episode
    folder = ctx.clips_dir

    @routes.get(
        "/api/texts/{text_id}/lines/{line}/clip", dependencies=ctx.authed, response_model=None
    )
    async def line_clip(text_id: int, line: int) -> Response | FileResponse:
        """A podcast's line is cut from the episode, leveled, and kept on disk after the first
        time. A line of a text Read & Listen wrote is its own recording. A video's line has none:
        YouTube's player doesn't let its sound be taken."""
        text = store.get_text(engine.conn, text_id)
        if text is None:
            raise HTTPException(404, "No such text.")
        if not 0 <= line < len(text.lines):
            raise HTTPException(404, "No such line.")
        episode = podcast_store.of(engine.conn, text_id)
        if episode is not None:
            if clip_episode is None or folder is None:
                raise HTTPException(503, "This server can't cut lines from an episode.")
            if line >= len(episode.times):
                raise HTTPException(404, "No such line.")
            path = folder / f"{text_id}-{line}.mp3"
            if not path.exists():
                start, end = episode.times[line]
                try:
                    cut = await clip_episode(episode.audio, start, end)
                    audio = await normalize_loudness(cut, sample_rate=44100)
                except PodcastRefused as e:
                    raise HTTPException(503, str(e)) from e
                except LoudnessError as e:
                    raise HTTPException(503, f"Couldn't prepare the line's clip. {e}") from e
                folder.mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(path.write_bytes, audio)
            return Response(await asyncio.to_thread(path.read_bytes), media_type="audio/mpeg")
        if video_store.of(engine.conn, text_id) is not None:
            raise HTTPException(
                404, "A video's line has no clip: YouTube's player doesn't let its sound be taken."
            )
        recorded = await engine.line_audio(text, line)
        if recorded is None:
            raise HTTPException(404, "No audio for this line.")
        return FileResponse(recorded, media_type="audio/mpeg")

    return routes
