#!/bin/sh
# Runs as root only long enough to hand the data volume to the `reader` user, then starts the
# server as that user (start.sh). A volume made before the server ran unprivileged is root-owned,
# so whatever in /data isn't the reader's yet is given to it here, at every start: only those files
# are touched, so a volume already handed over costs a quick scan. The container keeps just the
# capabilities this needs (CHOWN, SETUID, SETGID in docker-compose.yml), and the server has none.
set -e
if [ "$(id -u)" = 0 ]; then
  find /data -xdev \( ! -user reader -o ! -group reader \) -exec chown reader:reader {} +
  export HOME=/home/reader
  exec setpriv --reuid=reader --regid=reader --init-groups --inh-caps=-all ./start.sh
fi
exec ./start.sh
