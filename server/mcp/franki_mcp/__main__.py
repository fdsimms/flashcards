"""
Runs the MCP over HTTP: python -m franki_mcp. Settings come from the environment (server/.env,
through docker-compose.yml):

    MCP_PUBLIC_URL        where Claude reaches it, e.g. https://anki.example.com (the MCP is at /mcp)
    MCP_PASSWORD          asked for once when connecting a Claude app (12 characters or more)
    ANKI_SYNC_ENDPOINT    the Anki sync server, e.g. http://anki:8080/
    ANKI_USER, ANKI_PASSWORD   its sign-in, the same as Anki's
    AZURE_SPEECH_KEY, AZURE_SPEECH_REGION   for audio (optional; AZURE_SPEECH_ENDPOINT overrides the host)
    MCP_DATA              where the collection copy and sign-ins are kept (default /data)
    READER_URL, READER_PASSPHRASE   Read & Listen's server and its passphrase, for its costs (optional)
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

import anyio
import uvicorn
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import forms
from .auth import SingleUserAuth
from .collection import CollectionManager, SyncSettings
from .reader import ReaderSettings
from .server import build_server
from .speech import SpeechClient


# Who may say, in X-Forwarded-For and X-Forwarded-Proto, whose request it passes on: Caddy, which reaches
# the MCP over the compose network, a private address (the port isn't published). uvicorn takes the
# client as the last address in the header that isn't on these networks, so an address a client wrote
# in front of the real one is skipped, and a request from anywhere else keeps its own address. The
# approval page's wrong-password limit counts by that address (auth._source). ("*" believed any sender
# and took the first address, which is the client's own to write.)
PROXY_NETWORKS = "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"


def env(name: str, default: str | None = None, environ=os.environ) -> str:
    value = environ.get(name, default)
    if not value:
        raise SystemExit(f"Set {name} in server/.env (see .env.example).")
    return value


def build_app(environ=os.environ) -> tuple[Starlette, CollectionManager]:
    """The HTTP app (the MCP at /mcp, sign-in around it) and its collection, from the settings."""
    e = lambda name, default=None: env(name, default, environ)  # noqa: E731
    public = e("MCP_PUBLIC_URL").rstrip("/")
    data = Path(e("MCP_DATA", "/data"))
    data.mkdir(parents=True, exist_ok=True)
    cm = CollectionManager(data / "collection", SyncSettings(e("ANKI_SYNC_ENDPOINT"), e("ANKI_USER"), e("ANKI_PASSWORD")))
    speech = None
    if environ.get("AZURE_SPEECH_KEY"):
        speech = SpeechClient(environ["AZURE_SPEECH_KEY"], e("AZURE_SPEECH_REGION"), environ.get("AZURE_SPEECH_ENDPOINT") or None,
                              user_agent="franki-mcp", voice_help="Check the voice name with list_voices.")
    reader_settings = None
    if environ.get("READER_URL") and environ.get("READER_PASSPHRASE"):
        reader_settings = ReaderSettings(environ["READER_URL"], environ["READER_PASSPHRASE"])
    extra = tuple(u for u in environ.get("MCP_EXTRA_REDIRECT_URIS", "").split() if u)
    try:
        auth = SingleUserAuth(data / "signins.sqlite", public, e("MCP_PASSWORD"), extra)
    except ValueError as err:
        raise SystemExit(str(err)) from err

    server = build_server(
        cm, speech,
        reader_settings=reader_settings,
        auth_server_provider=auth,
        auth=AuthSettings(
            issuer_url=public,
            resource_server_url=f"{public}/mcp",
            client_registration_options=ClientRegistrationOptions(enabled=True),
            revocation_options=RevocationOptions(enabled=True),
            # One resource behind this issuer, so a token's audience needs no separate check.
            validate_token_resource=False,
        ),
    )
    server.custom_route("/approve", methods=["GET"], include_in_schema=False)(auth.approve_page)
    server.custom_route("/approve", methods=["POST"], include_in_schema=False)(auth.approve_submit)

    @server.custom_route("/mcp-health", methods=["GET"], include_in_schema=False)
    async def health(_: Request) -> Response:
        return JSONResponse({"ok": True})

    app = server.streamable_http_app(
        transport_security=TransportSecuritySettings(allowed_hosts=[urlparse(public).netloc], allowed_origins=[public]),
        host="0.0.0.0",
    )
    # The daily Forms fill (forms.py) runs beside the server for as long as it's up.
    serve = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(a):
        async with serve(a) as state, anyio.create_task_group() as tg:
            tg.start_soon(forms.auto_fill_loop, cm, forms.UniMorph(data / "unimorph"))
            yield state
            tg.cancel_scope.cancel()

    app.router.lifespan_context = lifespan
    return app, cm


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app, _ = build_app()
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), proxy_headers=True, forwarded_allow_ips=PROXY_NETWORKS)


if __name__ == "__main__":
    main()
