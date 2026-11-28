"""The HTTP API's routes, one module per area, each a `router(ctx)` that create_app (app.py)
includes in turn. app.py's docstring lists every route; a route's code is in the module for its
area, built from the `AppContext` (context.py) create_app makes.

Response shapes: a route whose answer is a Pydantic model (`response_model`) is described in the
OpenAPI schema, and the app's types for it are generated from that (`npm run api:types` writes
openapi.json beside this package's server and src/reader/apiTypes.gen.ts; tests fail when either is
stale). A route still answering a plain dict has hand-written types in src/reader/api.ts: those are
the routes not converted yet, and a route changed is a good time to convert it.
"""

from franki_reader.routes import (
    cards,
    cram_say,
    cram_themes,
    cram_words,
    explain,
    grammar,
    grammar_topics,
    health,
    journal,
    lessons,
    native,
    note_queue,
    own_texts,
    practice,
    progress,
    settings,
    situations,
    texts,
    topics,
    vocab,
    voices,
    word_suggestions,
)

# The order create_app includes them in. Within a router, a path with a parameter
# (/api/grammar/{point_id}) answers only what no route before it claimed (/api/grammar/choices).
AREAS = (
    health,
    topics,
    own_texts,
    texts,
    explain,
    settings,
    voices,
    practice,
    journal,
    native,
    grammar_topics,
    situations,
    lessons,
    cram_say,
    cram_themes,
    cram_words,
    cards,
    progress,
    grammar,
    vocab,
    note_queue,
    word_suggestions,
)
