"""Read & Listen's settings: what a text is written from and how it's read aloud."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from franki_speech import SpeechError
from pydantic import BaseModel, Field

from franki_reader import (
    cast,
    read_plan,
    store,
)
from franki_reader.generator import Form
from franki_reader.languages import (
    HIDDEN_LANGUAGES,
    LANGUAGES,
    Code,
    CommonCount,
    VoiceSlot,
    with_deck,
)
from franki_reader.routes.context import AppContext
from franki_reader.routes.voice_check import check_voice
from franki_reader.store import Length, Settings, StretchWords
from franki_reader.tts import Speech

CastType = Literal["man", "woman", "boy", "girl", "elder_man", "elder_woman"]


class CastChoice(BaseModel):
    """The voice and pitch (a percent change) for one kind of story character."""

    voice: str = Field(min_length=1, max_length=100)
    pitch: int = Field(ge=cast.PITCH_RANGE[0], le=cast.PITCH_RANGE[1])


class SettingsUpdate(BaseModel):
    stretch_words: StretchWords | None = None
    lines: Length | None = None
    form: Form | None = None
    language: Code | None = None
    # A language's deck by its full Anki name; an empty name goes back to the default.
    decks: dict[Code, Annotated[str, Field(max_length=500)]] | None = None
    # How many of a language's most common words count as known. Not Thai's: only its deck counts.
    common: dict[Code, CommonCount] | None = None
    # How each language is handled by the daily reading tasks (read_plan.py).
    daily_tasks: dict[Code, read_plan.Mode] | None = None
    # How many rotating languages get a task a day.
    daily_rotate_count: int | None = Field(default=None, ge=1, le=10)
    # An Azure voice for each of a language's voice slots; an empty name goes back to the default.
    voices: dict[Code, dict[VoiceSlot, Annotated[str, Field(max_length=100)]]] | None = None
    # A voice and pitch for each kind of story character (cast.py); null goes back to the default.
    cast: dict[Code, dict[CastType, CastChoice | None]] | None = None


async def _check_voice_gender(speech: Speech | None, name: str, slot: VoiceSlot) -> None:
    """Refuses a voice of the other gender than its slot's, where Azure's list says what it is."""
    if speech is None:
        return
    want = "male" if slot.startswith("male") else "female"
    try:
        found = await speech.voices()
    except SpeechError:
        return  # can't tell, and the voice's language was already checked
    for v in found:
        if v.get("voice") == name:
            have = str(v.get("gender") or "").lower()
            if have in ("male", "female") and have != want:
                raise HTTPException(
                    400,
                    f"{v.get('name') or name} is a {have} voice. Choose a {want} voice for this one.",
                )
            return


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    speech = ctx.speech

    def settings_out(current: Settings) -> dict[str, Any]:
        # Every language's deck and voices, the default where none was chosen, so the app shows
        # what's used.
        decks = {code: with_deck(code, current.decks.get(code)).deck for code in LANGUAGES}
        common = {
            code: current.common_for(code) for code, info in LANGUAGES.items() if info.counts_common
        }
        voices = {code: engine.voices_for(code) for code in LANGUAGES}
        # What each kind of story character is given, the default where none was chosen.
        story_cast = {
            code: {
                kind: {"voice": p.voice, "pitch": p.pitch}
                for kind, p in cast.presets(voices[code], current.cast.get(code, {})).items()
            }
            for code in LANGUAGES
        }
        return {
            **current.__dict__,
            "decks": decks,
            "voices": voices,
            "common": common,
            "cast": story_cast,
            # Every language's mode, the default where none was chosen.
            "daily_tasks": {
                code: current.daily_tasks.get(code, read_plan.DEFAULT_MODE)
                for code in LANGUAGES
                if code not in HIDDEN_LANGUAGES
            },
        }

    @routes.get("/api/settings", dependencies=authed)
    async def settings() -> dict[str, Any]:
        return settings_out(store.load_settings(engine.conn))

    @routes.patch("/api/settings", dependencies=authed)
    async def update_settings(body: SettingsUpdate, background: BackgroundTasks) -> dict[str, Any]:
        if body.common and any(not LANGUAGES[code].counts_common for code in body.common):
            raise HTTPException(422, "Thai counts only the words in its deck.")
        # Every voice is checked first: the gender check can wait seconds on Azure's voice list, and
        # settings read before it would be saved over a change another request made meanwhile.
        for code, chosen in (body.voices or {}).items():
            for speaker, name in chosen.items():
                if name.strip():
                    check_voice(name.strip(), code)
                    await _check_voice_gender(speech, name.strip(), speaker)
        for code, chosen_for in (body.cast or {}).items():
            for kind, choice in chosen_for.items():
                if choice is not None:
                    check_voice(choice.voice, code)
                    await _check_voice_gender(speech, choice.voice, cast.CAST_TYPES[kind][0])
        current = store.load_settings(engine.conn)
        common = dict(current.common)
        for code, count in (body.common or {}).items():
            if count == LANGUAGES[code].common:
                common.pop(code, None)
            else:
                common[code] = count
        daily_tasks: dict[str, str] = dict(current.daily_tasks)
        daily_tasks.update({str(code): mode for code, mode in (body.daily_tasks or {}).items()})
        decks = dict(current.decks)
        changed_decks: list[Code] = []
        for code, name in (body.decks or {}).items():
            name = name.strip()
            before = with_deck(code, decks.get(code)).deck
            if name and name != LANGUAGES[code].deck:
                decks[code] = name
            else:
                decks.pop(code, None)
            if with_deck(code, decks.get(code)).deck != before:
                changed_decks.append(code)
        voices = {code: dict(v) for code, v in current.voices.items()}
        voices_before = {code: engine.voices_for(code) for code in body.voices or {}}
        for code, chosen in (body.voices or {}).items():
            mine = voices.setdefault(code, {})
            for speaker, name in chosen.items():
                name = name.strip()
                if name:
                    mine[speaker] = name
                else:
                    mine.pop(speaker, None)
            if not mine:
                voices.pop(code)
        story_cast = {code: dict(v) for code, v in current.cast.items()}
        for code, chosen_for in (body.cast or {}).items():
            mine_cast = story_cast.setdefault(code, {})
            for kind, choice in chosen_for.items():
                if choice is None:
                    mine_cast.pop(kind, None)
                    continue
                mine_cast[kind] = {"voice": choice.voice, "pitch": choice.pitch}
            if not mine_cast:
                story_cast.pop(code)
        updated = Settings(
            stretch_words=body.stretch_words or current.stretch_words,
            lines=body.lines or current.lines,
            form=body.form or current.form,
            language=body.language or current.language,
            decks=decks,
            voices=voices,
            cast=story_cast,
            common=common,
            daily_tasks=daily_tasks,
            daily_rotate_count=body.daily_rotate_count or current.daily_rotate_count,
        )
        store.save_settings(engine.conn, updated)
        for code in changed_decks:
            # The old deck's words mustn't be written with: read the new deck now.
            store.clear_snapshot(engine.conn, code)
            background.add_task(engine.refresh_lexicon, code)
        for code, then in voices_before.items():
            if engine.voices_for(code) != then:
                # The texts waiting to be read get the new voices too.
                background.add_task(engine.rerecord, code)
        return settings_out(updated)

    return routes
