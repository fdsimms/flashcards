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


async def test_a_multilingual_voice_is_told_the_texts_language(client, azure):
    out = await call(client, "add_tts_audio", note_ids=[BOOK], source_fields=["Front"], target_field="Back",
                     voice="en-US-AvaMultilingualNeural", language="th-th")
    assert out["added"] == 1
    sent = azure.requests[0].content.decode()
    assert sent == ssml("หนังสือ", "en-US-AvaMultilingualNeural", language="th-TH")
    assert "<lang xml:lang='th-TH'>" in sent
    assert "isn't a language and region" in await call_error(
        client, "add_tts_audio", note_ids=[WATER], source_fields=["Front"], target_field="Back", voice=VOICE, language="Thai")


async def test_says_what_went_wrong(client, azure):
    assert "Up to 10" in await call_error(client, "add_tts_audio", note_ids=list(range(11)), source_fields=["Front"], target_field="Back", voice=VOICE)
    assert "isn't an Azure voice" in await call_error(client, "add_tts_audio", note_ids=[WATER], source_fields=["Front"], target_field="Back", voice="Premwadee")
    out = await call(client, "add_tts_audio", note_ids=[WATER, 5], source_fields=["Word"], target_field="Back", voice=VOICE)
    assert "has no field 'Word'" in out["results"][0]["error"] and "no note 5" in out["results"][1]["error"]
    azure.status = 401
    out = await call(client, "add_tts_audio", note_ids=[WATER], source_fields=["Front"], target_field="Back", voice=VOICE)
    assert out["added"] == 0 and "refused the key" in out["results"][0]["error"]


# ---- loudness: real audio, real ffmpeg ----

import base64
import shutil
import subprocess

from franki_mcp.speech import TARGET_LUFS, measure_loudness

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")


def tone(volume: float) -> bytes:
    return subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=1.5", "-af", f"volume={volume}",
         "-ar", "24000", "-ac", "1", "-f", "mp3", "pipe:1"], check=True, capture_output=True).stdout


async def field_audio(client, nid: int, field: str = "Back") -> list[str]:
    back = (await call(client, "get_notes", note_ids=[nid]))["notes"][0]["fields"][field]
    return [p.split("]")[0] for p in back.split("[sound:")[1:]]


@needs_ffmpeg
async def test_a_new_recording_is_leveled(client, cm, azure, desktop):
    azure.audio = tone(0.03)
    out = await call(client, "add_tts_audio", note_ids=[WATER], source_fields=["Front"], target_field="Back", voice=VOICE)
    assert "warning" not in out["results"][0]
    cm.wait_for_media()
    desktop.run("sync", "+", "media-sync")
    sound = (await field_audio(client, WATER))[0]
    level = await measure_loudness((desktop.path.parent / "collection.media" / sound).read_bytes())
    assert level is not None and abs(level - TARGET_LUFS) < 1.0


async def test_a_recording_that_cant_be_leveled_is_still_saved_and_says_so(client, azure):
    out = await call(client, "add_tts_audio", note_ids=[WATER], source_fields=["Front"], target_field="Back", voice=VOICE)
    assert out["added"] == 1 and "Saved without leveling" in out["results"][0]["warning"]


@needs_ffmpeg
async def test_levels_audio_a_note_already_has(client, cm, desktop):
    loud, quiet = tone(0.8), tone(0.03)
    names = [(await call(client, "store_media", filename=f, data_base64=base64.b64encode(d).decode()))["filename"]
             for f, d in (("loud.mp3", loud), ("quiet.mp3", quiet))]
    await call(client, "update_notes", updates=[{"note_id": WATER, "fields": {"Back": f"[sound:{names[0]}]"}},
                                                {"note_id": BOOK, "fields": {"Back": f"[sound:{names[1]}] meaning"}}])
    seen = await call(client, "normalize_audio", note_ids=[WATER, BOOK], preview=True)
    assert seen["changed"] == 0 and {r["status"] for r in seen["results"]} == {"would be leveled"}
    assert await field_audio(client, WATER) == [names[0]]  # a preview changes nothing

    out = await call(client, "normalize_audio", note_ids=[WATER, BOOK, 5])
    assert out["changed"] == 2 and "no note 5" in out["results"][2]["error"]
    cm.wait_for_media()
    desktop.run("sync", "+", "media-sync")
    for nid in (WATER, BOOK):
        (sound,) = await field_audio(client, nid)
        assert sound.startswith("franki-level-")
        level = await measure_loudness((desktop.path.parent / "collection.media" / sound).read_bytes())
        assert abs(level - TARGET_LUFS) < 1.0
    assert (await call(client, "get_notes", note_ids=[BOOK]))["notes"][0]["fields"]["Back"].endswith("meaning")

    again = await call(client, "normalize_audio", note_ids=[WATER, BOOK])  # already at the target: left alone
    assert again["changed"] == 0 and {r["status"] for r in again["results"]} == {"already at the target level"}


async def test_normalize_audio_says_what_it_cant_do(client):
    assert "Up to 20" in await call_error(client, "normalize_audio", note_ids=list(range(21)))
    out = await call(client, "normalize_audio", note_ids=[WATER, BOOK], field="Back")
    assert out["changed"] == 0 and all("no audio" in r["error"] for r in out["results"])
    assert "has no field 'Word'" in (await call(client, "normalize_audio", note_ids=[WATER], field="Word"))["results"][0]["error"]
