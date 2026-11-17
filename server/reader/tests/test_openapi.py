"""The checked-in schema the app's types are generated from matches the routes."""

from franki_reader import openapi


def test_the_checked_in_schema_matches_the_routes() -> None:
    assert openapi.PATH.read_text() == openapi.render(), (
        "openapi.json is stale: run `npm run api:types` at the repo root"
    )
