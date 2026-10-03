#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# KTERÉ APLIKACE JSOU NAŠE — jedna otázka, jedna odpověď
#
# ⛔ NAMĚŘENO 2026-08-16. Na Coolify běží víc nájemníků a `aisha-` NENÍ identita.
# Doktor si vybíral aplikace podle `name | startswith("aisha")` a napočítal 33.
# Sync, který se ptá podle PROJEKTU, jich obsloužil 32. Ten rozdíl nebyl chybou
# syncu — byla to CIZÍ aplikace:
#
#     aisha-registry  rkkwkksw08c4g8s4ocs4ws4w  projekt a1sh4   ← cizí nájemník
#     aisha-registry  wyotm8kdmc2rjf3nuckg2kqx  projekt aisha   ← naše
#
# Dopady byly dva, oba tiché:
#   1. čísla doktora zahrnovala cizí aplikaci — „aisha-registry: 80 tajemství
#      v buildu" byla expozice NĚKOHO JINÉHO, a v našem souhrnu vypadala jako
#      náš nejhorší případ, který se nedaří opravit;
#   2. doktor přitom četl env metadata cizího nájemníka přes API. To není jen
#      špatné počítání, to je zbytečný dosah na cizí data.
#
# Jméno s prefixem si může zvolit kdokoli. Identita je PROJEKT (+ prostředí),
# protože to je hranice, kterou vlastníme. Proto tenhle domov: kdo se ptá „které
# aplikace jsou naše", ptá se tady, a dostane buď odpověď, nebo NIC a hlášku —
# nikdy tichou náhradu za jméno.
#
# $1 = api base (…/api/v1), $2 = token
# Tiskne JSON pole aplikací. Prázdný výstup = NEZMĚŘENO (ne „nula aplikací").
# Návratový kód 0 = odpověď, 1 = nepodařilo se zjistit.
# ─────────────────────────────────────────────────────────────────────────────

coolify_our_applications() {
  local api="$1" token="$2"
  local env_name="${COOLIFY_ENVIRONMENT:-production}"
  local proj="${COOLIFY_PROJECT_UUID:-}"

  if [ -z "$proj" ]; then
    echo "  ⚠ COOLIFY_PROJECT_UUID není nastavené — nelze zjistit, které aplikace jsou NAŠE." >&2
    echo "    Prefix jména identita NENÍ: na sdíleném Coolify si 'aisha-*' může pojmenovat" >&2
    echo "    kdokoli, a měřili bychom cizího nájemníka. Doplň COOLIFY_PROJECT_UUID." >&2
    return 1
  fi

  local resp
  resp=$(curl -sS --http1.1 --max-time 120 --connect-timeout 10 \
    -H "Authorization: Bearer ${token}" -H "Accept: application/json" \
    "${api}/projects/${proj}/${env_name}" 2>/dev/null | tr -d '\000-\037')

  # Prázdná odpověď z nedostupného endpointu se NESMÍ tvářit jako „projekt nemá
  # aplikace" — tichý přeskok by vypadal k nerozeznání od čistého výsledku.
  local pocet
  pocet=$(printf '%s' "$resp" | jq -r '(.applications // []) | length' 2>/dev/null || echo 0)
  if [ -z "$resp" ] || [ "${pocet:-0}" -eq 0 ]; then
    echo "  ⚠ projekt ${proj}/${env_name} nevrátil žádné aplikace — NEZMĚŘENO." >&2
    echo "    (Nula aplikací je legitimní jen na prázdné instalaci; jinak je to" >&2
    echo "    nedostupné API nebo špatné COOLIFY_PROJECT_UUID.)" >&2
    return 1
  fi

  printf '%s' "$resp" | jq -c '.applications'
}

# Aplikace BEZ načteného compose. Jedna otázka, jeden domov — ptá se na ni
# doktor (předpověď) i deploy-init (bariéra před nastavením domén).
#
# ⛔ NAMĚŘENO 2026-08-17: Coolify odmítá `docker_compose_domains`, dokud je
# `docker_compose_raw` prázdný (update_by_uuid → 422 „Cannot set
# docker_compose_domains without docker_compose_raw"). Plní ho ASYNCHRONNÍ
# řazená úloha `LoadComposeFile`, dispatchovaná při vytvoření aplikace.
#
# Doba doručení je vlastnost té fronty, ne naše:
#   prázdná fronta            → do 8 s
#   fronta pod cold-startem   → ~1 h (31 aplikací vytvořeno 06:21–06:58,
#                                compose dorazil 07:46–07:48)
#
# Seed hodnoty rovnou v create payloadu NEFUNGUJE — ověřeno živě: Coolify
# create přijme, ale `docker_compose_raw` je hned po něm NULL a za 8 s se
# objeví verze normalizovaná z gitu. Poslaná hodnota se neuplatní.
# $1 = JSON pole aplikací. Tiskne jméno každé aplikace bez načteného compose.
coolify_apps_without_compose_raw() {
  printf '%s' "$1" | jq -r '.[] | select((.docker_compose_raw // "") == "") | .name' 2>/dev/null || true
}

# Duplicitní JMÉNA uvnitř NAŠEHO projektu. Tohle je skutečná vada — dvě naše
# aplikace téhož jména se perou o tytéž aliasy a kontejnerová jména na sdíleném
# hostiteli. (Cizí nájemník s podobným jménem sem nepatří; ten se odfiltroval
# už tím, že se ptáme podle projektu.)
# $1 = JSON pole aplikací. Tiskne jméno<TAB>uuid,uuid… pro každé duplicitní.
coolify_duplicate_app_names() {
  printf '%s' "$1" | jq -r '
    group_by(.name)
    | map(select(length > 1))
    | .[]
    | "\(.[0].name)\t\([.[].uuid] | join(", "))"' 2>/dev/null
}
