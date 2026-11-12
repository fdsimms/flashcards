#!/bin/sh
# Brings this server up to date with the repository's main branch, when anything under server/
# changed: pulls, rebuilds what changed and restarts it (a few seconds without sync). Run by the
# franki-update timer (install-auto-update.sh); safe to run by hand too. Logs go to the journal:
# journalctl -u franki-update
set -eu
cd "$(dirname "$0")"
repo=$(git rev-parse --show-toplevel)

# Read & Listen's server, if it has stopped answering /health (its compose healthcheck): Docker
# only marks it unhealthy, and nothing else would restart it.
reader=$(docker compose ps -q reader 2>/dev/null || true)
if [ -n "$reader" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$reader" 2>/dev/null || true)" = unhealthy ]; then
  echo "Restarting Read & Listen: it stopped answering."
  docker compose restart reader
fi

git -C "$repo" fetch --quiet origin main
if git -C "$repo" diff --quiet HEAD origin/main -- server/; then
  exit 0
fi

echo "Updating to $(git -C "$repo" log -1 --format='%h %s' origin/main)"
# Caddy reads its Caddyfile only when it starts, and `up` doesn't restart it for a changed file, so
# a new route (say, /reader) would otherwise wait for the next reboot.
caddyfile_changed=$(git -C "$repo" diff --quiet HEAD origin/main -- server/Caddyfile || echo yes)
# Fast-forward only: if the copy here was edited by hand, stop rather than merge over it.
git -C "$repo" merge --ff-only --quiet origin/main
docker compose up -d --build --remove-orphans
if [ -n "$caddyfile_changed" ]; then
  # Recreated, not reloaded: git writes the file anew, and the container's mount still shows the old one.
  docker compose up -d --force-recreate caddy
fi
# The images the rebuild replaced, which otherwise fill the disk a few hundred MB at a time.
docker image prune -f >/dev/null
echo "Updated."
