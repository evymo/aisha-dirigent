#!/usr/bin/env bash
# data-instance.sh <cíl> — mělký klon dat instance pro úlohy kiosk-balicky.
#
# Repo dat je tajemství forku INSTANCE_OVERLAY_REPO (host/vlastník/repo[.git]) —
# jméno instance do stacku nepatří. Token je KIOSK_BALICKY_TOKEN: týž, kterým
# úloha pak zakládá PR s deklarací, aby čtení i zápis stály na jednom oprávnění.
# Uživatel `x-access-token` přijímá GitHub pro PAT i token aplikace.
set -euo pipefail
CIL="${1:?cíl klonu}"
if [ -z "${DATA_REPO:-}" ]; then
  echo "::error title=kiosk-balicky::tajemství INSTANCE_OVERLAY_REPO není deklarované — bez dat instance není co stavět" >&2
  exit 1
fi
if [ -z "${KIOSK_BALICKY_TOKEN:-}" ]; then
  echo "::error title=kiosk-balicky::tajemství KIOSK_BALICKY_TOKEN není nastavené (čtení dat instance, zápis vydání do registru, PR do dat instance)" >&2
  exit 1
fi
git clone -q --depth 1 "https://x-access-token:${KIOSK_BALICKY_TOKEN}@${DATA_REPO#https://}" "$CIL"
echo "data instance @ $(git -C "$CIL" rev-parse --short HEAD)"
