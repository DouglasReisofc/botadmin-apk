#!/data/data/com.termux/files/usr/bin/sh
set -e

export PATH=/data/data/com.termux/files/usr/bin:/data/data/com.termux/files/usr/bin/applets:/system/bin
export HOME=/data/data/com.termux/files/home

TOKEN="eyJhIjoiOTg3NGUwNjdmYTIwZDcyM2NiMzU1YzQ3YWQzZGM0ZDkiLCJ0IjoiNTAzOWMxMWEtOTk2MS00MGM5LTg5YzMtN2JiNGYwOGUyZjcwIiwicyI6Ik5UbGhObVExTURBdE9UVmhPUzAwTnpkaUxUZzJaRE10TnpkbE4yUmlaR0V5TUdFMyJ9"

nohup /data/data/com.termux/files/usr/bin/cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:0 run --token "$TOKEN" > /data/data/com.termux/files/home/cloudflared.log 2>&1 &
echo "started"
