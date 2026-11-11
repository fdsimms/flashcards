#!/bin/sh
# Turns on automatic updates: a systemd timer that runs update.sh every 15 minutes. Run once, as
# root, from this folder: sh install-auto-update.sh. To turn them off again:
# systemctl disable --now franki-update.timer
set -eu
here=$(cd "$(dirname "$0")" && pwd)
chmod +x "$here/update.sh"

cat > /etc/systemd/system/franki-update.service <<UNIT
[Unit]
Description=Update Franki's server from GitHub
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$here/update.sh
UNIT

cat > /etc/systemd/system/franki-update.timer <<UNIT
[Unit]
Description=Check for Franki server updates every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now franki-update.timer
echo "Automatic updates are on. The next check (NEXT) and the last one (LAST):"
# list-timers, not `systemctl show ... NextElapseUSecRealtime`: this timer counts from boot and
# from its last run, so it has no calendar time and that property is empty.
systemctl list-timers --no-pager franki-update.timer
