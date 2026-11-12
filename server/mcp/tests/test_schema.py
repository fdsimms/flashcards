"""Adding a field: a change only a full upload sends, after which every other device downloads."""

from __future__ import annotations

import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from anki.sync_pb2 import SyncCollectionResponse
from conftest import call, call_error

pytestmark = pytest.mark.anyio
Required = SyncCollectionResponse.ChangesRequired


async def test_refuses_until_every_device_is_said_to_be_synced(client):
    message = await call_error(client, "add_field", note_type="Basic", field="Hint")
    assert "sync Anki on their computer, AnkiMobile and Franki first" in message
    assert '"Basic" already has a field called "Front"' in await call_error(client, "add_field", note_type="Basic", field="front", every_device_synced=True)
    assert "can't be empty" in await call_error(client, "add_field", note_type="Basic", field="a:b", every_device_synced=True)
    assert "no note type" in await call_error(client, "add_field", note_type="Nope", field="Hint", every_device_synced=True)


async def test_the_field_reaches_another_device_through_a_full_download(client, desktop):
    # A note added on the computer and synced first is kept: the MCP syncs before it uploads.
    added = desktop.run("add-note", "🧠 Trivia", "Capital of Bolivia?", "Sucre", "+", "sync")["note"]
    out = await call(client, "add_field", note_type="Basic", field="Hint", every_device_synced=True)
    assert out["fields"] == ["Front", "Back", "Hint"] and "choose Download" in out["next"]

    # The computer can't merge any more: it has to take the server's copy, which has the field.
    assert desktop.run("sync")["sync"]["required"] in (Required.FULL_DOWNLOAD, Required.FULL_SYNC)
    fields = desktop.run("download", "+", "fields", f"nid:{added}")["fields"][str(added)]
    assert fields == {"Front": "Capital of Bolivia?", "Back": "Sucre", "Hint": ""}
    # And afterwards both sync normally again.
    assert desktop.run("sync")["sync"]["required"] in (Required.NO_CHANGES, Required.NORMAL_SYNC)
    assert (await call(client, "get_note_type", note_type="Basic"))["fields"] == ["Front", "Back", "Hint"]


async def test_a_failed_upload_leaves_the_server_and_this_copy_as_they_were(client, cm, desktop):
    def fail() -> None:
        raise OSError("connection reset")

    cm._full_upload = fail
    assert "Nothing changed there" in await call_error(client, "add_field", note_type="Basic", field="Hint", every_device_synced=True)
    del cm._full_upload
    # This copy was thrown away and downloaded again: no field, and syncing works as before.
    assert (await call(client, "get_note_type", note_type="Basic"))["fields"] == ["Front", "Back"]
    assert desktop.run("sync")["sync"]["required"] in (Required.NO_CHANGES, Required.NORMAL_SYNC)
