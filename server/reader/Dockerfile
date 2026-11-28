# Read & Listen: writes texts from the words in the Anki deck, as one more Anki client of the sync
# server beside it. Built by ../docker-compose.yml (the `reader` profile) from server/, so it can copy
# the shared speech/ package; ../README.md has the setup.
# Images are pinned by digest, so a rebuild gets exactly the image tested; Dependabot proposes updates
# (../../.github/dependabot.yml), and merging one is how a security fix reaches the server.
FROM python:3.13-slim@sha256:168d3a5d10f2152f8e8d77b6843ac82c22a846cfefeef7afdf9aa630404e82a7

COPY --from=ghcr.io/astral-sh/uv:0.8@sha256:1d31be550ff927957472b2a491dc3de1ea9b5c2d319a9cea5b6a48021e2990a6 /uv /usr/local/bin/uv
# Litestream (backups), a static binary from its official image.
COPY --from=litestream/litestream:0.5.17@sha256:4b02b9859a6b6b4087d8b8944e15f7e984bd7957cba322bbeee38b0e27b9656a /usr/local/bin/litestream /usr/local/bin/litestream

# ffmpeg joins an audio lesson's clips and silences into one MP3 and levels their loudness
# (lesson_audio.py, franki_speech.loudness).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

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
COPY reader/start.sh reader/entrypoint.sh ./
# The server runs as `reader` (uid 1000, as sync's and the MCP's users), not root: entrypoint.sh
# gives it the data volume and then drops to it.
RUN useradd --create-home --uid 1000 reader \
 && mkdir -p /data && chown reader:reader /data
VOLUME /data
CMD ["./entrypoint.sh"]
