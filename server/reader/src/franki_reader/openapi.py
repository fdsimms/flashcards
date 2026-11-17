"""The API's OpenAPI schema, which the app's types are generated from (routes/__init__.py says
which routes it describes in full).

`uv run python -m franki_reader.openapi` writes it to openapi.json beside pyproject.toml, and
`npm run api:types` at the repo root runs that, then writes src/reader/apiTypes.gen.ts from it.
tests/test_openapi.py fails when the file is stale."""

import json
from pathlib import Path
from typing import cast

from franki_reader.app import create_app
from franki_reader.engine import Engine

PATH = Path(__file__).resolve().parents[2] / "openapi.json"


def render() -> str:
    # Building the app reads nothing from the engine, so the schema needs no database.
    app = create_app(cast(Engine, None), None)
    return json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    PATH.write_text(render())


if __name__ == "__main__":
    main()
