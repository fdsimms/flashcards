"""The checked-in schema the app's types are generated from matches the routes."""

import json
import re

from franki_reader import openapi


def test_the_checked_in_schema_matches_the_routes() -> None:
    assert openapi.PATH.read_text() == openapi.render(), (
        "openapi.json is stale: run `npm run api:types` at the repo root"
    )


def test_no_two_models_share_a_name() -> None:
    # Two route files' models with one class name are both renamed in the schema to their module
    # path (franki_reader__routes__voices__ReadingIn), so the app's Schemas['ReadingIn'] stops
    # resolving with nothing saying why. Give each a name of its own.
    names = json.loads(openapi.render())["components"]["schemas"]
    clashes = sorted(n for n in names if re.match(r"^franki_reader__", n))
    assert not clashes, f"Models that share a class name across route files: {clashes}"
