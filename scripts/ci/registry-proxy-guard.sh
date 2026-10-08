#!/usr/bin/env bash
# =============================================================================
# registry-proxy-guard.sh — tvar volitelné pull-through cache pro Docker Hub.
# =============================================================================
# NAMĚŘENO 2026-09-13 na upstream PR #955: „Cold-start: apply" padl po 43 s
# ještě PŘED první SQL:
#
#   FROM ${REGISTRY_PROXY}pgvector/pgvector:pg17
#   ERROR: … registry-1.docker.io … 429 Too Many Requests
#
# Dockerfile prefix deklaruje (hlídá dockerfile-cache-prefix.gate), cache
# `REGISTRY_PROXY` byla deklarovaná — ale workflow ji do kroku nepředával, takže
# `${REGISTRY_PROXY}` byl prázdný a sdílený runner narazil na anonymní limit
# Docker Hubu. Lék je PŘEDÁNÍ (každé `docker build` nese
# `--build-arg REGISTRY_PROXY`), ne povinná cache.
#
# Cache je VOLITELNÁ (veřejný kód nesmí záviset na soukromé infrastruktuře):
#   · prázdná  → obrazy se stahují přímo z Docker Hubu; řekne se to nahlas;
#   · nastavená → musí to být PREFIX obrazu, tedy končit lomítkem (`<host>/`),
#     jinak by vzniklo `<host>pgvector/…` → exit 1 (špatný tvar není volba).
#
# Usage (CI krok, před `docker build`/`docker run` obrazu z Docker Hubu):
#   bash scripts/ci/registry-proxy-guard.sh
# Obrazy z jiných registrů (quay.io, ghcr.io) cache NEVYDÁ — ty zůstávají bez
# prefixu (quay.io/minio/mc přes cache: 404, změřeno 2026-09-13).
# =============================================================================
set -euo pipefail

if [ -z "${REGISTRY_PROXY:-}" ]; then
  echo "registry-proxy-guard: REGISTRY_PROXY nenastavená — obrazy z Docker Hubu se stahují přímo (pull-through cache je volitelná: proměnná REGISTRY_PROXY='<cache-host>/')."
  exit 0
fi

case "$REGISTRY_PROXY" in
  */) ;;
  *)
    echo "::error title=registry-proxy-guard::REGISTRY_PROXY='${REGISTRY_PROXY}' nekončí lomítkem — je to prefix obrazu, výsledek by byl '${REGISTRY_PROXY}pgvector/pgvector:…'." >&2
    exit 1
    ;;
esac

echo "registry-proxy-guard: obrazy z Docker Hubu přes ${REGISTRY_PROXY}"
