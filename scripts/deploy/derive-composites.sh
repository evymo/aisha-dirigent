#!/usr/bin/env bash
# =============================================================================
# derive-composites.sh — složeniny z domains.env rozvinuté proti env SoT
# =============================================================================
# Vypíše `KLÍČ=hodnota` pro každou SLOŽENINU z `config/domains.env`, jejíž
# rozvinutí se liší od hodnoty v `.env.coolify`. Nic nezapisuje — zapisuje
# volající (aisha-redeploy.mjs), aby zůstala jedna cesta k SoT.
#
# PROČ TO VŮBEC EXISTUJE
# `config/domains.env` je ŠABLONA: `ALLOWED_ORIGINS=https://${APP_DOMAIN},…`.
# Do `.env.coolify` ji rozvine POUZE `aisha-cold-start.sh` (sourcne ji poté, co
# resolver naplní `*_DOMAIN`). `coolify-sync-envs.sh` pak posílá do Coolify jen
# to, co v `.env.coolify` JE — env-doctor se volá jen v režimu hlášení.
#
# Důsledek naměřený 2026-08-03: PR #113 přidal `https://${AUTH_DOMAIN_PUBLIC}`
# do ALLOWED_ORIGINS, změna přistála v mainu, ale gateway ji nikdy nedostala —
# přihlašovací stránka proto zůstala na „Stav provozu se zjišťuje". Táž třída
# jako overlay cachebust: hodnota má výrobce jen na JEDNÉ cestě.
#
# CO `ALLOWED_ORIGINS` JE — A CO NENÍ
# NENÍ to whitelist, tedy ručně držený seznam, do kterého se „nezapomene přidat".
# Je to OTISK vyhlášené topologie: `config/domains.env` skládá origin z domén,
# které instance deklaruje (`*_DOMAIN`, `SURFACE_ORIGINS`), a tenhle skript ten
# součet jen dopočítá. Nová doména se do CORS dostane tím, že vznikne, ne tím,
# že si na ni někdo vzpomene. Proto se hodnota nikdy needituje v `.env.coolify`
# a proto je „chybějící origin" vada DODÁVKY, ne opomenutí v seznamu.
#
# PROČ BASH A NE EMULACE
# Rozvinutí umí shell sám, včetně `${VAR:-${JINÁ}}` a `${VAR:+,${JINÁ}}`.
# Emulovat to regulárními výrazy jsem 2026-08-03 zkusil dvakrát a dvakrát
# vyrobil nesmysl (zbylé `}` u vnořených výchozích hodnot; a odvození bez
# operátorského prostředí, které vydalo `aisha.example.com` — kdyby se to
# zapsalo, přepsalo by produkci na příklady).
#
# PROČ SE `.env.coolify` NESOURCUJE PŘÍMO
# Nese víceřádkové hodnoty (privátní klíče, texty e-mailů). `. .env.coolify`
# na nich rozbije parsování a shell začne provádět útržky vět jako příkazy —
# naměřeno: `victory: command not found`. Proto se z něj bere JEN jednořádkové
# `KLÍČ=hodnota` a přepíše se do dočasného souboru s uvozením.
#
# Použití:
#   scripts/deploy/derive-composites.sh <env-soubor> [domains.env] [vlastnene,klice]
#
# Návratové kódy:  0 = hotovo (výpis smí být prázdný), 1 = chybný vstup
# =============================================================================
set -euo pipefail

ENV_FILE="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMPL="${2:-$ROOT_DIR/config/domains.env}"
# Složeniny, které nasazení VLASTNÍ — smějí se v SoT i ZALOŽIT, nejen přepsat.
ALSO="${3:-}"

if [ -z "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "derive-composites: chybí nebo neexistuje env soubor: ${ENV_FILE:-<nezadán>}" >&2
  exit 1
fi
if [ ! -f "$TMPL" ]; then
  echo "derive-composites: chybí šablona: $TMPL" >&2
  exit 1
fi

CLEAN="$(mktemp -t aisha-composites.XXXXXX)"
trap 'rm -f "$CLEAN"' EXIT

# Jednořádkové přiřazení → bezpečně uvozené. Hodnota se NEinterpretuje.
awk '
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    eq = index($0, "=")
    key = substr($0, 1, eq - 1)
    val = substr($0, eq + 1)
    gsub(/\047/, "\047\\\047\047", val)      # jednoduchá uvozovka uvnitř hodnoty
    printf "%s=\047%s\047\n", key, val
  }
' "$ENV_FILE" > "$CLEAN"

# Klíče, jejichž hodnota v šabloně je složenina (obsahuje ${…}).
COMPOSITES="$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=.*\$\{' "$TMPL" | cut -d= -f1 | sort -u)"

# shellcheck source=/dev/null
set -a; . "$CLEAN"; set +a

# Hodnoty PŘED rozvinutím šablony — bash 3.2 nemá asociativní pole, proto
# přes dynamicky pojmenované proměnné (`_pre_<KLÍČ>`).
for k in $COMPOSITES; do
  eval "_pre_${k}=\${${k}-}"
done

# shellcheck source=/dev/null
set -a; . "$TMPL"; set +a

for k in $COMPOSITES; do
  # Klíč, který v SoT není, se běžně NEDOPLŇUJE: SoT řídí, co instance má.
  # Výjimkou jsou klíče vyjmenované v $3 — složeniny, které nasazení VLASTNÍ
  # a bez nichž služba nefunguje. `CORS_ALLOWLIST` je přesně ten případ:
  # v `.env.coolify` nebyl vůbec, compose ho interpoloval na prázdno a
  # packages/security/src/cors.ts je fail-closed — prázdný seznam odmítne
  # každý prohlížečový origin (projdou jen volání bez `Origin`, proto si toho
  # nikdo nevšiml). Naměřeno 2026-08-03: čte ho 23 služeb.
  if ! grep -q "^${k}=" "$CLEAN"; then
    case ",${ALSO}," in
      *",${k},"*) : ;;      # vlastněná složenina — smí se ZALOŽIT
      *)          continue ;;
    esac
  fi
  eval "_before=\${_pre_${k}-}"
  eval "_after=\${${k}-}"
  [ -n "$_after" ] || continue                # prázdné nikdy nezapisujeme
  [ "$_before" = "$_after" ] && continue
  printf '%s=%s\n' "$k" "$_after"
done
