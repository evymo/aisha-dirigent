#!/usr/bin/env bash
# capture.sh — přegeneruje diffy v `diff/` proti AKTUÁLNĚ BĚŽÍCÍMU Coolify.
#
# ⛔ POUŽITÍ: jen po vědomé změně (bump verze Coolify, nová úprava). Vezme
# rozdíl mezi vrstvou obrazu a běžícím kontejnerem a zapíše ho sem — takže
# ZACHYCUJE stav, nenarovnává ho. Narovnává `apply-coolify-patch.sh`.
#
# ⛔ Spouští se NA STROJI, kde Coolify běží (`ssh talos`), stejně jako
# `infra/sentry/apply-host-config.sh`.
#
# Po bumpu verze: uprav `coolify.env`, spusť tohle, přečti `git diff` a teprve
# pak commituj. Diff proti nové vrstvě obrazu může být mnohem větší, než čekáš —
# a to je informace, ne překážka.
set -euo pipefail

KDE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEKLARACE="$KDE/coolify.env"
[ -f "$DEKLARACE" ] || { echo "chybí deklarace: $DEKLARACE" >&2; exit 2; }
set -a; . "$DEKLARACE"; set +a
: "${COOLIFY_CONTAINER:?coolify.env musí deklarovat COOLIFY_CONTAINER}"
: "${COOLIFY_IMAGE:?coolify.env musí deklarovat COOLIFY_IMAGE}"

BEZI="$(docker inspect -f '{{.Config.Image}}' "$COOLIFY_CONTAINER")"
if [ "$BEZI" != "$COOLIFY_IMAGE" ]; then
  echo "⛔ Coolify běží na '$BEZI', coolify.env deklaruje '$COOLIFY_IMAGE'." >&2
  echo "   Sjednoť to VĚDOMĚ — zachytávat diff proti cizí verzi nemá smysl." >&2
  exit 3
fi

# Univerzum se HLEDÁ: porovná se celý strom `app/`, ne ručně psaný seznam.
# Ručně psaný seznam by novou úpravu tiše minul — a právě tak vznikl stav,
# kvůli kterému tenhle adresář existuje.
mkdir -p "$KDE/diff"
stock="$(mktemp -d)"; live="$(mktemp -d)"
docker run --rm --entrypoint sh "$COOLIFY_IMAGE" -c \
  'cd /var/www/html && find app -name "*.php" -exec md5sum {} +' | sort -k2 > "$stock/md5"
docker exec "$COOLIFY_CONTAINER" sh -c \
  'cd /var/www/html && find app -name "*.php" -exec md5sum {} +' | sort -k2 > "$live/md5"

zmenene="$(join -j 2 "$stock/md5" "$live/md5" | awk '$2 != $3 {print $1}')"
[ -n "$zmenene" ] || { echo "  žádné úpravy — diff/ ponechán beze změny"; exit 0; }

rm -f "$KDE"/diff/*.patch
pocet=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  n="$(echo "$f" | tr '/' '_')"
  docker run --rm --entrypoint sh "$COOLIFY_IMAGE" -c "cat '/var/www/html/$f'" > "$stock/$n"
  docker exec "$COOLIFY_CONTAINER" sh -c "cat '/var/www/html/$f'" > "$live/$n"
  # --label: do repa jde jen relativní jméno, ne absolutní cesta stroje, kde
  # capture zrovna běžel (naměřeno 2026-09-11: pět patchů neslo cestu
  # ze scratchpadu jedné session). apply-coolify-patch.sh cíl dostává explicitně,
  # hlavičku nečte — jde o čistotu commitu, ne o funkci.
  diff -u --label "stock/$n" --label "live/$n" "$stock/$n" "$live/$n" > "$KDE/diff/$n.patch" || true
  printf '  zachyceno %-46s %s řádků\n' "$f" "$(grep -c '^[+-]' "$KDE/diff/$n.patch")"
  pocet=$((pocet+1))
done <<< "$zmenene"

rm -rf "$stock" "$live"
echo "  → $pocet souborů; zkontroluj \`git diff\` PŘED commitem"
