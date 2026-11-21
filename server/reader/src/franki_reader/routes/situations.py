"""Situations: a conversation with Claude in a scene (situations.py)."""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from franki_reader import (
    situations,
    store,
)
from franki_reader.languages import (
    LANGUAGES,
    Code,
)
from franki_reader.reader import render_sentence
from franki_reader.register import Register
from franki_reader.routes.context import NO_CLAUDE, AppContext
from franki_reader.suggestions import suggest
from franki_reader.tts import (
    SLOW_RATE,
    ClipCache,
    TtsFailed,
    billed_chars,
)


class SituationRoles(BaseModel):
    you: str = Field(min_length=1, max_length=80)
    them: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    gender: Literal["male", "female"]


class SituationLine(BaseModel):
    speaker: situations.Speaker
    text: str = Field(min_length=1, max_length=situations.MAX_LINE)


class SituationFocus(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    lead: str = Field(default="", max_length=160)


class SituationIn(BaseModel):
    language: Code
    scene: str = Field(min_length=1, max_length=200)
    focus: SituationFocus | None = None
    # Words from a cram being rehearsed, each "word (meaning)", for the other person to work in.
    words: list[str] = Field(default_factory=list, max_length=situations.MAX_REHEARSAL_WORDS)
    roles: SituationRoles | None = None
    lines: list[SituationLine] = Field(default_factory=list, max_length=situations.MAX_LINES)
    # Whether to record their next line with Azure. The app turns it off when it reads their lines
    # with the phone's own voices (Settings, Read & Listen), so nothing is recorded or billed.
    speak: bool = True
    # How casual or formal the other person's lines are; the Settings default when left out.
    # Named `register_level` because a pydantic model has a `register` of its own (ABCMeta's).
    register_level: Register | None = Field(default=None, alias="register")

    def conversation(self, default: Register) -> situations.Conversation:
        roles = situations.Roles(**self.roles.model_dump()) if self.roles else None
        lines = tuple(situations.Line(ln.speaker, " ".join(ln.text.split())) for ln in self.lines)
        focus = (
            situations.Focus(" ".join(self.focus.title.split()), " ".join(self.focus.lead.split()))
            if self.focus and self.focus.title.strip()
            else None
        )
        words = tuple(
            w
            for w in (" ".join(w.split())[: situations.MAX_REHEARSAL_WORD] for w in self.words)
            if w
        )
        return situations.Conversation(
            self.language,
            self.scene.strip(),
            roles,
            lines,
            focus,
            words,
            self.register_level or default,
        )


class SlowClipIn(BaseModel):
    language: Code
    gender: Literal["male", "female"]
    line: str = Field(min_length=1, max_length=situations.MAX_LINE)


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    play = ctx.play
    give_feedback = ctx.give_feedback
    clips = ctx.clips
    keep_failed_cost = ctx.keep_failed_cost

    @routes.get("/api/situations/scenes", dependencies=authed)
    async def situation_scenes(language: Code) -> list[str]:
        _, lexicon = engine.snapshot(language)
        return [s.name for s in suggest(lexicon, set(), language)]

    async def speak_clip(
        language: Code, gender: str, line: str, slow: bool = False
    ) -> tuple[str | None, int]:
        """One of their lines spoken in the voice for their gender: the clip's key (None when
        there's no text to speech or Azure failed) and the characters Azure billed for it. The slow
        clip (`tts.SLOW_RATE`) is its own, under its own key."""
        if clips is None or engine.synthesize is None:
            return None, 0
        voice = engine.voices_for(language)["female" if gender == "female" else "male"]
        key = ClipCache.key(line, f"{voice}@slow{SLOW_RATE}" if slow else voice)
        if clips.path(key) is not None:
            return key, 0
        locale = LANGUAGES[language].locale
        try:
            spoken = await (
                engine.synthesize(line, voice, locale, rate=SLOW_RATE)
                if slow
                else engine.synthesize(line, voice, locale)
            )
        except TtsFailed:
            return None, 0
        clips.write(key, spoken.audio, engine.clock())
        return key, billed_chars(line)

    @routes.post("/api/situations/turn", dependencies=authed)
    async def situation_turn(body: SituationIn) -> dict[str, Any]:
        """Never writes to Anki or grades a card: it only reads the snapshot of the deck."""
        if play is None:
            raise HTTPException(503, NO_CLAUDE.replace("check your writing", "play a situation"))
        conversation = body.conversation(store.load_settings(engine.conn).register)
        if conversation.lines and conversation.roles is None:
            raise HTTPException(422, "A conversation under way needs its `roles`.")
        if conversation.lines and conversation.lines[-1].speaker != "you":
            raise HTTPException(422, "It's the learner's turn: the last line should be theirs.")
        language = body.language
        # Words due today and not yet reviewed count as unknown, as when a text is written.
        entries, writing = engine.writing_lexicon(language)
        try:
            line, unknown, used = await situations.next_line(play, entries, conversation, writing)
        except situations.SituationFailed as e:
            keep_failed_cost("situations", language, e.usage)
            raise HTTPException(503, str(e)) from e
        roles = line.get("roles") or (body.roles.model_dump() if body.roles else None)
        audio, chars = (
            await speak_clip(language, roles["gender"] if roles else "male", line["line"])
            if body.speak
            else (None, 0)
        )
        store.save_call_cost(
            engine.conn, "situations", language, engine.clock(), used.cost_usd(), chars
        )
        snapshot, lexicon = engine.snapshot(language)
        translits = {e.text: e.translit for e in snapshot if e.translit}
        meanings = {**engine.meanings(language), **line["glosses"]}
        out: dict[str, Any] = {
            "line": line["line"],
            "english": line["english"],
            "words": render_sentence(
                line["line"], lexicon, meanings, translits, engine.ai_ipa(language)
            ),
            "unknown": unknown,
            "done": line["done"],
            "audio": audio,
        }
        if "roles" in line:
            out["roles"] = line["roles"]
        return out

    @routes.post("/api/situations/feedback", dependencies=authed)
    async def situation_feedback(body: SituationIn) -> dict[str, Any]:
        if give_feedback is None:
            raise HTTPException(503, NO_CLAUDE)
        conversation = body.conversation(store.load_settings(engine.conn).register)
        if not any(ln.speaker == "you" for ln in conversation.lines):
            raise HTTPException(422, "There are no lines of yours to check yet.")
        try:
            answer, used = await give_feedback(conversation)
        except situations.SituationFailed as e:
            keep_failed_cost("situations", body.language, e.usage)
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "situations", body.language, engine.clock(), used.cost_usd()
        )
        _, lexicon = engine.snapshot(body.language)
        return situations.clean_feedback(answer, conversation, lexicon)

    @routes.post("/api/situations/slow", dependencies=authed)
    async def situation_slow(body: SlowClipIn) -> dict[str, str | None]:
        """One of their lines again, spoken slowly by Azure: the clip's key for
        `/api/situations/audio/{key}`, or None when it couldn't be recorded. Made the first time it's
        asked for and kept like any clip."""
        key, chars = await speak_clip(body.language, body.gender, body.line, slow=True)
        if chars:
            store.save_call_cost(
                engine.conn, "situations", body.language, engine.clock(), 0.0, chars
            )
        return {"audio": key}

    @routes.get("/api/situations/audio/{key}", dependencies=authed)
    async def situation_audio(key: str) -> FileResponse:
        path = clips.path(key) if clips is not None else None
        if path is None:
            raise HTTPException(404, "No such clip.")
        return FileResponse(path, media_type="audio/mpeg")

    return routes
