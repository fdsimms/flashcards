"""Native recordings (native.py): a native speaker's recording from a faked Wikimedia Commons kept in
an Omnilanguage note's Audio, with its credit in AudioCredit; and add_notes using one before Azure."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import urllib.parse

import httpx
import pytest
from mcp import Client

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call
from franki_mcp.native import NATIVE_KEY, wanted
from franki_mcp.server import build_server
from franki_speech import SpeechClient
from franki_speech.commons import Commons

pytestmark = [pytest.mark.anyio, pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")]

FIELDS = "Entry,Meaning,Context,ContextTranslation,Register,Language,PartOfSpeech,Audio,AudioCredit"
LL = "http://commons.wikimedia.org/wiki/Special:FilePath/LL-Q188%20(deu)-Natschi-Hund.wav"
TITLE = "File:LL-Q188 (deu)-Natschi-Hund.wav"


def tone() -> bytes:
    return subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=1", "-f", "wav", "pipe:1"],
        check=True, capture_output=True).stdout


class Wikimedia:
    def __init__(self) -> None:
        self.words: set[str] = {"Hund"}
        self.asked: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.asked.append(request.url.host)
        if request.url.host == "lingualibre.org":
            # Answers for every word the query asks about, naming the spelling each row matched.
            query = urllib.parse.parse_qs(request.content.decode())["query"][0]
            asked = re.findall(r'"([^"]*)"', query.split("VALUES ?t {", 1)[1])
            rows = [{"r": {"value": f"https://lingualibre.org/entity/Q{i}"}, "t": {"value": w},
                     "file": {"value": LL}} for i, w in enumerate(asked) if w in self.words]
            return httpx.Response(200, json={"results": {"bindings": rows}})
        if request.url.host == "upload.wikimedia.org":
            return httpx.Response(200, content=tone())
        titles = dict(request.url.params).get("titles", "")
        pages = {}
        if TITLE in titles.split("|"):
            pages["1"] = {"title": TITLE, "imageinfo": [{
                "url": "https://upload.wikimedia.org/a/Hund.wav",
                "extmetadata": {"Artist": {"value": "Speaker: Natschi Recorder: Natschi"},
                                "LicenseShortName": {"value": "CC BY-SA 4.0"},
                                "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"}}}]}
        return httpx.Response(200, json={"query": {"pages": pages}})


async def no_wait(_: float) -> None:
    return None


@pytest.fixture
def wiki():
    return Wikimedia()


@pytest.fixture
async def native_client(cm, azure, wiki):
    speech = SpeechClient("key", "westeurope", http=httpx.AsyncClient(transport=httpx.MockTransport(azure)),
                          user_agent="franki-mcp", voice_help="Check the voice name with list_voices.")
    commons = Commons("test", httpx.MockTransport(wiki), lambda: 0.0, no_wait)
    async with Client(build_server(cm, speech, commons=commons)) as c:
        yield c


@pytest.fixture
def german_deck(desktop):
    desktop.run("add-notetype", "Omnilanguage", FIELDS,
                "+", "add-fields-note", "Omnilanguage", "Deutsch",
                json.dumps({"Entry": "Hund", "Meaning": "dog", "Language": "german", "Audio": "[sound:azure.mp3]"}),
                "+", "sync")


async def set_native(cm, value) -> None:
    await cm.write(lambda col: col.set_config(NATIVE_KEY, value))


async def hund(client) -> dict:
    nid = (await call(client, "find_notes", query="Entry:Hund"))["notes"][0]["note_id"]
    return (await call(client, "get_notes", note_ids=[nid]))["notes"][0] | {"note_id": nid}


def test_the_setting_is_off_until_turned_on_and_thai_and_greek_stay_off_unless_chosen():
    assert not wanted({}, "de")
    assert wanted({"on": True}, "de") and not wanted({"on": True}, "th")
    assert wanted({"on": True, "languages": {"th": True}}, "th")
    assert not wanted({"on": True, "languages": {"de": False}}, "de")


async def test_previews_then_keeps_the_recording_with_its_credit(native_client, cm, wiki, german_deck):
    await set_native(cm, {"on": True})
    note = await hund(native_client)
    preview = await call(native_client, "add_native_recordings", note_ids=[note["note_id"]])
    assert preview["preview"] and preview["found"] == 1 and preview["kept"] == 0
    assert preview["results"][0]["recording"]["speaker"] == "Natschi"
    assert (await hund(native_client))["fields"]["Audio"] == "[sound:azure.mp3]"

    done = await call(native_client, "add_native_recordings", note_ids=[note["note_id"]], preview=False)
    assert done["kept"] == 1
    fields = (await hund(native_client))["fields"]
    assert fields["Audio"].startswith("[sound:franki-native-") and "azure.mp3" not in fields["Audio"]
    assert fields["AudioCredit"].startswith("Natschi (Lingua Libre), CC BY-SA 4.0, https://creativecommons.org")
    assert fields["AudioCredit"].endswith("trimmed and loudness-evened")
    # Asked again, it's skipped: the note has its native recording.
    again = await call(native_client, "add_native_recordings", note_ids=[note["note_id"]], preview=False)
    assert again["kept"] == 0 and "already" in again["results"][0]["skipped"]


async def test_nothing_happens_while_the_setting_is_off(native_client, cm, wiki, german_deck):
    note = await hund(native_client)
    out = await call(native_client, "add_native_recordings", note_ids=[note["note_id"]], preview=False)
    assert out["kept"] == 0 and "off" in out["results"][0]["skipped"]
    assert wiki.asked == []


async def test_a_note_type_without_the_credit_field_gets_none(native_client, cm, wiki, desktop):
    desktop.run("add-notetype", "Omnilanguage", FIELDS.replace(",AudioCredit", ""),
                "+", "add-fields-note", "Omnilanguage", "Deutsch",
                json.dumps({"Entry": "Hund", "Meaning": "dog", "Language": "german"}), "+", "sync")
    await set_native(cm, {"on": True})
    note = await hund(native_client)
    out = await call(native_client, "add_native_recordings", note_ids=[note["note_id"]], preview=False)
    assert "AudioCredit" in out["results"][0]["skipped"] and wiki.asked == []


async def test_add_notes_keeps_a_native_recording_before_recording_with_azure(native_client, cm, azure, wiki, german_deck):
    await set_native(cm, {"on": True})
    await call(native_client, "set_audio_voice", language="german", voice="de-DE-KatjaNeural")
    wiki.words = {"Vogel"}
    new = {"deck": "Deutsch", "note_type": "Omnilanguage", "fields": {
        "Entry": "Vogel", "Meaning": "bird", "Context": "<b>Vogel</b>", "ContextTranslation": "bird",
        "Register": "neutral", "Language": "german", "PartOfSpeech": "noun"}}
    other = {**new, "fields": {**new["fields"], "Entry": "Katze", "Context": "<b>Katze</b>", "Meaning": "cat"}}
    out = await call(native_client, "add_notes", notes=[new, other], allow_nonstandard=True)
    vogel_result, katze_result = out["results"]
    assert vogel_result["audio"].startswith("franki-native-") and "Natschi" in vogel_result["audio_credit"]
    # None found for Katze: recorded with Azure as before.
    assert katze_result["audio"].startswith("franki-tts-")
    assert len(azure.requests) == 1


async def test_add_notes_keeps_the_recording_it_was_given(native_client, cm, azure, wiki, german_deck):
    await set_native(cm, {"on": True})
    wiki.words = {"Vogel"}
    new = {"deck": "Deutsch", "note_type": "Omnilanguage", "fields": {
        "Entry": "Vogel", "Meaning": "bird", "Context": "<b>Vogel</b>", "ContextTranslation": "bird",
        "Register": "neutral", "Language": "german", "PartOfSpeech": "noun", "Audio": "[sound:vogel-mine.mp3]"}}
    out = await call(native_client, "add_notes", notes=[new], allow_nonstandard=True)
    (result,) = out["results"]
    assert "audio" not in result and "native_error" not in result

    def read(col):
        return col.get_note(result["note_id"])["Audio"]

    assert await cm.read(read) == "[sound:vogel-mine.mp3]"
    assert not azure.requests


async def test_add_notes_looks_up_all_its_words_in_one_query(native_client, cm, azure, wiki, german_deck):
    await set_native(cm, {"on": True})
    await call(native_client, "set_audio_voice", language="german", voice="de-DE-KatjaNeural")
    wiki.words = {"Vogel", "Maus"}

    def noun(entry: str, meaning: str) -> dict:
        return {"deck": "Deutsch", "note_type": "Omnilanguage", "fields": {
            "Entry": entry, "Meaning": meaning, "Context": f"<b>{entry}</b>", "ContextTranslation": meaning,
            "Register": "neutral", "Language": "german", "PartOfSpeech": "noun"}}

    out = await call(native_client, "add_notes", notes=[noun("Vogel", "bird"), noun("Katze", "cat"),
                                                         noun("Maus", "mouse")], allow_nonstandard=True)
    assert [r["audio"].split("-")[1] for r in out["results"]] == ["native", "tts", "native"]
    # One Lingua Libre query and one Commons request for the three words; a download for each found.
    assert wiki.asked.count("lingualibre.org") == 1 and wiki.asked.count("commons.wikimedia.org") == 1
    assert wiki.asked.count("upload.wikimedia.org") == 2
