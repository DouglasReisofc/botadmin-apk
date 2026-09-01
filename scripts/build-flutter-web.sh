#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
flutter_bin="${FLUTTER_BIN:-}"

if [[ -z "$flutter_bin" ]] && command -v flutter >/dev/null 2>&1; then
  flutter_bin="$(command -v flutter)"
fi
if [[ -z "$flutter_bin" ]] && [[ -x /root/.local/share/flutter/bin/flutter ]]; then
  flutter_bin=/root/.local/share/flutter/bin/flutter
fi
if [[ -z "$flutter_bin" ]] && [[ -x /opt/flutter/bin/flutter ]]; then
  flutter_bin=/opt/flutter/bin/flutter
fi

[[ -x "$flutter_bin" ]] || {
  echo "Flutter SDK não encontrado. Defina FLUTTER_BIN com o executável do Flutter." >&2
  exit 1
}

cd "$project_root/flutter_panel"
"$flutter_bin" build web --release \
  --base-href /dashboard/user/ \
  --no-web-resources-cdn
