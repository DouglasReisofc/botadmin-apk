#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="/opt/botadmin/app"
readonly STATE_DIR="/opt/botadmin/bluegreen"
readonly ACTIVE_FILE="${STATE_DIR}/active-slot"
readonly PREVIOUS_FILE="${STATE_DIR}/previous-slot"
readonly LOCK_FILE="${STATE_DIR}/deployment.lock"
readonly UPSTREAM_FILE="/www/server/panel/vhost/nginx/00-botadmin-bluegreen-upstream.conf"
readonly WEBHOOK_RELAY_FILE="/www/server/panel/vhost/nginx/00-botadmin-webhook-relay.conf"
readonly NGINX_BIN="/usr/bin/nginx"
readonly HEALTH_PATH="/api/public/site"

slot_port() {
  case "${1:-}" in
    legacy|blue) printf '4322\n' ;;
    green) printf '4323\n' ;;
    *) echo "Slot inválido: ${1:-vazio}" >&2; return 2 ;;
  esac
}

slot_service() {
  case "${1:-}" in
    legacy) printf 'botadmin.service\n' ;;
    blue|green) printf 'botadmin-bluegreen@%s.service\n' "$1" ;;
    *) echo "Slot inválido: ${1:-vazio}" >&2; return 2 ;;
  esac
}

active_slot() {
  if [[ -s "$ACTIVE_FILE" ]]; then
    tr -d '[:space:]' < "$ACTIVE_FILE"
  else
    printf 'legacy\n'
  fi
}

inactive_slot() {
  case "$(active_slot)" in
    legacy|blue) printf 'green\n' ;;
    green) printf 'blue\n' ;;
  esac
}

write_slot_env() {
  local slot="$1" background_disabled="$2" port dist
  port="$(slot_port "$slot")"
  dist=".next-${slot}"
  umask 022
  {
    printf 'PORT=%s\n' "$port"
    printf 'NEXT_DIST_DIR=%s\n' "$dist"
    printf 'BOTADMIN_DISABLE_BACKGROUND_JOBS=%s\n' "$background_disabled"
  } > "${STATE_DIR}/${slot}.env.tmp"
  mv "${STATE_DIR}/${slot}.env.tmp" "${STATE_DIR}/${slot}.env"
}

write_upstream() {
  local primary="$1" fallback="${2:-}" primary_port fallback_port
  primary_port="$(slot_port "$primary")"
  {
    printf '%s\n' 'upstream botadmin_bluegreen {'
    printf '%s\n' '    zone botadmin_bluegreen 64k;'
    printf '    server 127.0.0.1:%s max_fails=2 fail_timeout=3s;\n' "$primary_port"
    if [[ -n "$fallback" && "$fallback" != "$primary" ]]; then
      fallback_port="$(slot_port "$fallback")"
      if [[ "$fallback_port" != "$primary_port" ]]; then
        printf '    server 127.0.0.1:%s backup;\n' "$fallback_port"
      fi
    fi
    printf '%s\n' '    keepalive 64;'
    printf '%s\n' '}'
  } > "${UPSTREAM_FILE}.tmp"
  mv "${UPSTREAM_FILE}.tmp" "$UPSTREAM_FILE"
}

ensure_webhook_relay() {
  # EasyZap runs with host networking.  Keep its callback on a private,
  # stable port; the relay forwards to the same blue/green upstream used by
  # the public site, so deployments never leave webhooks pointing at a dead
  # slot (4322/4323).
  cat > "${WEBHOOK_RELAY_FILE}.tmp" <<'EOF'
# Internal-only relay for EasyZap webhooks. The upstream follows the active
# blue/green BotAdmin slot without requiring EasyZap restarts on deploy.
server {
    listen 127.0.0.1:4324;
    server_name _;
    client_max_body_size 50m;
    location / {
        # The local durable spool acknowledges immediately and drains into
        # whichever blue/green slot is active.
        proxy_pass http://127.0.0.1:4325;
        proxy_http_version 1.1;
        proxy_set_header Host botadmin.shop;
        proxy_set_header X-Real-IP 127.0.0.1;
        proxy_set_header X-Forwarded-For 127.0.0.1;
        proxy_set_header Connection "";
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_connect_timeout 10s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
        # Retry on the standby slot when the active app is restarting or
        # temporarily saturated so EasyZap never drops a live webhook.
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503 http_504;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 30s;
    }
}
EOF
  if [[ ! -f "$WEBHOOK_RELAY_FILE" ]] || ! cmp -s "${WEBHOOK_RELAY_FILE}.tmp" "$WEBHOOK_RELAY_FILE"; then
    mv "${WEBHOOK_RELAY_FILE}.tmp" "$WEBHOOK_RELAY_FILE"
  else
    rm -f "${WEBHOOK_RELAY_FILE}.tmp"
  fi
}

reload_nginx() {
  "$NGINX_BIN" -t
  # aaPanel starts Nginx directly, so there may be no active nginx.service.
  # The native signal reload is graceful and keeps current connections alive.
  "$NGINX_BIN" -s reload
}

wait_for_health() {
  local slot="$1" port deadline status
  port="$(slot_port "$slot")"
  deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    status="$(curl --silent --show-error --max-time 5 --output /dev/null \
      --write-out '%{http_code}' --header 'Host: botadmin.shop' \
      "http://127.0.0.1:${port}${HEALTH_PATH}" 2>/dev/null || true)"
    if [[ "$status" == "200" ]]; then
      return 0
    fi
    sleep 2
  done
  echo "Health check falhou no slot ${slot} (porta ${port})." >&2
  return 1
}

start_slot() {
  local slot="$1" standby="$2" service
  if [[ "$slot" == "legacy" ]]; then
    systemctl start botadmin.service
  else
    [[ -s "${APP_DIR}/.next-${slot}/BUILD_ID" ]] || {
      echo "Build do slot ${slot} não encontrado." >&2
      return 1
    }
    write_slot_env "$slot" "$standby"
    systemctl daemon-reload
    service="$(slot_service "$slot")"
    systemctl restart "$service"
  fi
  wait_for_health "$slot"
}

stop_slot() {
  local slot="$1"
  local service
  service="$(slot_service "$slot")"
  systemctl stop "$service" || true
  systemctl reset-failed "$service" >/dev/null 2>&1 || true
}

promote() {
  local target="$1" old target_service old_service
  old="$(active_slot)"
  [[ "$target" == "blue" || "$target" == "green" ]] || {
    echo "O destino deve ser blue ou green." >&2
    return 2
  }
  [[ "$target" != "$old" ]] || {
    echo "O slot ${target} já está ativo."
    return 0
  }
  [[ "$target" != "blue" || "$old" != "legacy" ]] || {
    echo "O primeiro destino precisa ser green porque legacy e blue usam a porta 4322." >&2
    return 2
  }

  echo "[1/5] Iniciando ${target} em modo de validação..."
  start_slot "$target" 1

  echo "[2/5] Trocando o Nginx para ${target}, com ${old} como fallback..."
  write_upstream "$target" "$old"
  if ! reload_nginx; then
    write_upstream "$old" "$target"
    reload_nginx || true
    stop_slot "$target"
    return 1
  fi

  echo "[3/5] Ativando as tarefas protegidas por lease Redis..."
  write_slot_env "$target" 0
  target_service="$(slot_service "$target")"
  systemctl restart "$target_service"
  if ! wait_for_health "$target"; then
    echo "A nova versão falhou depois da ativação; restaurando ${old}." >&2
    start_slot "$old" 0 || true
    write_upstream "$old" "$target"
    reload_nginx || true
    stop_slot "$target"
    return 1
  fi

  echo "[4/5] Mantendo a versão anterior como standby seguro..."
  sleep 5
  systemctl enable "$target_service" >/dev/null
  if [[ "$old" == "blue" || "$old" == "green" ]]; then
    # The Nginx upstream keeps the previous slot as backup.  It must remain
    # alive; otherwise two transient failures on the active process mark it
    # down and Nginx has no live upstream, producing a burst of 502s.  The
    # standby runs the same application but never starts schedulers/workers.
    write_slot_env "$old" 1
    old_service="$(slot_service "$old")"
    systemctl restart "$old_service"
    if wait_for_health "$old"; then
      systemctl enable "$old_service" >/dev/null
    else
      echo "Standby ${old} indisponível; removendo-o do upstream." >&2
      write_upstream "$target"
      reload_nginx
      systemctl disable "$old_service" >/dev/null || true
      stop_slot "$old"
    fi
  else
    # legacy shares port 4322 with blue and cannot be retained beside it.
    # Do not leave a stopped process advertised as a backup.
    systemctl disable "$(slot_service "$old")" >/dev/null || true
    stop_slot "$old"
    write_upstream "$target"
    reload_nginx
  fi

  printf '%s\n' "$old" > "${PREVIOUS_FILE}.tmp"
  mv "${PREVIOUS_FILE}.tmp" "$PREVIOUS_FILE"
  printf '%s\n' "$target" > "${ACTIVE_FILE}.tmp"
  mv "${ACTIVE_FILE}.tmp" "$ACTIVE_FILE"

  echo "[5/5] Validando o endereço público..."
  curl --fail --silent --show-error --max-time 15 --output /dev/null \
    --resolve 'botadmin.shop:443:127.0.0.1' https://botadmin.shop/api/public/site
  echo "Deploy concluído: ${old} -> ${target}."
}

rollback() {
  local current previous
  current="$(active_slot)"
  [[ -s "$PREVIOUS_FILE" ]] || {
    echo "Não existe slot anterior registrado para rollback." >&2
    return 1
  }
  previous="$(tr -d '[:space:]' < "$PREVIOUS_FILE")"
  [[ "$previous" != "$current" ]] || {
    echo "Slot anterior inválido: ${previous}." >&2
    return 1
  }

  echo "Iniciando rollback ${current} -> ${previous}..."
  if [[ "$previous" == "legacy" ]]; then
    start_slot legacy 0
    write_upstream legacy "$current"
    reload_nginx
    sleep 3
    systemctl enable botadmin.service >/dev/null
    systemctl disable "$(slot_service "$current")" >/dev/null || true
    stop_slot "$current"
    printf '%s\n' "$current" > "$PREVIOUS_FILE"
    printf '%s\n' legacy > "$ACTIVE_FILE"
    echo "Rollback concluído para legacy."
  else
    promote "$previous"
  fi
}

status() {
  local active inactive slot service service_state port http_status build_id
  active="$(active_slot)"
  inactive="$(inactive_slot)"
  printf 'active=%s\ninactive=%s\n' "$active" "$inactive"
  for slot in legacy blue green; do
    service="$(slot_service "$slot")"
    service_state="$(systemctl is-active "$service" 2>/dev/null || true)"
    port="$(slot_port "$slot")"
    http_status='-'
    if [[ "$service_state" == active ]]; then
      http_status="$(curl --silent --max-time 2 --output /dev/null --write-out '%{http_code}' \
        --header 'Host: botadmin.shop' "http://127.0.0.1:${port}${HEALTH_PATH}" 2>/dev/null || true)"
    fi
    build_id='-'
    if [[ "$slot" == legacy && -s "${APP_DIR}/.next/BUILD_ID" ]]; then
      build_id="$(<"${APP_DIR}/.next/BUILD_ID")"
    elif [[ "$slot" != legacy && -s "${APP_DIR}/.next-${slot}/BUILD_ID" ]]; then
      build_id="$(<"${APP_DIR}/.next-${slot}/BUILD_ID")"
    fi
    printf '%s service=%s health=%s port=%s build=%s\n' \
      "$slot" "$service_state" "${http_status:-000}" "$port" "$build_id"
  done
}

init() {
  install -d -m 0755 "$STATE_DIR"
  [[ -s "$ACTIVE_FILE" ]] || printf '%s\n' legacy > "$ACTIVE_FILE"
  write_slot_env blue 1
  write_slot_env green 1
  write_upstream "$(active_slot)"
  ensure_webhook_relay
  systemctl daemon-reload
  "$NGINX_BIN" -t && "$NGINX_BIN" -s reload
  echo "Blue/green inicializado com $(active_slot) ativo."
}

main() {
  install -d -m 0755 "$STATE_DIR"
  exec 9>"$LOCK_FILE"
  flock -n 9 || { echo "Já existe um deploy blue/green em execução." >&2; exit 1; }
  case "${1:-status}" in
    init) init ;;
    active) active_slot ;;
    inactive) inactive_slot ;;
    promote) promote "${2:-}" ;;
    rollback) rollback ;;
    status) status ;;
    *) echo "Uso: $0 {init|active|inactive|promote blue|promote green|rollback|status}" >&2; exit 2 ;;
  esac
}

main "$@"
