"""Podcasts (podcast.py): finding a show, its episodes, and adding one with a transcript as a text."""

import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException
from franki_speech.transcribe import TranscribeFailed
from franki_speech.transcribe import cost_usd as transcribe_cost
from pydantic import BaseModel, Field

from franki_reader import podcast, podcast_store, store
from franki_reader.engine import NotAvailable
from franki_reader.languages import HIDDEN_LANGUAGES, LANGUAGES, Code, speech_locale
from franki_reader.routes.context import AppContext
from franki_reader.routes.views import instant
from franki_reader.video import Cue

log = logging.getLogger(__name__)

# The longest episode added at once, in seconds of transcript: a long interview.
MAX_SECONDS = 2 * 60 * 60


class ShowOut(BaseModel):
    title: str
    author: str
    feed: str
    artwork: str
    # How many of its latest episodes have a transcript: "most", "some", "none", or null unread.
    transcripts: str | None = None


class SearchOut(BaseModel):
    shows: list[ShowOut]


class LinkIn(BaseModel):
    # A feed's address or an Apple Podcasts link (a show's, or an episode's with ?i=).
    link: str = Field(min_length=1, max_length=1000)


class EpisodeOut(BaseModel):
    guid: str
    title: str
    published: str | None
    seconds: int | None
    # A transcript to read along with: the show's own, or one Azure made (`transcribed`).
    transcript: bool
    transcribed: bool = False
    # About what transcribing it would cost; null when it has a transcript, its length isn't
    # known, or Azure isn't set up.
    transcribe_usd: float | None = None


class TranscriptStateOut(BaseModel):
    # "ready" (made and kept), "transcribing", "failed" with `error`, or "none" (never asked for).
    state: str
    error: str | None = None


class EpisodesOut(BaseModel):
    show: ShowOut
    episodes: list[EpisodeOut]
    # The episode the link named, when it named one that's in the feed.
    picked: str | None


class EpisodeIn(BaseModel):
    language: Code
    feed: str = Field(min_length=1, max_length=1000)
    guid: str = Field(min_length=1, max_length=1000)


class PodcastPreviewOut(BaseModel):
    """What adding an episode would give, before it's added."""

    title: str
    show: str
    artwork: str
    seconds: int
    coverage: float
    words: int
    new_words: list[str]
    new_count: int
    lines: int
    cost_usd: float  # translating it, as an estimate


class PodcastAddedOut(BaseModel):
    id: int  # pending until translated and glossed


def _published(at: datetime | None) -> str | None:
    return instant(at) if at else None


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    podcasts = ctx.podcasts
    transcribe = ctx.transcribe
    # Episodes being transcribed, and why one last failed, by (feed, guid).
    transcribing: set[tuple[str, str]] = set()
    failed: dict[tuple[str, str], str] = {}
    tasks: set[asyncio.Task[None]] = set()

    def ready() -> podcast.Podcasts:
        if podcasts is None:
            raise HTTPException(503, "Podcasts aren't set up on this server.")
        return podcasts

    def language_of(code: Code) -> Code:
        if code not in LANGUAGES or code in HIDDEN_LANGUAGES:
            raise HTTPException(422, "Read & Listen has no texts in that language.")
        return code

    def show_of(feed: podcast.Feed) -> ShowOut:
        return ShowOut(title=feed.title, author=feed.author, feed=feed.url, artwork=feed.artwork)

    async def episode_of(
        body: EpisodeIn,
    ) -> tuple[podcast.Feed, podcast.Episode, list[Cue]]:
        source = ready()
        try:
            feed = await source.feed(podcast.public_url(body.feed))
            episode = feed.episode(body.guid)
            if episode is None:
                raise podcast.PodcastRefused("That episode isn't in the show's feed any more.")
            kept = podcast_store.transcript(engine.conn, feed.url, episode.guid)
            if kept is not None:
                cues = kept
            elif episode.transcript is None:
                raise podcast.PodcastRefused(
                    "This episode has no transcript, so there's nothing to read along with."
                    " Transcribe it first."
                )
            else:
                cues = await source.cues(episode.transcript)
        except podcast.PodcastRefused as e:
            raise HTTPException(422, str(e)) from e
        seconds = round(cues[-1].end_ms / 1000)
        if seconds > MAX_SECONDS:
            raise HTTPException(
                422,
                f"This episode is {seconds // 60} minutes long, and episodes up to {MAX_SECONDS // 60}"
                " minutes can be added. Try a shorter one.",
            )
        return feed, episode, cues

    @routes.get("/api/podcasts/search", dependencies=authed, response_model=SearchOut)
    async def search(language: Code, term: str) -> SearchOut:
        """Shows matching `term` in Apple's podcast directory, in the language's storefront."""
        if not term.strip():
            return SearchOut(shows=[])
        try:
            found = await ready().search(term.strip()[:100], language_of(language))
        except podcast.PodcastRefused as e:
            raise HTTPException(422, str(e)) from e
        return SearchOut(shows=[ShowOut(**s.__dict__) for s in found])

    @routes.post("/api/podcasts/episodes", dependencies=authed, response_model=EpisodesOut)
    async def episodes(body: LinkIn) -> EpisodesOut:
        """A show's episodes, newest first, from a feed's link or an Apple Podcasts link."""
        try:
            feed, picked = await ready().from_link(body.link)
        except podcast.PodcastRefused as e:
            raise HTTPException(422, str(e)) from e
        made = podcast_store.transcribed(engine.conn, feed.url)
        return EpisodesOut(
            show=show_of(feed),
            episodes=[
                EpisodeOut(
                    guid=e.guid,
                    title=e.title,
                    published=_published(e.published),
                    seconds=e.seconds,
                    transcript=e.transcript is not None or e.guid in made,
                    transcribed=e.guid in made,
                    transcribe_usd=(
                        transcribe_cost(e.seconds)
                        if transcribe is not None
                        and e.transcript is None
                        and e.guid not in made
                        and e.seconds
                        and e.seconds <= MAX_SECONDS
                        else None
                    ),
                )
                for e in feed.episodes
            ],
            picked=picked,
        )

    async def make_transcript(language: Code, feed: podcast.Feed, episode: podcast.Episode) -> None:
        assert transcribe is not None
        key = (feed.url, episode.guid)
        locale = speech_locale(language) or language
        try:
            found = await transcribe(episode.audio, locale)
            cues = podcast.cues_of(found)
            if not cues:
                raise TranscribeFailed("Azure heard no words in this episode in that language.")
            cost = transcribe_cost(found.duration_ms / 1000)
            podcast_store.keep_transcript(
                engine.conn, feed.url, episode.guid, cues, cost, engine.clock()
            )
            store.save_call_cost(engine.conn, "transcribe", language, engine.clock(), cost)
            failed.pop(key, None)
        except TranscribeFailed as e:
            failed[key] = str(e)
        except Exception:
            log.exception("Transcribing %s failed", episode.audio)
            failed[key] = "Couldn't transcribe the episode. Try again."
        finally:
            transcribing.discard(key)

    @routes.post(
        "/api/podcasts/transcribe",
        status_code=202,
        dependencies=authed,
        response_model=TranscriptStateOut,
    )
    async def start_transcribe(body: EpisodeIn) -> TranscriptStateOut:
        """Has Azure transcribe an episode with no transcript, in the background; ask
        /api/podcasts/transcript until it's ready. Its cost is kept in `call_costs` ("transcribe")."""
        if transcribe is None:
            raise HTTPException(
                503,
                "Azure isn't set up on the server, so it can't transcribe an episode"
                " (AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in server/.env turn this on).",
            )
        language = language_of(body.language)
        try:
            feed = await ready().feed(podcast.public_url(body.feed))
        except podcast.PodcastRefused as e:
            raise HTTPException(422, str(e)) from e
        episode = feed.episode(body.guid)
        if episode is None:
            raise HTTPException(422, "That episode isn't in the show's feed any more.")
        if episode.seconds and episode.seconds > MAX_SECONDS:
            raise HTTPException(
                422,
                f"Episodes up to {MAX_SECONDS // 60} minutes can be transcribed. Try a shorter one.",
            )
        key = (feed.url, episode.guid)
        if podcast_store.transcript(engine.conn, *key) is not None:
            return TranscriptStateOut(state="ready")
        if key not in transcribing:
            transcribing.add(key)
            failed.pop(key, None)
            task = asyncio.create_task(make_transcript(language, feed, episode))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
        return TranscriptStateOut(state="transcribing")

    @routes.get("/api/podcasts/transcript", dependencies=authed, response_model=TranscriptStateOut)
    async def transcript_state(feed: str, guid: str) -> TranscriptStateOut:
        key = (feed, guid)
        if podcast_store.transcript(engine.conn, feed, guid) is not None:
            return TranscriptStateOut(state="ready")
        if key in transcribing:
            return TranscriptStateOut(state="transcribing")
        if key in failed:
            return TranscriptStateOut(state="failed", error=failed[key])
        return TranscriptStateOut(state="none")

    @routes.post("/api/podcasts/preview", dependencies=authed, response_model=PodcastPreviewOut)
    async def preview(body: EpisodeIn) -> PodcastPreviewOut:
        feed, episode, cues = await episode_of(body)
        try:
            found = engine.timed_preview(
                language_of(body.language), episode.title, cues, round(cues[-1].end_ms / 1000)
            )
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return PodcastPreviewOut(
            title=found.title,
            show=feed.title,
            artwork=feed.artwork,
            seconds=found.seconds,
            coverage=found.coverage,
            words=found.words,
            new_words=list(found.new_words),
            new_count=found.new_count,
            lines=found.lines,
            cost_usd=found.cost_usd,
        )

    @routes.post(
        "/api/podcasts", status_code=202, dependencies=authed, response_model=PodcastAddedOut
    )
    async def add(body: EpisodeIn) -> PodcastAddedOut:
        feed, episode, cues = await episode_of(body)
        try:
            text_id = engine.add_podcast(language_of(body.language), feed, episode, cues)
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return PodcastAddedOut(id=text_id)

    return routes
