#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DEPLOY_HOST="${BOTADMIN_DEPLOY_HOST:-root@163.176.27.82}"
readonly REMOTE_APP_DIR="${BOTADMIN_REMOTE_APP_DIR:-/opt/botadmin/app}"
readonly REMOTE_MANAGER="/usr/local/sbin/botadmin-blue-green"
readonly DEFAULT_DEPLOY_KEY="/home/Dev7766/.ssh/botadmin_deploy_ed25519"
readonly DEPLOY_KEY="${BOTADMIN_DEPLOY_KEY:-$DEFAULT_DEPLOY_KEY}"

ssh_base=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
rsync_ssh="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

if [[ -s "$DEPLOY_KEY" ]]; then
  ssh_base+=( -i "$DEPLOY_KEY" -o IdentitiesOnly=yes )
  rsync_ssh+=" -i $DEPLOY_KEY -o IdentitiesOnly=yes"
fi

if [[ -n "${BOTADMIN_SSH_PASSWORD:-}" ]]; then
  command -v sshpass >/dev/null || { echo "sshpass é necessário para usar BOTADMIN_SSH_PASSWORD." >&2; exit 1; }
  ssh_base=(sshpass -e ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
  rsync_ssh="sshpass -e ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
  export SSHPASS="$BOTADMIN_SSH_PASSWORD"
fi

remote() {
  "${ssh_base[@]}" "$DEPLOY_HOST" "$@"
}

sync_remote_manager() {
  # Keep the VPS-side promotion script in lockstep with the repository.  This
  # is especially important for the private webhook relay used by EasyZap.
  rsync -az -e "$rsync_ssh" \
    "$PROJECT_DIR/scripts/botadmin-blue-green-remote.sh" \
    "${DEPLOY_HOST}:/tmp/botadmin-blue-green-remote.sh"
  remote "install -m 0755 /tmp/botadmin-blue-green-remote.sh '$REMOTE_MANAGER'"
}

sync_remote_manager

case "${1:-deploy}" in
  --status)
    remote "$REMOTE_MANAGER" status
    exit 0
    ;;
  --rollback)
    remote "$REMOTE_MANAGER" rollback
    exit 0
    ;;
  deploy|--deploy) ;;
  *) echo "Uso: $0 [--status|--rollback]" >&2; exit 2 ;;
esac

cd "$PROJECT_DIR"
[[ -s .next/BUILD_ID ]] || {
  echo "Build ausente. Execute npm run build:web ou use npm run deploy:bluegreen." >&2
  exit 1
}
[[ -d .next/server && -d .next/static && -d public ]] || {
  echo "Build incompleto: .next/server, .next/static ou public ausente." >&2
  exit 1
}

build_id="$(<.next/BUILD_ID)"
target="$(remote "$REMOTE_MANAGER" inactive | tr -d '[:space:]')"
[[ "$target" == blue || "$target" == green ]] || {
  echo "O servidor retornou um slot inválido: ${target:-vazio}." >&2
  exit 1
}

incoming="${REMOTE_APP_DIR}/.next-${target}.incoming-${build_id}"
echo "Publicando build ${build_id} uma única vez no slot inativo ${target}..."
remote "install -d -m 0755 '$incoming' '$REMOTE_APP_DIR/public'"

rsync -az --delete --exclude='/cache/***' --exclude='/diagnostics/***' \
  -e "$rsync_ssh" .next/ "${DEPLOY_HOST}:${incoming}/"

# Public é compartilhado pelos dois processos; uploads/downloads gerados em
# produção nunca são apagados pelo deploy.
rsync -az --delete-delay \
  --exclude='/uploads/***' --exclude='/downloads/***' \
  -e "$rsync_ssh" public/ "${DEPLOY_HOST}:${REMOTE_APP_DIR}/public/"

local_lock_hash="$(sha256sum package-lock.json | awk '{print $1}')"
remote_lock_hash="$(remote "sha256sum '$REMOTE_APP_DIR/package-lock.json' 2>/dev/null | cut -d' ' -f1" || true)"
rsync -az -e "$rsync_ssh" package.json package-lock.json next.config.ts \
  "${DEPLOY_HOST}:${REMOTE_APP_DIR}/"
rsync -az --delete -e "$rsync_ssh" shims/ "${DEPLOY_HOST}:${REMOTE_APP_DIR}/shims/"
# The mobile update manifest is read at runtime by /api/mobile/update. Keep it
# synchronized with the web build so APKs published to GitHub are detected
# even when the VPS cannot reach the GitHub API.
rsync -az -e "$rsync_ssh" data/mobile-artifacts.json "${DEPLOY_HOST}:${REMOTE_APP_DIR}/data/mobile-artifacts.json"

if [[ "$local_lock_hash" != "$remote_lock_hash" ]]; then
  echo "Dependências mudaram; atualizando-as antes da troca de tráfego..."
  remote "cd '$REMOTE_APP_DIR' && /opt/node-v20.20.2/bin/npm install --omit=dev --no-audit --no-fund"
fi

remote "set -e; \
  test -s '$incoming/BUILD_ID'; \
  if [ -d '$REMOTE_APP_DIR/.next-$target' ]; then \
    mv '$REMOTE_APP_DIR/.next-$target' '$REMOTE_APP_DIR/.next-$target.previous-$(date +%Y%m%d%H%M%S)'; \
  fi; \
  mv '$incoming' '$REMOTE_APP_DIR/.next-$target'; \
  '$REMOTE_MANAGER' promote '$target'"

echo "Versão pública validada em https://botadmin.shop (slot ${target})."
