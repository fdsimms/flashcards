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
target=$(git -C "$repo" rev-parse origin/main)

# The commit last deployed, written only once everything below has worked, so a failed build (which
# stops this script) is tried again at the next run rather than passed over because HEAD has already
# moved. Kept in the repository's .git folder: outside the tree and the images' build context. No
# record (the first run) means deploy.
record="$(git -C "$repo" rev-parse --absolute-git-dir)/franki-deployed"
deployed=$(cat "$record" 2>/dev/null || true)
if [ -n "$deployed" ] && ! git -C "$repo" cat-file -e "$deployed^{commit}" 2>/dev/null; then
  deployed=
fi
if [ -n "$deployed" ] && git -C "$repo" diff --quiet "$deployed" "$target" -- server/; then
  exit 0
fi

echo "Updating to $(git -C "$repo" log -1 --format='%h %s' "$target")"
# Caddy reads its Caddyfile only when it starts, and `up` doesn't restart it for a changed file, so
# a new route (say, /reader) would otherwise wait for the next reboot. With no record of what's
# running, it's recreated to be sure.
if [ -n "$deployed" ]; then
  caddyfile_changed=$(git -C "$repo" diff --quiet "$deployed" "$target" -- server/Caddyfile || echo yes)
else
  caddyfile_changed=yes
fi
# Fast-forward only: if the copy here was edited by hand, stop rather than merge over it. A no-op
# when an earlier run already merged and then failed to build.
git -C "$repo" merge --ff-only --quiet "$target"
docker compose up -d --build --remove-orphans
if [ -n "$caddyfile_changed" ]; then
  # Recreated, not reloaded: git writes the file anew, and the container's mount still shows the old one.
  docker compose up -d --force-recreate caddy
fi
echo "$target" > "$record.tmp" && mv "$record.tmp" "$record"
# The images the rebuild replaced, which otherwise fill the disk a few hundred MB at a time.
docker image prune -f >/dev/null
echo "Updated."
