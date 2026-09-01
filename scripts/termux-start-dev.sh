#!/data/data/com.termux/files/usr/bin/sh
set -e

export PATH=/data/data/com.termux/files/usr/bin:/data/data/com.termux/files/usr/bin/applets:/system/bin
export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
export PUPPETEER_SKIP_DOWNLOAD=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

cd /data/data/com.termux/files/home/botadm
nohup /data/data/com.termux/files/usr/bin/node /data/data/com.termux/files/home/botadm/node_modules/next/dist/bin/next dev --webpack -H 0.0.0.0 -p 4478 > /data/data/com.termux/files/home/botadm/dev.log 2>&1 &
echo "started"
