"""The reader's `anki` package is the sync server's version (CLAUDE.md, Read & Listen): an older
client can be refused by the server, and a newer one can write a collection it can't read."""

import re
import tomllib
from pathlib import Path

SERVER = Path(__file__).resolve().parents[2]


def _version(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.split("."))  # 26.09.4 and 26.9.4 are the same


def test_anki_matches_the_sync_servers_version() -> None:
    compose = (SERVER / "docker-compose.yml").read_text()
    server = re.search(r"ANKI_VERSION:\s*\$\{ANKI_VERSION:-([0-9.]+)\}", compose)
    assert server, "ANKI_VERSION's default not found in docker-compose.yml"
    project = tomllib.loads((SERVER / "reader" / "pyproject.toml").read_text())
    pins = [d for d in project["project"]["dependencies"] if d.startswith("anki==")]
    assert len(pins) == 1
    assert _version(pins[0].removeprefix("anki==")) == _version(server.group(1))
