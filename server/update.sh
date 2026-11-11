#!/bin/sh
# Brings this server up to date with the repository's main branch, when anything under server/
# changed: pulls, rebuilds what changed and restarts it (a few seconds without sync). Run by the
# franki-update timer (install-auto-update.sh); safe to run by hand too. Logs go to the journal:
# journalctl -u franki-update
set -eu
cd "$(dirname "$0")"
repo=$(git rev-parse --show-toplevel)

git -C "$repo" fetch --quiet origin main
if git -C "$repo" diff --quiet HEAD origin/main -- server/; then
  exit 0
fi

echo "Updating to $(git -C "$repo" log -1 --format='%h %s' origin/main)"
# Fast-forward only: if the copy here was edited by hand, stop rather than merge over it.
git -C "$repo" merge --ff-only --quiet origin/main
docker compose up -d --build --remove-orphans
# The images the rebuild replaced, which otherwise fill the disk a few hundred MB at a time.
docker image prune -f >/dev/null
echo "Updated."
