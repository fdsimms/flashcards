# Franki's MCP: Claude's way into the Anki collection, as one more Anki client of the sync server
# beside it. Anki's engine comes prebuilt from the `anki` package, as for the sync server.
# Built from server/ (docker-compose.yml), so it can copy the shared speech/ package.
FROM python:3.13-slim
COPY mcp/requirements.txt /app/requirements.txt
COPY speech /speech
RUN pip install --no-cache-dir -r /app/requirements.txt /speech \
 && useradd --create-home --uid 1000 franki \
 && mkdir /data && chown franki:franki /data
COPY mcp/franki_mcp /app/franki_mcp
WORKDIR /app
USER franki
ENV MCP_DATA=/data PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000
VOLUME /data
CMD ["python", "-m", "franki_mcp"]
