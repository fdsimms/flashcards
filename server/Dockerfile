# Anki's own sync server, from the `anki` Python package (the same Rust server Anki desktop has
# built in, prebuilt for x86-64 and ARM Linux, so nothing compiles on a small server). Keep
# ANKI_VERSION at or above the newest Anki you sync with; Franki is tested against 26.09.
FROM python:3.13-slim
ARG ANKI_VERSION=26.09.4
RUN pip install --no-cache-dir "anki==${ANKI_VERSION}" \
 && useradd --create-home --uid 1000 anki \
 && mkdir /data && chown anki:anki /data
USER anki
ENV SYNC_BASE=/data SYNC_HOST=0.0.0.0 SYNC_PORT=8080
EXPOSE 8080
VOLUME /data
CMD ["python", "-m", "anki.syncserver"]
