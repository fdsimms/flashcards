import re
from pathlib import Path

from franki_reader.characters import CHARACTERS
from franki_reader.generator import DRAFT_SCHEMA

APP = Path(__file__).parents[3] / "src" / "reader" / "characters.ts"


def test_the_app_draws_every_character_the_server_can_pick() -> None:
    source = APP.read_text()
    listed = re.search(r"export const CHARACTERS = \[(.*?)\] as const", source, re.DOTALL)
    assert listed
    assert tuple(re.findall(r"'([a-z]+)'", listed.group(1))) == CHARACTERS


def test_a_draft_may_pick_any_character_or_none() -> None:
    allowed = DRAFT_SCHEMA["properties"]["characters"]["properties"]["A"]["enum"]
    assert allowed == [*CHARACTERS, "none"]
    assert "characters" in DRAFT_SCHEMA["required"]
