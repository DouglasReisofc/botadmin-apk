#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
flutter_project="$project_root/flutter_panel"
env_file="$project_root/.env"
keystore_file="$project_root/botadmin-release.jks"

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
  echo "Flutter SDK nao encontrado. Defina FLUTTER_BIN com o executavel do Flutter." >&2
  exit 1
}
[[ -f "$env_file" ]] || {
  echo "Arquivo de ambiente ausente: $env_file" >&2
  exit 1
}
[[ -f "$keystore_file" ]] || {
  echo "Chave de assinatura ausente: $keystore_file" >&2
  exit 1
}

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

export ANDROID_KEYSTORE="$keystore_file"
export ANDROID_KEYSTORE_FILE="$keystore_file"
api_base_url="${BOTADMIN_API_BASE_URL:-https://botadmin.shop}"

cd "$flutter_project"
"$flutter_bin" pub get
"$flutter_bin" build apk --release \
  --dart-define="BOTADMIN_API_BASE_URL=$api_base_url" \
  "$@"

version="$(awk '$1 == "version:" { print $2; exit }' pubspec.yaml)"
release_name="botadmin-${version/+/-}-android-release.apk"
release_path="$project_root/releases/$release_name"
install -D -m 0644 build/app/outputs/flutter-apk/app-release.apk "$release_path"

echo "APK gerado: $release_path"
sha256sum "$release_path"
