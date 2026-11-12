# Read & Listen: writes texts from the words in the Anki deck, as one more Anki client of the sync
# server beside it. Built by ../docker-compose.yml (the `reader` profile) from server/, so it can copy
# the shared speech/ package; ../README.md has the setup.
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
# Litestream (backups), a static binary from its official image.
COPY --from=litestream/litestream:0.5.17 /usr/local/bin/litestream /usr/local/bin/litestream

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv

# Dependencies first, so a code change doesn't reinstall them. pyproject.toml finds the shared
# speech package at ../speech, which is /speech from /app.
COPY speech /speech
COPY reader/pyproject.toml reader/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY reader/src ./src
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080
COPY reader/litestream.yml /etc/litestream.yml
COPY reader/start.sh ./start.sh
CMD ["./start.sh"]
