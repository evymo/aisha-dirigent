#!/usr/bin/env bash
# scripts/lib/coolify-resolve-uuid.sh — DYNAMIC Coolify UUID resolver.
#
# AISHA's source-of-truth invariant: no infrastructure UUIDs in committed code,
# no static UUID secrets, no hardcoded fallbacks. Every UUID is resolved at run
# time from the Coolify API by application NAME (e.g. "aisha-core" → uuid).
#
# Why: each --wipe rebuilds Coolify apps with new UUIDs. Storing UUIDs as
# secrets is brittle (breaks on every rebuild) and contradicts the "everything
# dynamic" architecture (see memory: feedback_bootstrap_creds_generator_pushes.md).
#
# Mirrors the resolve_uuid() inline helper that already lives inside
# scripts/aisha-cold-start.sh (step 4). Extracted so CI workflows (.github/)
# and check-infra.mjs can use the same logic without duplication.
#
# Required env when sourcing:
#   COOLIFY_URL          (Coolify API base URL — operator-set)
#   COOLIFY_API_TOKEN
#   APP_NAME_PREFIX      (identita instance = JMÉNO jejího projektu v Coolify),
#                        nebo připnuté COOLIFY_PROJECT_UUID
#   node + scripts/lib/coolify-project-scope.mjs (a jeho importy) — rozsah
#                        projektu má jeden domov, bash ho nepřepisuje po svém
#
# Usage from bash:
#   source scripts/lib/coolify-resolve-uuid.sh
#   uuid=$(coolify_resolve_uuid "aisha-core")
#   if [ -z "$uuid" ]; then echo "core stack not found"; exit 1; fi
#
# Usage in CI:
#   bash scripts/lib/coolify-resolve-uuid.sh aisha-core
#     → prints uuid to stdout (or exits 1 with stderr error)
#
#   bash scripts/lib/coolify-resolve-uuid.sh --all-aisha
#     → prints JSON map { "aisha-core": "uuid", "aisha-keycloak": "uuid", ... }
#       (only includes apps that exist; absent apps are omitted, never errored)
#
# Memory invariants honored:
#   - feedback_coolify_v4_list_cache_race.md: /applications list endpoint is
#     stale ~30s after wipe DELETE. We retry up to 5 times before giving up.
#   - feedback_coolify_api_unified_retry.md: 5s/10s/15s backoff per attempt;
#     total timeout 30s per call so loops don't burn 10 minutes.
#   - feedback_pfsense_ratelimit.md: rate-limit per host; we batch via /applications
#     instead of per-app GETs to avoid hammering pfSense.

set -u

# ---------------------------------------------------------------------------
# PREFIX INSTANCE — kdo se nasazuje, NENÍ vlastnost platformy.
#
# Na jednom Coolify stojí vedle sebe několik zákaznických prefixů (<upstream>-*, <forkA>-*, <forkB>-*, …),
# <instance>-*. Dokud byl prefix `aisha-` v tomhle skriptu natvrdo,
# uměl resolver najít VÝHRADNĚ upstreamovou instanci — takže deploy spuštěný
# z libovolného forku mířil na cizí produkci.
#
# Naměřeno 2026-08-04: workflow_dispatch z forku (vlastní APP_NAME_PREFIX)
# nasadil upstream `<upstream>-core`
# Cíl měl být `<fork>-core` — jiná aplikace, jiné uuid.
# Build spadl na chybějícím NETBIRD_DNS_IP dřív, než došlo k výměně kontejnerů,
# takže to skončilo u pokusu — ale jen shodou okolností.
#
# Proto FAIL-CLOSED: prázdný prefix je chyba, ne důvod dosadit `aisha`. Tichá
# výchozí hodnota je přesně ta vlastnost, která z překlepu v konfiguraci dělá
# zásah do cizího provozu. Instance se určí výslovně, nebo se nenasazuje.
# ---------------------------------------------------------------------------
coolify_app_prefix() {
  local p="${APP_NAME_PREFIX:-}"

  # .env.coolify JE instance. Když existuje, je to druhý nezávislý zdroj pravdy —
  # a jeho rozpor s prostředím je FATAL, ne důvod jednu stranu upřednostnit.
  # Přesně takový rozpor stál 2026-07-21 za zápisem hodnot jedné instance do osmi produkčních
  # aisha-* aplikací: volající exportoval jinou proměnnou, prefix zůstal prázdný
  # a doplnil se z fallbacku.
  local env_file="${AISHA_INSTANCE_ENV:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env.coolify}"
  local from_file=""
  if [ -f "$env_file" ]; then
    from_file="$(grep -E '^APP_NAME_PREFIX=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'' | tr -d '[:space:]')"
  fi

  if [ -n "$p" ] && [ -n "$from_file" ] && [ "$p" != "$from_file" ]; then
    echo "::error::Rozpor v určení instance: prostředí říká '$p', $env_file říká '$from_file'." >&2
    echo "::error::Nasazení se ZASTAVUJE. Nejistota v prefixu je nejistota v tom, ČÍ provoz se restartuje." >&2
    return 2
  fi

  [ -z "$p" ] && p="$from_file"

  if [ -z "$p" ]; then
    echo "::error::APP_NAME_PREFIX není nastaven — nevím, KTEROU instanci mám nasadit." >&2
    echo "::error::Nastav APP_NAME_PREFIX (proměnná CI nebo .env.coolify). Výchozí hodnota se ZÁMĚRNĚ nedosazuje: dosazený 'aisha' by z forku nasadil cizí produkci." >&2
    return 2
  fi
  printf '%s' "$p"
}

# ---------------------------------------------------------------------------
# JSON helpers — jq is NOT a given.
#
# Measured 2026-08-02: the self-hosted CI runner mapped `ubuntu-latest` to
# `node:20-bookworm`, which ships NO jq. Every jq call here silently fell back
# to its `|| echo 0` / `|| echo ''` guard, so the resolver reported "app not
# found", the deploy job printed its manual-deploy warning and went GREEN
# without deploying anything — for weeks. A hard dependency that degrades into
# a wrong answer is worse than one that is absent, hence: try jq, then node,
# then python3, and ERROR OUT when none exists rather than answering "empty".
# ---------------------------------------------------------------------------
_json_runtime() {
  if [ -n "${_COOLIFY_JSON_RT:-}" ]; then printf '%s' "$_COOLIFY_JSON_RT"; return 0; fi
  if command -v jq >/dev/null 2>&1; then _COOLIFY_JSON_RT=jq
  elif command -v node >/dev/null 2>&1; then _COOLIFY_JSON_RT=node
  elif command -v python3 >/dev/null 2>&1; then _COOLIFY_JSON_RT=python3
  else
    echo "::error::coolify-resolve-uuid: no JSON runtime (jq, node or python3) on PATH" >&2
    return 2
  fi
  printf '%s' "$_COOLIFY_JSON_RT"
}

# _json_array_len <json-on-stdin> → array length, or 0 for anything not an array
_json_array_len() {
  local rt; rt="$(_json_runtime)" || return 2
  case "$rt" in
    jq)      jq -r 'if type == "array" then length else 0 end' 2>/dev/null || echo 0 ;;
    node)    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?j.length:0)}catch{console.log(0)}})' 2>/dev/null || echo 0 ;;
    python3) python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)
except Exception: print(0)' 2>/dev/null || echo 0 ;;
  esac
}

# _json_uuid_by_name <name> <json-on-stdin> → uuid of the app with that exact name
#
# ⛔ NAMĚŘENO 2026-09-13 (GET /api/v1/applications, 227 aplikací): jméno
# `aisha-registry` nesou DVĚ aplikace — rkkwkksw… v projektu a1sh4 (index 30)
# a wyotm8kd… v projektu aisha (index 31). Dosavadní `first` / `find` tedy nad
# globálním seznamem vracel CIZÍ aplikaci, protože v odpovědi stojí dřív.
# Dvě shody jsou proto CHYBA (rc=3), ne volba: kdo nasazuje, musí vědět, CO
# nasazuje. Uvnitř rozsahu projektu to znamená dvě naše aplikace téhož jména
# (skutečná vada), mimo něj by to byl cizí jmenovec.
_json_uuid_by_name() {
  local name="$1" rt out rc=0; rt="$(_json_runtime)" || return 2
  case "$rt" in
    jq)      out=$(jq -r --arg n "$name" '[.[] | select(.name == $n) | .uuid] | if length > 1 then "AMBIGUOUS " + join(",") else (first // empty) end' 2>/dev/null) || out='' ;;
    node)    out=$(node -e 'let s="";const n=process.argv[1];process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const m=(Array.isArray(a)?a:[]).filter(x=>x&&x.name===n&&x.uuid);if(m.length>1)process.stdout.write("AMBIGUOUS "+m.map(x=>x.uuid).join(","));else if(m.length===1)process.stdout.write(String(m[0].uuid))}catch{}})' "$name" 2>/dev/null) || out='' ;;
    python3) out=$(python3 -c 'import json,sys
n=sys.argv[1]
try:
    a=json.load(sys.stdin)
    m=[x for x in a if isinstance(x,dict) and x.get("name")==n and x.get("uuid")]
    sys.stdout.write("AMBIGUOUS "+",".join(str(x["uuid"]) for x in m) if len(m)>1 else (str(m[0]["uuid"]) if m else ""))
except Exception: pass' "$name" 2>/dev/null) || out='' ;;
  esac
  case "$out" in
    AMBIGUOUS\ *)
      echo "::error::coolify-resolve-uuid: '$name' nesou VÍC aplikací (${out#AMBIGUOUS }) — překlad jméno→UUID je dvojznačný, nevybírám." >&2
      return 3
      ;;
  esac
  printf '%s' "$out"
  return "$rc"
}

# Cache the /applications response per-process so repeated resolves don't
# hammer the API. Cache key = $COOLIFY_URL ($COOLIFY_API_TOKEN omitted for log
# safety). Reset by unsetting _COOLIFY_APPS_CACHE before next call.
_coolify_apps_cache_load() {
  if [ -n "${_COOLIFY_APPS_CACHE:-}" ]; then
    echo "$_COOLIFY_APPS_CACHE"
    return 0
  fi

  if [ -z "${COOLIFY_URL:-}" ]; then
    echo "::error::coolify-resolve-uuid: COOLIFY_URL not set" >&2
    return 2
  fi
  if [ -z "${COOLIFY_API_TOKEN:-}" ]; then
    echo "::error::coolify-resolve-uuid: COOLIFY_API_TOKEN not set" >&2
    return 2
  fi

  # ⛔ NAMĚŘENO 2026-08-16: tenhle překladač bral `/applications` (VŠECHNY
  # nájemníky) a vybíral podle prefixu jména. Na sdíleném Coolify si `aisha-*`
  # může pojmenovat kdokoli — a opravdu se to stalo: projekt `a1sh4` má aplikaci
  # `aisha-registry`.
  #
  # ⛔ NAMĚŘENO 2026-09-13 (CI běh #3639 nad main a89882dfd, úlohy Core,
  # Extranet, Infra): oprava z 08-16 v CI NIKDY neplatila. Rozsah se bral jen
  # z COOLIFY_PROJECT_UUID a CI tu proměnnou nemá — takže každá deploy úloha
  # vypsala `::warning::… COOLIFY_PROJECT_UUID chybí` a POKRAČOVALA nad globálním
  # seznamem. Varování nic nezastavilo. Změřeno týž den nad živým API: v globální
  # odpovědi stojí cizí `aisha-registry` (a1sh4) PŘED naší; tento resolver v
  # předchozí podobě vrátil nad fixturou v témže pořadí CIZÍ UUID s rc=0 — a
  # `deploy.yml -f stack=registry` by to UUID poslal do POST /deploy.
  #
  # UUID projektu přitom není tajemství, které CI chybí, ale ODVOZENINA: cold-start
  # ho zjišťuje jako „projekt pojmenovaný identitou instance" (APP_NAME_PREFIX,
  # generate-coolify-context.mjs) a totéž dělá createProjectScope(). Proto se tu
  # neptáme po svém, ale JEDNOHO domova hranice — coolify-project-scope.mjs:
  # připnuté COOLIFY_PROJECT_UUID vyhrává, jinak projekt jménem instance;
  # nula nebo víc projektů toho jména = odmítnutí. Globální `/applications` jako
  # náhrada ZMIZELO: nezjištěný rozsah je chyba (rc=2), ne důvod hádat podle jména.
  local _lib_dir; _lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local _scope="$_lib_dir/coolify-project-scope.mjs"
  if ! command -v node >/dev/null 2>&1; then
    echo "::error::coolify-resolve-uuid: node chybí — rozsah projektu instance (coolify-project-scope.mjs) nejde zjistit a bez něj se NEPŘEKLÁDÁ (globální /applications obsahuje cizí nájemníky)" >&2
    return 2
  fi
  if [ ! -f "$_scope" ]; then
    echo "::error::coolify-resolve-uuid: $_scope chybí (řídký checkout bez něj?) — bez rozsahu projektu se NEPŘEKLÁDÁ" >&2
    return 2
  fi

  local resp="" rc len
  local backoff_secs=(5 10 15 15 15)
  local attempt=0
  for sleep_for in "${backoff_secs[@]}"; do
    attempt=$((attempt + 1))
    rc=0
    resp=$(COOLIFY_BASE_URL="${COOLIFY_URL%/}" node "$_scope" --list-apps --json) || rc=$?
    if [ "$rc" -ne 0 ]; then
      # rc 2 = chybí pověření · 3 = projekt instance nezjištěn (nedeklarován,
      # neexistuje, víc projektů téhož jména, 0 prostředí) · 4 = seznam selhal
      echo "::error::coolify-resolve-uuid: rozsah projektu instance se nezjistil (coolify-project-scope.mjs rc=$rc) — NEPŘEKLÁDÁM jméno napříč nájemníky. Deklaruj APP_NAME_PREFIX (= jméno projektu v Coolify) nebo připni COOLIFY_PROJECT_UUID." >&2
      return 2
    fi
    # Prázdný projekt těsně po wipe je závod seznamu (viz list cache race výš),
    # ne „nula aplikací" — zkusí se znovu, pak se to ohlásí jako selhání.
    len=$(printf '%s' "$resp" | _json_array_len) || return 2
    if [ "$len" -gt 0 ]; then
      _COOLIFY_APPS_CACHE="$resp"
      printf '%s' "$resp"
      return 0
    fi
    if [ "$attempt" -lt "${#backoff_secs[@]}" ]; then
      echo "::warning::coolify-resolve-uuid: projekt instance vrátil 0 aplikací (pokus $attempt) — zkusím znovu za ${sleep_for}s" >&2
      sleep "$sleep_for"
    fi
  done

  echo "::error::coolify-resolve-uuid: projekt instance nevrátil žádné aplikace ani po $attempt pokusech — NEZMĚŘENO, ne „aplikace neexistuje\"" >&2
  return 3
}

# coolify_resolve_uuid <app_name>
# Prints uuid to stdout, exits 0. Empty stdout + exit 1 when app not found.
coolify_resolve_uuid() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    echo "::error::coolify_resolve_uuid: app name required" >&2
    return 2
  fi
  local apps_json
  apps_json="$(_coolify_apps_cache_load)" || return $?
  local uuid
  uuid=$(printf '%s' "$apps_json" | _json_uuid_by_name "$name") || return $?
  if [ -z "$uuid" ]; then
    return 1
  fi
  printf '%s' "$uuid"
}

# coolify_resolve_all_aisha_uuids
# Prints JSON map of { "aisha-core": "uuid", ... }. Apps not present in Coolify
# are simply omitted (not errored). Useful for deploy workflows that iterate
# only over what exists.
coolify_resolve_all_aisha_uuids() {
  local apps_json
  apps_json="$(_coolify_apps_cache_load)" || return $?
  local rt; rt="$(_json_runtime)" || return 2
  # Filtruje se podle prefixu INSTANCE, ne podle 'aisha-'. Bez toho by výpis
  # z forku nabídl cizí aplikace a volající by je považoval za své.
  local pfx; pfx="$(coolify_app_prefix)" || return 2
  pfx="${pfx}-"

  # ⛔ NAMĚŘENO 2026-08-16: MAPA KLÍČOVANÁ JMÉNEM neumí vyjádřit dvě aplikace
  # téhož jména — `from_entries` (i `o[name]=uuid` v node/python větvi) jednu
  # z nich TIŠE zahodí. Proto si nikdo nevšiml, že `local-ingest` existuje
  # dvakrát: nástroje dostaly jednu UUID, deploy proběhl, druhá aplikace žila
  # dál vedle — v mesh pod týmž jménem a s bind-mountem na TÝŽ adresář
  # hostitele (`/srv/aisha/drop/local-ingest`), tedy dva zapisovatelé do jednoho
  # místa.
  #
  # Vada nebyla ve smyčce, ale ve TVARU DAT: reprezentace neuměla problém
  # popsat, takže na něj nešlo ani upozornit. Zjišťuje se proto PŘED převodem
  # na mapu, kdy se ještě dá počítat, a hlásí se nahlas.
  # Bez filtru podle jména ZÁMĚRNĚ: vstup je už omezený projektem (viz
  # `_coolify_apps_cache_load`, který jinak neodpoví), takže jméno by tu
  # identitu jen zbytečně suplovalo podruhé.
  #
  # ⛔ 2026-09-13: detekce stála jen na `jq … 2>/dev/null`. Runner
  # `node:20-bookworm` jq nemá (naměřeno 2026-08-02, viz _json_runtime) — prázdný výstup pak znamenal
  # „bez duplicit" a mapa jednu aplikaci tiše zahodila. Ptá se proto týmž
  # JSON runtime jako zbytek souboru; selhání runtime je chyba, ne čistý nález.
  local _dupl _dupl_rc=0
  case "$rt" in
    jq)      _dupl=$(printf '%s' "$apps_json" | jq -r '
               group_by(.name) | map(select(length > 1))
               | .[] | "\(.[0].name): \([.[].uuid] | join(", "))"') || _dupl_rc=$? ;;
    node)    _dupl=$(printf '%s' "$apps_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const g={};for(const x of a){(g[x.name]=g[x.name]||[]).push(x.uuid)}for(const [n,u] of Object.entries(g)) if(u.length>1) console.log(n+": "+u.join(", "))})') || _dupl_rc=$? ;;
    python3) _dupl=$(printf '%s' "$apps_json" | python3 -c 'import json,sys
g={}
for x in json.load(sys.stdin): g.setdefault(x.get("name"),[]).append(str(x.get("uuid")))
for n,u in g.items():
    if len(u)>1: print(n+": "+", ".join(u))') || _dupl_rc=$? ;;
  esac
  if [ "$_dupl_rc" -ne 0 ]; then
    echo "::error::coolify_resolve_all_aisha_uuids: kontrola duplicitních jmen selhala ($rt rc=$_dupl_rc) — NEZMĚŘENO, mapu nevydám" >&2
    return 2
  fi
  if [ -n "$_dupl" ]; then
    echo "::error::coolify_resolve_uuid: DVĚ aplikace téhož jména — překlad jméno→UUID je dvojznačný:" >&2
    printf '  %s\n' "$_dupl" >&2
    echo "  Mapa klíčovaná jménem by jednu tiše zahodila. Zruš zbytnou aplikaci" >&2
    echo "  v Coolify, nebo ji přejmenuj, aby jméno bylo v projektu jednoznačné." >&2
    return 3
  fi

  case "$rt" in
    jq)      printf '%s' "$apps_json" | jq -r --arg p "$pfx" '[.[] | select(.name | startswith($p)) | {key: .name, value: .uuid}] | from_entries' 2>/dev/null || echo '{}' ;;
    node)    printf '%s' "$apps_json" | AISHA_PFX="$pfx" node -e 'let s="";const p=process.env.AISHA_PFX;process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const o={};for(const x of (Array.isArray(a)?a:[])) if(x&&typeof x.name==="string"&&x.name.startsWith(p)) o[x.name]=x.uuid;console.log(JSON.stringify(o))}catch{console.log("{}")}})' 2>/dev/null || echo '{}' ;;
    python3) printf '%s' "$apps_json" | AISHA_PFX="$pfx" python3 -c 'import json,sys,os
p=os.environ["AISHA_PFX"]
try:
    a=json.load(sys.stdin)
    print(json.dumps({x["name"]: x.get("uuid") for x in a if isinstance(x,dict) and str(x.get("name","")).startswith(p)}))
except Exception: print("{}")' 2>/dev/null || echo '{}' ;;
  esac
}

# coolify_redeploy <app_name>
# Resolves UUID by name + issues /api/v1/applications/<uuid>/restart.
# Returns 0 on HTTP 2xx, non-zero otherwise. Soft-fails when app not found
# (returns 1 with stderr; doesn't abort caller via set -e).
coolify_redeploy() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    echo "::error::coolify_redeploy: app name required" >&2
    return 2
  fi
  local uuid
  uuid="$(coolify_resolve_uuid "$name")" || {
    echo "::warning::coolify_redeploy: app '$name' not found in Coolify; skipping" >&2
    return 1
  }
  local http
  http=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "${COOLIFY_URL%/}/api/v1/applications/${uuid}/restart" 2>/dev/null \
    || true)
  case "$http" in
    2*)
      echo "✓ redeployed $name (uuid=${uuid:0:8}…)" >&2
      return 0
      ;;
    *)
      echo "::error::coolify_redeploy: $name (uuid=${uuid:0:8}…) returned HTTP $http" >&2
      return 4
      ;;
  esac
}

# When called directly (not sourced), expose CLI:
#   coolify-resolve-uuid.sh <name>            → prints uuid or exits 1
#   coolify-resolve-uuid.sh --all-aisha       → prints JSON map
#   coolify-resolve-uuid.sh --redeploy <name> → resolves + restarts
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    --all-aisha)
      coolify_resolve_all_aisha_uuids
      ;;
    --redeploy)
      coolify_redeploy "${2:-}"
      ;;
    --help|-h|"")
      cat <<EOF
Usage: $0 <app_name>             # prints UUID (exit 1 if not found)
       $0 --all-aisha            # JSON map of all aisha-* apps
       $0 --redeploy <app_name>  # resolve + POST /restart
Required env: COOLIFY_URL, COOLIFY_API_TOKEN
EOF
      ;;
    *)
      # Dvě různé věci, dvě různá návěští — volající se podle nich ROZHODUJE:
      #   rc=1  appka v Coolify není       → "::notfound::" (legitimní stav:
      #                                      community instalace, jiný stack)
      #   rc≥2  infrastruktura selhala     → "::error::" (API mlčí, chybí token
      #                                      či JSON runtime) ⇒ deploy MUSÍ padnout
      # Před 2026-08-02 nesly obě větev "::error::" a workflow je obě odbylo
      # warningem — zelený deploy, který nic nenasadil.
      uuid=$(coolify_resolve_uuid "$1"); rc=$?
      if [ "$rc" -ne 0 ]; then
        if [ "$rc" -eq 1 ]; then
          echo "::notfound::coolify-resolve-uuid: app '$1' not found" >&2
        else
          echo "::error::coolify-resolve-uuid: resolve failed for '$1' (rc=$rc)" >&2
        fi
        exit "$rc"
      fi
      printf '%s\n' "$uuid"
      ;;
  esac
fi
