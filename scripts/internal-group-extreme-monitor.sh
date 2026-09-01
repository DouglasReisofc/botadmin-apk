#!/usr/bin/env bash
set -u

stress_unit="botadmin-internal-extreme.service"
app_unit="botadmin.service"
failure_count=0

while systemctl is-active --quiet "$stress_unit"; do
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  available_kb="$(awk '/MemAvailable:/{print $2}' /proc/meminfo)"
  app_memory="$(systemctl show "$app_unit" -p MemoryCurrent --value)"
  app_restarts="$(systemctl show "$app_unit" -p NRestarts --value)"
  load_average="$(awk '{print $1}' /proc/loadavg)"
  http_code="$(curl -sS -o /dev/null -m 4 -w '%{http_code}' https://botadmin.shop/ || true)"

  if [[ "$http_code" == "200" || "$http_code" == "302" || "$http_code" == "307" ]]; then
    failure_count=0
  else
    failure_count=$((failure_count + 1))
  fi

  printf '{"at":"%s","availableKb":%s,"appMemory":%s,"appRestarts":%s,"load1":"%s","http":%s,"failures":%s}\n' \
    "$timestamp" "${available_kb:-0}" "${app_memory:-0}" "${app_restarts:-0}" \
    "$load_average" "${http_code:-0}" "$failure_count"

  if ! systemctl is-active --quiet "$app_unit"; then
    printf '{"event":"safety-stop","reason":"app-inactive"}\n'
    systemctl stop "$stress_unit"
    exit 2
  fi
  if (( available_kb < 1048576 )); then
    printf '{"event":"safety-stop","reason":"memory-below-1GiB"}\n'
    systemctl stop "$stress_unit"
    exit 3
  fi
  if (( app_memory > 8589934592 )); then
    printf '{"event":"safety-stop","reason":"app-memory-above-8GiB"}\n'
    systemctl stop "$stress_unit"
    exit 4
  fi
  if (( failure_count >= 3 )); then
    printf '{"event":"safety-stop","reason":"three-http-health-failures"}\n'
    systemctl stop "$stress_unit"
    exit 5
  fi
  sleep 5
done

printf '{"event":"monitor-completed"}\n'
