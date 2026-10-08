#!/usr/bin/env bash
# umisteni-souhlasi.sh <manifest> — souhlasí umístění služeb v manifestu a v profilu?
# A smí služba bydlet tam, kam ji oba posílají? (lib/umisteni-slotu.mjs, na konci)
#
# ⛔ NAMĚŘENO 2026-10-03 (konvergence instance forku, 4. pokus): rozpor manifest × profil
# u 8 služeb zastavil cold-start až v KROKU 4 (coolify-sync-envs) — po zápisu env
# do Coolify a po založení nové aplikace. Kontrola samotná je správná
# (lib/coolify-app-vars.sh, assert_placement_agrees); stála jen pozdě.
#
# Tenhle obal pouští TUTÉŽ funkci dřív — v doktoru (krok 0) a v suchém běhu —
# nad umístěním odvozeným ČERSTVĚ z profilu (derive-domains --shell), ne ze
# starého .env.coolify: po změně profilu (úprava profilu v datech instance) by stará hodnota
# odpověděla na jinou otázku.
#
# Kódy: 0 souhlasí · 1 rozpor (výpis na stderr) · 2 nejde změřit (NEMĚŘENO ≠ shoda).
set -uo pipefail

manifest="${1:-}"
[ -n "$manifest" ] && [ -f "$manifest" ] || { echo "umisteni-souhlasi: manifest '${manifest}' neexistuje" >&2; exit 2; }

koren="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ⛔ DŮVOD SELHÁNÍ SE NEZAHAZUJE (nedůvěřivé čtení 2026-10-03, nález 6). Derivace
# šla s `2>/dev/null`, takže doktor uměl napsat jen „selhal" — bez příčiny. Chybový
# výstup se proto chytá do souboru: při úspěchu se zahodí (derivace na něj píše
# i běžná varování, která s umístěním nesouvisí), při selhání z něj jde do hlášky
# DŮVOD. Změřeno: s prázdným AISHA_PROFILE derivace SPADNE (kód 1, „AISHA_PROFILE
# není deklarovaný…") — výchozí profil místo profilu instance neměří.
chyby="$(mktemp)"
trap 'rm -f "$chyby"' EXIT

# Důvod z chybového výstupu nástroje. Poslední řádek NESTAČÍ: nezachycená výjimka
# Nodu končí zásobníkem a podpisem běhového prostředí („Node.js v…"), příčina je
# na řádku „…Error: zpráva". Ten má přednost; jinak poslední neprázdný řádek,
# který není zásobník ani podpis. Čte se celý vstup ze souboru (žádná roura, žádný
# předčasný konec čtenáře).
duvod_selhani() {
  awk '
    /^[A-Za-z]*Error: / && nalez == "" { nalez = $0 }
    !/^[[:space:]]*at / && !/^Node\.js v/ && NF { posledni = $0 }
    END { print (nalez != "" ? nalez : posledni) }
  ' "$1"
}

odvozeno_rc=0
odvozeno="$(node "$koren/scripts/lib/derive-domains.mjs" --shell 2>"$chyby")" || odvozeno_rc=$?
if [ "$odvozeno_rc" -ne 0 ]; then
  duvod="$(duvod_selhani "$chyby")"
  echo "umisteni-souhlasi: derive-domains --shell selhal (kód ${odvozeno_rc}): ${duvod:-bez chybového výstupu} — umístění z profilu neznám" >&2
  exit 2
fi
umisteni="$(printf '%s\n' "$odvozeno" | grep -E '^[A-Z0-9_]+_PLACEMENT=' || true)"
[ -n "$umisteni" ] || { echo "umisteni-souhlasi: derivace nevydala žádné *_PLACEMENT — měřidlo osiřelo" >&2; exit 2; }

# Jen *_PLACEMENT, nic dalšího z odvozeného env do prostředí kontroly.
while IFS='=' read -r klic hodnota; do
  hodnota="${hodnota%\"}"; hodnota="${hodnota#\"}"
  export "$klic=$hodnota"
done <<< "$umisteni"

# shellcheck source=/dev/null
. "$koren/scripts/lib/coolify-app-vars.sh"
load_app_compose_map "$manifest" || { echo "umisteni-souhlasi: mapu aplikací z manifestu nejde sestavit" >&2; exit 2; }
[ "${#APP_NAMES[@]}" -gt 0 ] || { echo "umisteni-souhlasi: manifest nedeklaruje žádnou aplikaci" >&2; exit 2; }
assert_placement_agrees || exit 1
_porovnane="${PLACEMENT_POROVNANE[*]-}"
echo "umístění souhlasí: ${#APP_NAMES[@]} aplikací manifestu × profil (s profilem porovnáno ${#PLACEMENT_POROVNANE[@]}: ${_porovnane// /,})"

# Druhá polovina téže otázky: shodnou se, ale smí služba bydlet tam, kam ji oba
# posílají? Neznámý slot (2), hlavní mesh forku nebo veřejná tvář na GPU slotu (1).
# Stejné místo, stejný čas: krok 0, před zápisem (lib/umisteni-slotu.mjs).
# Měří se topologie (veřejná tvář) I mapa manifestu: story-init zakládá podle manifestu
# (`app: <id>:<slot>:<compose>`), takže právě jeho slot a compose rozhodují, co na GPU
# uzel dojede (revize accel-1, 10-05, bod 1).
node "$koren/scripts/lib/umisteni-slotu.mjs" --manifest-mapa - < <(
  for _i in "${!APP_NAMES[@]}"; do printf '%s\t%s\t%s\n' "${APP_NAMES[$_i]}" "${APP_SLOTS[$_i]}" "${APP_COMPOSES[$_i]}"; done
)
