"""Audio from Azure (faked here): what's read, where it goes, and that it reaches another device."""

from __future__ import annotations

import pytest

from conftest import call, call_error
from franki_mcp.speech import ssml

pytestmark = pytest.mark.anyio

WATER = 1794408858015  # Basic (and reversed card): Front "<b>น้ำ</b>"
BOOK = 1794408858013   # Front "หนังสือ"
VOICE = "th-TH-PremwadeeNeural"


def test_ssml_escapes_text_and_sets_language_and_speed():
    out = ssml("a < b & c", VOICE, 0.8)
    assert "xml:lang='th-TH'" in out and "<prosody rate='-20%'>a &lt; b &amp; c</prosody>" in out


async def test_lists_voices_for_a_language(client):
    assert [v["voice"] for v in (await call(client, "list_voices", locale="th"))["voices"]] == [VOICE]


async def test_previews_the_text_without_recording(client, azure):
    out = await call(client, "add_tts_audio", note_ids=[WATER, BOOK], source_fields=["Front"], target_field="Back",
                     voice=VOICE, preview=True, replacements=[{"find": "หนัง", "replace": "หนั่ง"}])
    assert [p["text"] for p in out["preview"]] == ["น้ำ", "หนั่งสือ"]
    assert azure.requests == []


async def test_records_into_the_field_and_reaches_another_device(client, cm, azure, desktop):
    out = await call(client, "add_tts_audio", note_ids=[WATER], source_fields=["Front"], target_field="Back",
                     voice=VOICE, text_overrides={str(WATER): "น้ำเปล่า"})
    assert out["added"] == 1
    name = out["results"][0]["audio"]
    assert b"\xe0\xb8\x99\xe0\xb9\x89\xe0\xb8\xb3\xe0\xb9\x80" in azure.requests[0].content  # น้ำเ, the override
    back = (await call(client, "get_notes", note_ids=[WATER]))["notes"][0]["fields"]["Back"]
    assert back.endswith(f"[sound:{name}]") and back != f"[sound:{name}]"  # the meaning stays
    # Again without overwrite: skipped. With it: the old sound is replaced, not added to.
    again = await call(client, "add_tts_audio", note_ids=[WATER], source_fields=["Front"], target_field="Back", voice=VOICE)
    assert "already has audio" in again["results"][0]["error"]
    await call(client, "add_tts_audio", note_ids=[WATER], source_fields=["Front"], target_field="Back", voice=VOICE, overwrite=True)
    back = (await call(client, "get_notes", note_ids=[WATER]))["notes"][0]["fields"]["Back"]
    assert back.count("[sound:") == 1
    cm.wait_for_media()
    desktop.run("sync", "+", "media-sync")
    sound = back.split("[sound:")[1].rstrip("]")
    assert (desktop.path.parent / "collection.media" / sound).read_bytes().startswith(b"MP3:")


async def test_says_what_went_wrong(client, azure):
    assert "Up to 10" in await call_error(client, "add_tts_audio", note_ids=list(range(11)), source_fields=["Front"], target_field="Back", voice=VOICE)
    assert "isn't an Azure voice" in await call_error(client, "add_tts_audio", note_ids=[WATER], source_fields=["Front"], target_field="Back", voice="Premwadee")
    out = await call(client, "add_tts_audio", note_ids=[WATER, 5], source_fields=["Word"], target_field="Back", voice=VOICE)
    assert "has no field 'Word'" in out["results"][0]["error"] and "no note 5" in out["results"][1]["error"]
    azure.status = 401
    out = await call(client, "add_tts_audio", note_ids=[WATER], source_fields=["Front"], target_field="Back", voice=VOICE)
    assert out["added"] == 0 and "refused the key" in out["results"][0]["error"]
