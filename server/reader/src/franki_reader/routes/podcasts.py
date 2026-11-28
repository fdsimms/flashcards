"""Podcasts (podcast.py): finding a show, its episodes, and adding one with a transcript as a text."""

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from franki_reader import podcast
from franki_reader.engine import NotAvailable
from franki_reader.languages import HIDDEN_LANGUAGES, LANGUAGES, Code
from franki_reader.routes.context import AppContext
from franki_reader.routes.views import instant
from franki_reader.video import Cue

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
    transcript: bool


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
            if episode.transcript is None:
                raise podcast.PodcastRefused(
                    "This episode has no transcript, so there's nothing to read along with."
                )
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
        return EpisodesOut(
            show=show_of(feed),
            episodes=[
                EpisodeOut(
                    guid=e.guid,
                    title=e.title,
                    published=_published(e.published),
                    seconds=e.seconds,
                    transcript=e.transcript is not None,
                )
                for e in feed.episodes
            ],
            picked=picked,
        )

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
