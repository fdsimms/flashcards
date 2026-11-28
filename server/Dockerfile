# Anki's own sync server, from the `anki` Python package (the same Rust server Anki desktop has
# built in, prebuilt for x86-64 and ARM Linux, so nothing compiles on a small server). Keep
# ANKI_VERSION at or above the newest Anki you sync with; Franki is tested against 26.09.
# Images are pinned by digest, so a rebuild gets exactly the image tested; Dependabot proposes updates
# (../.github/dependabot.yml), and merging one is how a security fix reaches the server.
FROM python:3.13-slim@sha256:168d3a5d10f2152f8e8d77b6843ac82c22a846cfefeef7afdf9aa630404e82a7
ARG ANKI_VERSION=26.09.4
RUN pip install --no-cache-dir "anki==${ANKI_VERSION}" \
 && useradd --create-home --uid 1000 anki \
 && mkdir /data && chown anki:anki /data
USER anki
ENV SYNC_BASE=/data SYNC_HOST=0.0.0.0 SYNC_PORT=8080
EXPOSE 8080
VOLUME /data
CMD ["python", "-m", "anki.syncserver"]
