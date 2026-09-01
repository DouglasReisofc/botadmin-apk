#!/data/data/com.termux/files/usr/bin/sh
set -e

export PATH=/data/data/com.termux/files/usr/bin:/data/data/com.termux/files/usr/bin/applets:/system/bin
export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
export NEXT_TELEMETRY_DISABLED=1

cd /data/data/com.termux/files/home/botadm
nohup /data/data/com.termux/files/usr/bin/node /data/data/com.termux/files/home/botadm/node_modules/next/dist/bin/next start -H 0.0.0.0 -p 4478 > /data/data/com.termux/files/home/botadm/prod.log 2>&1 &
echo "started"
