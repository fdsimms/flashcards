# Franki's MCP: Claude's way into the Anki collection, as one more Anki client of the sync server
# beside it. Anki's engine comes prebuilt from the `anki` package, as for the sync server.
# Built from server/ (docker-compose.yml), so it can copy the shared speech/ package.
# Images are pinned by digest, so a rebuild gets exactly the image tested; Dependabot proposes updates
# (../../.github/dependabot.yml), and merging one is how a security fix reaches the server.
FROM python:3.13-slim@sha256:168d3a5d10f2152f8e8d77b6843ac82c22a846cfefeef7afdf9aa630404e82a7
COPY mcp/requirements.txt /app/requirements.txt
COPY speech /speech
# ffmpeg levels the loudness of recorded audio (franki_speech.loudness). The packages are installed
# exactly as hashed in requirements.txt; the shared speech package, which has no hash, after them on
# its own, its one dependency (httpx) already among them.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir --require-hashes -r /app/requirements.txt \
 && pip install --no-cache-dir --no-deps /speech \
 && useradd --create-home --uid 1000 franki \
 && mkdir /data && chown franki:franki /data
COPY mcp/franki_mcp /app/franki_mcp
WORKDIR /app
USER franki
ENV MCP_DATA=/data PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000
VOLUME /data
CMD ["python", "-m", "franki_mcp"]
