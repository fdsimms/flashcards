"""
A real Anki sync server for the tests, holding a copy of the fixture collection Anki made
(tests/fixtures/anki at the repo root), plus Anki itself as the user's other device.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from franki_mcp.collection import CollectionManager, SyncSettings
from franki_mcp.server import build_server
from franki_mcp.speech import SpeechClient
import httpx
from mcp import Client

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "anki"


class AnkiDevice:
    """Anki on another device: sync-device.py run on its own collection."""

    def __init__(self, folder: Path, url: str):
        self.path = folder / "collection.anki2"
        shutil.copy(FIXTURES / "collection.anki2", self.path)
        self.url = url

    def run(self, *args: str) -> dict:
        out = subprocess.run([sys.executable, "-I", str(FIXTURES / "sync-device.py"), str(self.path), self.url, *args],
                             check=True, capture_output=True, text=True).stdout
        return json.loads(out.strip().splitlines()[-1])


@pytest.fixture
def sync_server(tmp_path):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = {**os.environ, "SYNC_USER1": "user:pass", "SYNC_BASE": str(tmp_path / "server"),
           "SYNC_HOST": "127.0.0.1", "SYNC_PORT": str(port)}
    proc = subprocess.Popen([sys.executable, "-m", "anki.syncserver"], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 15
    while True:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            if time.monotonic() > deadline or proc.poll() is not None:
                proc.kill()
                raise RuntimeError("the Anki sync server didn't start")
            time.sleep(0.1)
    yield f"http://127.0.0.1:{port}/"
    proc.kill()
    proc.wait()


@pytest.fixture
def desktop(sync_server, tmp_path):
    """The user's computer, which put the collection on the server."""
    (tmp_path / "desktop").mkdir()
    d = AnkiDevice(tmp_path / "desktop", sync_server)
    d.run("upload")
    return d


@pytest.fixture
def cm(desktop, sync_server, tmp_path):
    m = CollectionManager(tmp_path / "mcp", SyncSettings(sync_server, "user", "pass", fresh_seconds=0))
    yield m
    m.close()


class FakeAzure:
    """Azure Speech as the tests need it: a voice list, and audio that names what it was asked to say."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.status = 200

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status)
        if request.url.path.endswith("/voices/list"):
            return httpx.Response(200, json=[
                {"ShortName": "th-TH-PremwadeeNeural", "Locale": "th-TH", "LocaleName": "Thai (Thailand)", "Gender": "Female", "DisplayName": "Premwadee"},
                {"ShortName": "pl-PL-ZofiaNeural", "Locale": "pl-PL", "LocaleName": "Polish (Poland)", "Gender": "Female", "DisplayName": "Zofia"},
            ])
        return httpx.Response(200, content=b"MP3:" + request.content)


@pytest.fixture
def azure():
    return FakeAzure()


@pytest.fixture
async def client(cm, azure):
    speech = SpeechClient("key", "westeurope", http=httpx.AsyncClient(transport=httpx.MockTransport(azure)))
    async with Client(build_server(cm, speech)) as c:
        yield c


async def call(client, name: str, **args) -> dict:
    """Calls a tool and returns its result, failing the test on an error."""
    r = await client.call_tool(name, args)
    assert not r.is_error, r.content[0].text
    return r.structured_content or json.loads(r.content[0].text)


async def call_error(client, name: str, **args) -> str:
    r = await client.call_tool(name, args)
    assert r.is_error, r.content
    return r.content[0].text


@pytest.fixture
def anyio_backend():
    return "asyncio"
