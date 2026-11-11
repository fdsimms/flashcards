"""The MCP's `anki` package is the sync server's version (CLAUDE.md, The MCP): an older client can be
refused by the server, and a newer one can write a collection it can't read."""

import re
from pathlib import Path

SERVER = Path(__file__).resolve().parents[2]


def _version(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.split("."))  # 26.09.4 and 26.9.4 are the same


def test_anki_matches_the_sync_servers_version():
    server = re.search(r"ANKI_VERSION:\s*\$\{ANKI_VERSION:-([0-9.]+)\}", (SERVER / "docker-compose.yml").read_text())
    assert server, "ANKI_VERSION's default not found in docker-compose.yml"
    pin = re.search(r"^anki==([0-9.]+)$", (SERVER / "mcp" / "requirements.txt").read_text(), re.M)
    assert pin, "anki isn't pinned in requirements.txt"
    assert _version(pin.group(1)) == _version(server.group(1))
