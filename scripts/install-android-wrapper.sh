#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER_DIR="$ROOT_DIR/android/gradle/wrapper"
WRAPPER_JAR="$WRAPPER_DIR/gradle-wrapper.jar"
GRADLE_VERSION="8.11.1"
if [ -f "$WRAPPER_JAR" ] && [ -s "$WRAPPER_JAR" ]; then
  echo "Gradle wrapper já disponível em $WRAPPER_JAR"
  exit 0
fi
mkdir -p "$WRAPPER_DIR"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT
ZIP_FILE="$TMP_DIR/gradle.zip"
DOWNLOAD_URL="https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"
echo "Baixando wrapper do Gradle ${GRADLE_VERSION}..."
curl -L "$DOWNLOAD_URL" -o "$ZIP_FILE"
# Prefer the exact gradle-wrapper.jar (not the shared jar)
JAR_ENTRY="$(unzip -Z1 "$ZIP_FILE" "gradle-*/lib/gradle-wrapper.jar" | head -n 1)"
if [ -z "$JAR_ENTRY" ]; then
  # Fallback (older distributions/layouts)
  JAR_ENTRY="$(unzip -Z1 "$ZIP_FILE" "gradle-*/lib/gradle-wrapper-*.jar" | grep -i "/gradle-wrapper.jar$" | head -n 1)"
fi
if [ -z "$JAR_ENTRY" ]; then
  echo "Não foi possível localizar gradle-wrapper.jar em $DOWNLOAD_URL" >&2
  exit 1
fi
echo "Extraindo $JAR_ENTRY..."
unzip -p "$ZIP_FILE" "$JAR_ENTRY" > "$WRAPPER_JAR"
chmod 644 "$WRAPPER_JAR"
echo "Wrapper salvo em $WRAPPER_JAR"
