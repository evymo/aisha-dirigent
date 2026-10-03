#!/usr/bin/env bash
# =============================================================================
# registry-proxy-guard.sh — obrazy z Docker Hubu jdou v CI přes pull-through cache.
# =============================================================================
# NAMĚŘENO 2026-09-13 na upstream PR #955: „Cold-start: apply" padl po 43 s
# ještě PŘED první SQL:
#
#   FROM ${REGISTRY_PROXY}pgvector/pgvector:pg17
#   ERROR: … registry-1.docker.io … 429 Too Many Requests
#
# Dockerfile prefix deklaruje (hlídá dockerfile-cache-prefix.gate), proměnná
# `REGISTRY_PROXY` v Forgejo organizaci existuje — ale workflow ji do kroku
# nepředával, takže `${REGISTRY_PROXY}` byl prázdný a sdílený runner narazil na
# anonymní limit Docker Hubu. Červená gate pak vypadá jako vada PR, přitom kód
# vůbec neběžel.
#
# Fail-loud (žádné fallbacky): prázdná proměnná NENÍ „jdi rovnou na Docker Hub",
# je to nedeklarovaný vstup → exit 1. Hodnota je PREFIX obrazu, proto musí
# končit lomítkem (`<host>/`), jinak by vzniklo `<host>pgvector/…`.
#
# Usage (CI krok, před `docker build`/`docker run` obrazu z Docker Hubu):
#   bash scripts/ci/registry-proxy-guard.sh
# Obrazy z jiných registrů (quay.io, ghcr.io) cache NEVYDÁ — ty zůstávají bez
# prefixu (quay.io/minio/mc přes cache: 404, změřeno 2026-09-13).
# =============================================================================
set -euo pipefail

if [ -z "${REGISTRY_PROXY:-}" ]; then
  echo "::error title=registry-proxy-guard::REGISTRY_PROXY je PRÁZDNÝ — obraz z Docker Hubu by šel přímo na registry-1.docker.io a sdílený runner narazí na limit 429. Nastav proměnnou REGISTRY_PROXY (org/repo variables) na pull-through cache, např. '<cache-host>/'." >&2
  exit 1
fi

case "$REGISTRY_PROXY" in
  */) ;;
  *)
    echo "::error title=registry-proxy-guard::REGISTRY_PROXY='${REGISTRY_PROXY}' nekončí lomítkem — je to prefix obrazu, výsledek by byl '${REGISTRY_PROXY}pgvector/pgvector:…'." >&2
    exit 1
    ;;
esac

echo "registry-proxy-guard: obrazy z Docker Hubu přes ${REGISTRY_PROXY}"
