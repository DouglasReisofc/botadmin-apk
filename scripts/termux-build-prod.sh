#!/data/data/com.termux/files/usr/bin/sh
set -e

export PATH=/data/data/com.termux/files/usr/bin:/data/data/com.termux/files/usr/bin/applets:/system/bin
export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS=--max-old-space-size=2048

cd /data/data/com.termux/files/home/botadm
/data/data/com.termux/files/usr/bin/node /data/data/com.termux/files/home/botadm/node_modules/next/dist/bin/next build --webpack /data/data/com.termux/files/home/botadm > /data/data/com.termux/files/home/botadm/build.log 2>&1
echo "build-done"
