"""
Read & Listen's figures, from its server beside this one (server/reader). The MCP asks that
server's API with the same passphrase the app uses, so it never opens Read & Listen's database
itself. Read & Listen is optional: without it the tool says how to turn it on.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)


@dataclass(frozen=True)
class ReaderSettings:
    url: str  # e.g. http://reader:8080, inside the compose network
    passphrase: str


def register(server: MCPServer, settings: ReaderSettings | None, http: httpx.AsyncClient | None = None) -> None:
    """Adds Read & Listen's tools. `http` is for tests; the server makes its own."""
    client = http or httpx.AsyncClient(timeout=30)

    @server.tool(annotations=READ)
    async def read_and_listen_costs(days: int = 30) -> dict[str, Any]:
        """What Read & Listen's texts cost in Claude API calls over the last `days` days (1 to
        3650), per language and in total: texts written, how many were read, are still waiting,
        were dropped (they missed the known-words floor and were never shown, but were paid
        for) or skipped (taken off the shelf unread), attempts per text, dollars in all, per text
        written, and per text read (everything spent divided by the texts actually read), plus
        `explanations`: how many line and phrase explanations were asked for and what they
        cost, apart from the texts. Azure's audio isn't included: its cost isn't recorded per
        text."""
        if settings is None:
            raise ToolError(
                "Read & Listen isn't connected to the MCP. It needs READER_PASSPHRASE in server/.env "
                "(the passphrase the app uses) and reader in COMPOSE_PROFILES, then a restart."
            )
        if not 1 <= days <= 3650:
            raise ToolError("days must be between 1 and 3650.")
        try:
            r = await client.get(
                f"{settings.url.rstrip('/')}/api/costs",
                params={"days": days},
                headers={"Authorization": f"Bearer {settings.passphrase}"},
            )
        except httpx.HTTPError as e:
            raise ToolError(
                f"Couldn't reach Read & Listen at {settings.url} ({e.__class__.__name__}). It runs only "
                "when COMPOSE_PROFILES in server/.env has reader; check `docker compose ps reader`."
            ) from e
        if r.status_code == 401:
            raise ToolError("Read & Listen refused the passphrase. READER_PASSPHRASE in server/.env must be the one it runs with.")
        if r.status_code == 404:
            raise ToolError("Read & Listen's server is older than this tool. It updates itself within about 15 minutes of a merge.")
        if r.status_code != 200:
            raise ToolError(f"Read & Listen answered {r.status_code}: {r.text[:200]}")
        return r.json()
