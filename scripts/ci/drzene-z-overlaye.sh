#!/usr/bin/env bash
# ============================================================================
# drzene-z-overlaye.sh — deklarace DRŽENÍ aplikací z overlaye instance
# (job deploy-zacatek; výstup čtou vlnové úlohy a deploy-verdikt)
#
# Tvar a pravidla deklarace: scripts/lib/nasazeni-drzene.mjs.
#
# Vstup (env):
#   OVERLAY_REPO            secret INSTANCE_OVERLAY_REPO (host/vlastník/repo);
#                           prázdný = instance BEZ overlaye → nic drženo
#   OVERLAY_TOKEN_PRIMARY   token pro klon (pořadí jako lane overlay-gates)
#   OVERLAY_TOKEN_FALLBACK
#   GITHUB_OUTPUT           kam zapsat output `drzene` (kompaktní JSON pole)
#
# ⛔ Overlay DEKLAROVANÝ, ale NEČITELNÝ = PÁD (kód 1), ne „nic drženo“ (rozhodnutí
# 2026-10-02). Držení existuje, aby se aplikace NEnasadila tam, kde by to
# škodilo: na instanci, která má proměnné doručené, by nečitelná deklarace
# aplikaci NASADILA a odpojila data na prázdný svazek — fail-open přesně tam,
# kde má držení chránit. Nevíme, co je drženo = nevíme, co smíme nasadit.
# Neplatná deklarace (bez důvodu, neznámá aplikace, aplikace přímé úlohy) = pád.
# ============================================================================
set -uo pipefail

vystup() {
  echo "  výstup: drzene=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then printf 'drzene=%s\n' "$1" >> "$GITHUB_OUTPUT"; fi
}

if [ -z "${OVERLAY_REPO:-}" ]; then
  echo "::notice title=držení aplikací::instance nemá overlay (INSTANCE_OVERLAY_REPO) — nic drženo."
  vystup '[]'
  exit 0
fi

# Klonuje jediný pomocník repa: opakuje a důvod nezdaru VYSLOVÍ s redakcí
# pověření v URL (brána klon-nesmi-zahodit-duvod).
. "$(dirname "$0")/../lib/git-klon.sh"

PRACOVNI="$(mktemp -d)"
trap 'rm -rf "$PRACOVNI"' EXIT
CIL="$PRACOVNI/overlay"
NACTENO=0
for T in "${OVERLAY_TOKEN_PRIMARY:-}" "${OVERLAY_TOKEN_FALLBACK:-}"; do
  [ -n "$T" ] || continue
  if klonuj "https://oauth2:${T}@${OVERLAY_REPO#https://}" "$CIL"; then
    NACTENO=1
    break
  fi
done
if [ "$NACTENO" -ne 1 ]; then
  echo "::error title=deklarace držení NEČITELNÁ::overlay instance je deklarovaný (INSTANCE_OVERLAY_REPO), ale žádným tokenem (REPO_API_TOKEN, FORGEJO_API_TOKEN) se ho nepodařilo naklonovat. Nevíme, co je drženo, takže nevíme, co smíme nasadit — NENASAZUJI. „Nic drženo“ by bylo fail-open: aplikaci s doručenými proměnnými by nasadilo a odpojilo data."
  exit 1
fi
echo "overlay instance @ $(git -C "$CIL" rev-parse --short HEAD)"

if ! DRZENE="$(node scripts/lib/nasazeni-drzene.mjs --soubor "$CIL/nasazeni-drzene.json")"; then
  exit 1
fi
# Prázdný výstup při kódu 0 = validátor neřekl NIC: nevíme, co je drženo (ne „nic drženo“).
if [ -z "$DRZENE" ]; then
  echo "::error title=deklarace držení::validátor skončil bez výstupu — nevíme, co je drženo, NENASAZUJI."
  exit 1
fi
if [ "$DRZENE" = "[]" ]; then
  echo "deklarace držení: žádná aplikace není držena"
else
  if ! node -e '
    for (const p of JSON.parse(process.argv[1]))
      console.log(`::warning title=DRŽENO: ${p.aplikace}::${p.duvod} — rozhodnutí ${p.kdo} ${p.datum} (${p.odkaz}); drženo od ${p.datum} (${p.dni} dní). Vlny ji přeskočí, další pokračují.`);
  ' "$DRZENE"; then
    echo "::error title=deklarace držení::výstup validátoru nejde přečíst jako JSON — nevíme, co je drženo, NENASAZUJI."
    exit 1
  fi
fi
vystup "$DRZENE"
