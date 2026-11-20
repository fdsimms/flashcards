"""A voice saved per language (set_audio_voice), and add_notes recording a new Omnilanguage note with it."""

from __future__ import annotations

import json

import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error

pytestmark = pytest.mark.anyio

FIELDS = "Entry,Meaning,Context,ContextTranslation,Register,Language,PartOfSpeech,Audio"
VOICE = "th-TH-PremwadeeNeural"


def note(entry: str, language: str = "thai", **fields: str) -> dict:
    return {"deck": "Thai", "note_type": "Omnilanguage", "tags": ["italki"],
            "fields": {"Entry": entry, "Meaning": "x", "Context": f"<b>{entry}</b>", "ContextTranslation": "x",
                       "Register": "neutral", "Language": language, "PartOfSpeech": "noun", **fields}}


@pytest.fixture
def thai_deck(desktop):
    desktop.run("add-notetype", "Omnilanguage", FIELDS,
                "+", "add-fields-note", "Omnilanguage", "Thai",
                json.dumps({"Entry": "seed", "Meaning": "seed", "Language": "thai"}), "+", "sync")


async def add(client, *notes: dict, **args) -> list[dict]:
    return (await call(client, "add_notes", notes=list(notes), allow_nonstandard=True, **args))["results"]


async def audio_of(client, nid: int) -> str:
    return (await call(client, "get_notes", note_ids=[nid]))["notes"][0]["fields"]["Audio"]


async def test_without_a_saved_voice_a_new_note_gets_no_recording(client, azure, thai_deck):
    (result,) = await add(client, note("คนดู"))
    assert "audio" not in result and "audio_error" not in result
    assert azure.requests == []


async def test_a_saved_voice_records_new_notes_as_they_are_added(client, azure, thai_deck):
    saved = await call(client, "set_audio_voice", language=" Thai ", voice=VOICE, rate=0.9)
    assert saved["audio_voices"] == {"thai": {"voice": VOICE, "rate": 0.9}}
    assert (await call(client, "audio_voices"))["audio_voices"] == saved["audio_voices"]
    first, second = await add(client, note("คนดู"), note("เต็ม"))
    assert first["audio"].startswith("franki-tts-") and second["audio"] != first["audio"]
    assert await audio_of(client, first["note_id"]) == f"[sound:{first['audio']}]"
    assert "คนดู".encode() in azure.requests[0].content and "rate='-10%'" in azure.requests[0].content.decode()


async def test_only_the_notes_that_need_a_recording_get_one(client, azure, thai_deck):
    await call(client, "set_audio_voice", language="thai", voice=VOICE)
    has_audio, other_language = await add(client, note("เก่า", Audio="[sound:mine.mp3]"), note("Tisch", language="german"))
    assert "audio" not in has_audio and "audio" not in other_language
    assert await audio_of(client, has_audio["note_id"]) == "[sound:mine.mp3]"
    assert azure.requests == []
    (skipped,) = await add(client, note("ข้าม"), record_audio=False)
    assert "audio" not in skipped and azure.requests == []


async def test_a_failed_recording_leaves_the_note_added_and_says_why(client, azure, thai_deck):
    await call(client, "set_audio_voice", language="thai", voice=VOICE)
    azure.status = 401
    (result,) = await add(client, note("พัง"))
    assert result["note_id"] and "refused the key" in result["audio_error"] and "audio" not in result
    assert await audio_of(client, result["note_id"]) == ""


async def test_a_voice_can_be_checked_and_removed(client, thai_deck):
    assert "isn't an Azure voice" in await call_error(client, "set_audio_voice", language="thai", voice="Premwadee")
    assert "between 0.5 and 2.0" in await call_error(client, "set_audio_voice", language="thai", voice=VOICE, rate=3)
    assert "Say which language" in await call_error(client, "set_audio_voice", language=" ")
    await call(client, "set_audio_voice", language="thai", voice=VOICE)
    assert (await call(client, "set_audio_voice", language="thai"))["audio_voices"] == {}
