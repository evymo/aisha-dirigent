#!/usr/bin/env bash
# apply-coolify-patch.sh — JEDINÝ DOMOV úprav Coolify.
#
# ⛔ PROČ VZNIKL (naměřeno 2026-09-05 na Talosu).
#
# Šest PHP souborů Coolify bylo upravených POUZE v zapisovatelné vrstvě
# běžícího kontejneru. Změřeno takto:
#
#     obraz kontejneru  = sha256:f76979ac…  ==  tag coollabsio/coolify:4.3.16
#     náš text v OBRAZU:     0×      v KONTEJNERU: 4×
#     patch skript v obrazu: žádný   cron/systemd na hostiteli: žádný
#
# Na těch úpravách visí PŘENOS OBRAZŮ na cílový uzel, chunkování compose přes
# ARG_MAX a ochrany disku — tedy nasazování všech instancí. Jeden
# `--force-recreate` nebo self-update Coolify je smaže a nasazení se rozbije
# způsobem, který vypadá jako úplně jiná porucha.
#
# ⭐ Tenhle skript je proti tomu: patche mají domov v repu, aplikace je
# idempotentní a dá se spustit znovu po každé aktualizaci.
#
# ⛔ CO NEDĚLÁ: neaktualizuje Coolify a nerestartuje ho. Patch se zapíše do
# běžícího kontejneru; PHP se načítá per-request, takže restart není potřeba.
set -euo pipefail

KDE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ⛔ ŽÁDNÉ FALLBACKY. Verze i jméno kontejneru jsou vlastnosti nasazení, ne
# domněnky; bez deklarace skript skončí dřív, než na cokoli sáhne.
DEKLARACE="$KDE/coolify.env"
[ -f "$DEKLARACE" ] || { echo "chybí deklarace: $DEKLARACE" >&2; exit 2; }
set -a; . "$DEKLARACE"; set +a
: "${COOLIFY_CONTAINER:?coolify.env musí deklarovat COOLIFY_CONTAINER}"
: "${COOLIFY_IMAGE:?coolify.env musí deklarovat COOLIFY_IMAGE}"

REZIM="${1:---dry-run}"
case "$REZIM" in
  --apply|--dry-run|--check) ;;
  *) echo "neznámý přepínač: $REZIM (--apply | --dry-run | --check)" >&2; exit 2 ;;
esac

# ⛔ VERZE JE SOUČÁST PATCHE. Diffy jsou proti konkrétnímu obrazu; po bumpu
# Coolify se musí přepsat, ne aplikovat naslepo.
BEZI="$(docker inspect -f '{{.Config.Image}}' "$COOLIFY_CONTAINER")"
if [ "$BEZI" != "$COOLIFY_IMAGE" ]; then
  echo "⛔ Coolify běží na '$BEZI', patche jsou proti '$COOLIFY_IMAGE'." >&2
  echo "   Přegeneruj diffy proti nové verzi (capture.sh) — neaplikuju naslepo." >&2
  exit 3
fi

zmena=0
nesoulad=0
for patch in "$KDE"/diff/*.patch; do
  n="$(basename "$patch" .patch)"
  cil="/var/www/html/$(echo "$n" | tr '_' '/')"

  ocekavany="$(mktemp)"; bezici="$(mktemp)"
  # Stock ze VRSTVY OBRAZU, ne z běžícího kontejneru — jinak by se patch
  # aplikoval sám na sebe.
  docker run --rm --entrypoint sh "$COOLIFY_IMAGE" -c "cat '$cil'" > "$ocekavany"
  patch --silent "$ocekavany" < "$patch"
  docker exec "$COOLIFY_CONTAINER" sh -c "cat '$cil'" > "$bezici"

  if cmp -s "$ocekavany" "$bezici"; then
    printf '  ✅ %-46s odpovídá zdroji\n' "$(basename "$cil")"
  else
    nesoulad=1
    printf '  ⚠️  %-46s LIŠÍ SE od zdroje\n' "$(basename "$cil")"
    if [ "$REZIM" = "--apply" ]; then
      docker cp "$ocekavany" "$COOLIFY_CONTAINER:$cil"
      # ⛔ `docker cp` zachová HOSTITELSKÝ uid a mód. Naměřeno 2026-09-05: soubor přišel
      # jako uid 501 / mód 600, www-data ho NEČETL a Coolify by na příštím nasazení
      # nenačetl deploy job. Výchozí exec uživatel je www-data a chown mu nepatří —
      # narovnat proto JAKO ROOT, a `set -e` musí být za tímhle, ne před `php -l`.
      docker exec -u 0 "$COOLIFY_CONTAINER" sh -c "chown www-data:www-data '$cil' && chmod 644 '$cil'"
      # Ověření TOU identitou, která soubor používá: bez `-u 0` = www-data.
      docker exec "$COOLIFY_CONTAINER" php -l "$cil" >/dev/null
      printf '     → zapsáno a ověřeno `php -l`\n'
      zmena=1
    fi
  fi
  rm -f "$ocekavany" "$bezici"
done

if [ "$REZIM" = "--check" ] && [ "$nesoulad" = "1" ]; then
  echo "⛔ nasazený Coolify NEODPOVÍDÁ zdroji v repu" >&2
  exit 1
fi
[ "$zmena" = "0" ] && echo "  nic k narovnání — Coolify odpovídá zdroji"
exit 0
