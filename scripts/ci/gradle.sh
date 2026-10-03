#!/usr/bin/env bash
# gradle.sh — Gradle pro build Kiosk Admina (apps/hlidac) v CI.
#
# Repo nenese Gradle wrapper (žádné binárky v gitu) a apps/hlidac/scripts/build.sh
# bere Gradle z $GRADLE. Distribuce se stahuje a OVĚŘUJE otiskem zapsaným tady:
# bez něj by se podepsaný balík pro tablety postavil čímkoli, co zrovna vrátil
# server.
set -euo pipefail
: "${GITHUB_ENV:?gradle.sh běží v CI (chybí GITHUB_ENV)}"

VERZE="8.14.3"
# https://services.gradle.org/distributions/gradle-8.14.3-bin.zip.sha256 (přečteno 2026-09-25)
OTISK="bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531"

CIL="$HOME/gradle-$VERZE"
if [ ! -x "$CIL/bin/gradle" ]; then
  curl -sSLo /tmp/gradle.zip "https://services.gradle.org/distributions/gradle-$VERZE-bin.zip"
  if ! echo "$OTISK  /tmp/gradle.zip" | sha256sum -c - >/dev/null; then
    echo "::error title=gradle::Gradle $VERZE — otisk distribuce NESEDÍ, build se nespustí" >&2
    exit 1
  fi
  unzip -q /tmp/gradle.zip -d "$HOME"
fi
echo "GRADLE=$CIL/bin/gradle" >> "$GITHUB_ENV"
