"""Audio lessons on a scene (lesson.py)."""

from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from franki_reader import (
    lesson,
    lesson_audio,
    lesson_service,
    lesson_topics,
    lesson_words,
    lesson_writer,
    store,
)
from franki_reader.languages import (
    LANGUAGES,
    Code,
)
from franki_reader.lesson_audio import LessonAudioFailed
from franki_reader.register import Register
from franki_reader.routes.context import NO_CLAUDE, AppContext
from franki_reader.routes.views import instant

# Audio lessons being made at once: each is a dozen calls to Azure, which rate-limits.
MAX_MAKING = 2


class GivenIn(BaseModel):
    text: str = Field(min_length=1, max_length=lesson.MAX_CHARS)
    english: str = Field(min_length=1, max_length=lesson.MAX_CHARS)


class LessonIn(BaseModel):
    language: Code
    scene: str = Field(min_length=1, max_length=lesson_writer.MAX_SCENE)
    # The narrator's voice for this lesson: an English Azure voice, or the settings' when left out.
    narrator: str | None = Field(default=None, max_length=100)
    # Thai only: the learner's polite particle, khrap (ครับ, a man's) or kha (ค่ะ, a woman's). It
    # decides the voice they repeat after, who speaks as A in the role-play, and the particle every
    # phrase carries. Left out, khrap; any other language ignores it.
    particle: Literal["khrap", "kha"] | None = None
    # How casual or formal the lesson sounds; the Settings default when left out.
    # Named `register_level` because a pydantic model has a `register` of its own (ABCMeta's).
    register_level: Register | None = Field(default=None, alias="register")
    # The learner's own words and phrases to teach, each with its meaning (a cram's, in the app),
    # rather than phrases Claude picks for the scene. The scene is then the situation they're for.
    phrases: list[GivenIn] | None = Field(default=None, max_length=lesson.MAX_GIVEN)


class MarkIn(BaseModel):
    text: str = Field(min_length=1, max_length=lesson.MAX_CHARS)
    english: str = Field(min_length=1, max_length=lesson.MAX_CHARS)
    # Again was tapped at its turn, or the learner took longer than the lesson's own pause.
    reason: Literal["again", "slow"]


class ReviewIn(BaseModel):
    language: Code
    narrator: str | None = Field(default=None, max_length=100)
    particle: Literal["khrap", "kha"] | None = None


class TopicsIn(BaseModel):
    language: Code
    # The learner's own words (as for a lesson), so the ideas are situations they'd come up in.
    phrases: list[GivenIn] | None = Field(default=None, max_length=lesson.MAX_GIVEN)
    # Ideas already on screen, so asking again gives different ones.
    shown: list[str] = Field(default_factory=list, max_length=lesson_topics.MAX_AVOID)


class WordIn(BaseModel):
    language: Code
    # What the learner typed: romanization, Thai script or English.
    text: str = Field(min_length=1, max_length=lesson.MAX_CHARS)


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    write_lesson = ctx.write_lesson
    write_given_lesson = ctx.write_given_lesson
    write_lesson_topics = ctx.write_lesson_topics
    lessons_dir = ctx.lessons_dir
    find_lesson_words = ctx.find_lesson_words
    keep_failed_cost = ctx.keep_failed_cost

    def lesson_out(row: store.StoredLesson) -> dict[str, Any]:
        return {
            "id": row.id,
            "language": row.language,
            "scene": row.scene,
            "title": row.title or row.scene,
            "state": row.state,
            "stage": row.stage,
            "error": row.error,
            "duration_ms": row.duration_ms,
            "created_at": instant(row.created_at),
            "phrases": row.plan.get("phrases", []),
            "dialogue": row.plan.get("dialogue", []),
            # Where the learner speaks, [start, end] in milliseconds, so the app can wait there;
            # null while not yet known (a lesson made before they were kept).
            "pauses": None if row.pauses is None else [list(p) for p in row.pauses],
            # What's said and the learner's turns with their times (lesson.script_of): entries;
            # null for a lesson made before it was kept, which has no transcript.
            "script": None if row.script is None else row.script.get("entries", []),
        }

    # Lessons made before their pauses were kept, being listened to now (find_old_pauses).
    finding: set[int] = set()

    async def find_pauses(lesson_id: int, folder: Path) -> None:
        try:
            await lesson_service.find_old_pauses(engine.conn, lesson_id, folder)
        finally:
            finding.discard(lesson_id)

    @routes.post("/api/lessons", status_code=202, dependencies=authed)
    async def make_lesson(body: LessonIn, background: BackgroundTasks) -> dict[str, Any]:
        """Reads the deck's snapshot to keep the dialogue to words the learner knows; never writes to
        Anki or grades a card."""
        if write_lesson is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "write a lesson"))
        if engine.synthesize is None:
            raise HTTPException(
                503,
                "Azure isn't set up on the server, so it can't speak a lesson"
                " (AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in server/.env turn this on).",
            )
        if lessons_dir is None:
            raise HTTPException(503, "The server has no folder to keep lessons in.")
        if body.language not in lesson_service.LESSON_LANGUAGES:
            raise HTTPException(
                422, f"Audio lessons aren't made in {LANGUAGES[body.language].name} yet."
            )
        scene = " ".join(body.scene.split())
        if not scene:
            raise HTTPException(422, "Say what the lesson is about.")
        narrator = (body.narrator or "").strip() or None
        if narrator is not None and not lesson_service.is_narrator_voice(narrator):
            raise HTTPException(
                422, "The narrator has to be an English voice, such as en-US-GuyNeural."
            )
        given = lesson.given_phrases([(p.text, p.english) for p in body.phrases or []])
        if body.phrases is not None and not given:
            raise HTTPException(422, "Give at least one word or phrase to teach, with its meaning.")
        if given and write_given_lesson is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "write a lesson"))
        if sum(1 for row in store.lessons(engine.conn) if row.state == "making") >= MAX_MAKING:
            raise HTTPException(
                409, "Two lessons are already being made. Wait for one to finish, then ask again."
            )
        lesson_id = store.add_lesson(engine.conn, body.language, scene, engine.clock())
        synthesize = engine.synthesize

        async def speak_bytes(text: str, voice: str, locale: str, rate: float) -> bytes:
            return (await synthesize(text, voice, locale, rate=rate)).audio

        background.add_task(
            lesson_service.make_lesson,
            engine.conn,
            lesson_id,
            body.language,
            scene,
            write=write_lesson,
            synthesize=speak_bytes,
            voices=engine.voices_for,
            lessons_dir=lessons_dir,
            now=engine.clock,
            narrator=narrator,
            lexicon=engine.snapshot(body.language)[1],
            learner="female" if body.language == "th" and body.particle == "kha" else "male",
            register=body.register_level or store.load_settings(engine.conn).register,
            given=given,
            write_given=write_given_lesson,
        )
        return {"id": lesson_id}

    @routes.post("/api/lessons/topics", dependencies=authed)
    async def lesson_topics_route(body: TopicsIn) -> dict[str, list[str]]:
        """Ideas for a lesson's scene. Never makes a lesson, and only reads which scenes exist."""
        if write_lesson_topics is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "suggest a topic"))
        if body.language not in lesson_service.LESSON_LANGUAGES:
            raise HTTPException(
                422, f"Audio lessons aren't made in {LANGUAGES[body.language].name} yet."
            )
        words = lesson_topics.words_of(
            lesson.given_phrases([(p.text, p.english) for p in body.phrases or []])
        )
        made = [row.scene for row in store.lessons(engine.conn, body.language)]
        avoid = tuple(
            " ".join(s.split())[: lesson_topics.MAX_IDEA * 2] for s in [*body.shown, *made]
        )[: lesson_topics.MAX_AVOID]
        try:
            raw, used = await write_lesson_topics(body.language, words, avoid)
        except lesson_topics.TopicsFailed as e:
            ctx.keep_failed_cost("lesson_topics", body.language, e.usage)
            raise HTTPException(503, str(e)) from e
        topics = lesson_topics.clean_topics(raw, avoid)
        store.save_call_cost(
            engine.conn, "lesson_topics", body.language, engine.clock(), used.cost_usd()
        )
        if not topics:
            raise HTTPException(503, "Claude had no new ideas. Try again.")
        return {"topics": topics}

    @routes.post("/api/lessons/words", dependencies=authed)
    async def lesson_words_route(body: WordIn) -> dict[str, Any]:
        """The words in the language what was typed could mean, for the learner to pick from; writes
        nothing."""
        if body.language not in lesson_service.LESSON_LANGUAGES:
            raise HTTPException(
                422, f"Audio lessons aren't made in {LANGUAGES[body.language].name} yet."
            )
        typed = " ".join(body.text.split())
        if not typed:
            raise HTTPException(422, "Type a word or phrase to look up.")
        if find_lesson_words is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "look up a word"))
        try:
            candidates, used = await find_lesson_words(body.language, typed)
        except lesson_words.LessonWordsFailed as e:
            keep_failed_cost("lesson_words", body.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "lesson_words", body.language, engine.clock(), used.cost_usd()
        )
        return {
            "candidates": [
                {"text": c.text, "reading": c.reading, "english": c.english} for c in candidates
            ]
        }

    @routes.get("/api/lessons", dependencies=authed)
    async def lessons_route(
        background: BackgroundTasks, language: Code | None = None
    ) -> dict[str, Any]:
        rows = store.lessons(engine.conn, language)
        if lessons_dir is not None:
            for row in rows:
                if row.state == "ready" and row.pauses is None and row.id not in finding:
                    finding.add(row.id)
                    background.add_task(find_pauses, row.id, lessons_dir)
        return {
            "languages": list(lesson_service.LESSON_LANGUAGES),
            "lessons": [lesson_out(row) for row in rows],
            "review": review_out(language) if language else None,
        }

    def review_out(language: Code) -> dict[str, Any] | None:
        """The review on offer: the marked phrases waiting, and the lessons they're from."""
        marks = store.open_lesson_marks(engine.conn, language)
        if len(marks) < lesson.REVIEW_MIN:
            return None
        counts: dict[int, tuple[str, int]] = {}
        for mark in marks[: lesson.REVIEW_MAX]:
            title, n = counts.get(mark.lesson_id, (mark.title, 0))
            counts[mark.lesson_id] = (title, n + 1)
        return {
            "phrases": min(len(marks), lesson.REVIEW_MAX),
            "lessons": [{"title": t, "count": n} for t, n in counts.values()],
        }

    @routes.post("/api/lessons/{lesson_id}/marks", status_code=204, dependencies=authed)
    async def mark_route(lesson_id: int, body: MarkIn) -> Response:
        """Notes a phrase for a review. Never grades a card: a review is a lesson, nothing more."""
        if not store.add_lesson_mark(
            engine.conn, lesson_id, body.text, body.english, body.reason, engine.clock()
        ):
            raise HTTPException(404, "No such lesson.")
        return Response(status_code=204)

    @routes.post("/api/lessons/review", status_code=202, dependencies=authed)
    async def make_review_route(body: ReviewIn, background: BackgroundTasks) -> dict[str, Any]:
        if engine.synthesize is None:
            raise HTTPException(
                503,
                "Azure isn't set up on the server, so it can't speak a lesson"
                " (AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in server/.env turn this on).",
            )
        if lessons_dir is None:
            raise HTTPException(503, "The server has no folder to keep lessons in.")
        narrator = (body.narrator or "").strip() or None
        if narrator is not None and not lesson_service.is_narrator_voice(narrator):
            raise HTTPException(
                422, "The narrator has to be an English voice, such as en-US-GuyNeural."
            )
        if len(store.open_lesson_marks(engine.conn, body.language)) < lesson.REVIEW_MIN:
            raise HTTPException(
                409,
                f"A review needs at least {lesson.REVIEW_MIN} phrases you asked to hear again or"
                " answered slowly. Play a lesson with Wait for my answer on to collect them.",
            )
        if sum(1 for row in store.lessons(engine.conn) if row.state == "making") >= MAX_MAKING:
            raise HTTPException(
                409, "Two lessons are already being made. Wait for one to finish, then ask again."
            )
        review_id = store.add_lesson(
            engine.conn, body.language, lesson.REVIEW_TITLE, engine.clock()
        )
        taken = store.take_lesson_marks(engine.conn, body.language, review_id, lesson.REVIEW_MAX)
        phrases = tuple(lesson.Phrase(m.text, m.english, (m.text,)) for m in taken)
        synthesize = engine.synthesize

        async def speak_bytes(text: str, voice: str, locale: str, rate: float) -> bytes:
            return (await synthesize(text, voice, locale, rate=rate)).audio

        background.add_task(
            lesson_service.make_review,
            engine.conn,
            review_id,
            body.language,
            phrases,
            synthesize=speak_bytes,
            voices=engine.voices_for,
            lessons_dir=lessons_dir,
            now=engine.clock,
            narrator=narrator,
            learner="female" if body.language == "th" and body.particle == "kha" else "male",
        )
        return {"id": review_id}

    @routes.get("/api/lessons/{lesson_id}/phrases/{index}/audio", dependencies=authed)
    async def phrase_audio_route(lesson_id: int, index: int) -> Response:
        """A phrase of the lesson as it's said at normal speed, cut from the lesson's MP3, for a
        card's Audio field."""
        row = store.get_lesson(engine.conn, lesson_id)
        path = lesson_service.audio_path(lessons_dir, lesson_id) if lessons_dir else None
        clips = (row.script or {}).get("phrase_clips", []) if row else []
        clip = clips[index] if 0 <= index < len(clips) else None
        if row is None or path is None or not path.is_file() or not clip:
            raise HTTPException(404, "That phrase has no recording in the lesson.")
        try:
            audio = await lesson_audio.cut(path.read_bytes(), clip[0], clip[1])
        except LessonAudioFailed as e:
            raise HTTPException(503, str(e)) from e
        return Response(audio, media_type="audio/mpeg")

    @routes.get("/api/lessons/{lesson_id}/audio", dependencies=authed)
    async def lesson_audio_route(lesson_id: int) -> FileResponse:
        row = store.get_lesson(engine.conn, lesson_id)
        path = lesson_service.audio_path(lessons_dir, lesson_id) if lessons_dir else None
        if row is None or row.state != "ready" or path is None or not path.is_file():
            raise HTTPException(404, "That lesson has no audio yet.")
        return FileResponse(path, media_type="audio/mpeg")

    @routes.delete("/api/lessons/{lesson_id}", status_code=204, dependencies=authed)
    async def delete_lesson_route(lesson_id: int) -> Response:
        if not store.delete_lesson(engine.conn, lesson_id):
            raise HTTPException(404, "No such lesson.")
        if lessons_dir is not None:
            lesson_service.audio_path(lessons_dir, lesson_id).unlink(missing_ok=True)
        return Response(status_code=204)

    return routes
