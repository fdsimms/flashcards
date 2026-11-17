#!/bin/sh
# Starts the server. With a backup bucket configured (BUCKET_NAME in ../.env), Litestream restores
# the database if the volume is empty, then runs the server and streams every change to the bucket.
# Without one, the server runs on its own.
set -e
# Caddy's X-Forwarded-For is believed from the private networks Docker puts it on, so the
# wrong-passphrase limit counts the phone's address, not Caddy's (as the MCP's PROXY_NETWORKS).
APP="uvicorn --factory franki_reader.app:production_app --host 0.0.0.0 --port 8080 --forwarded-allow-ips 127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"
if [ -n "$BUCKET_NAME" ]; then
  exec litestream replicate -config /etc/litestream.yml -restore-if-db-not-exists -exec "$APP"
fi
exec $APP
