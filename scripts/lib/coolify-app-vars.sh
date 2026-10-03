#!/usr/bin/env bash
# ==============================================================================
# coolify-app-vars.sh — per-app extraction of required env vars from compose
# ==============================================================================
# Funkce:
#   extract_compose_vars <compose-file>
#       → vypíše unikátní seznam compose referencí (${VAR}, ${VAR:-default},
#       ${VAR:?msg}, ...), které má smysl syncovat pokud existují v .env.coolify.
#       Přeskakuje: $$VAR (escape — compose nic neinterpoluje), SERVICE_*.
#
#   extract_required_compose_vars <compose-file>
#       → vypíše pouze proměnné, které MUSÍ být v .env.coolify: ${VAR},
#       ${VAR:?msg}, ${VAR?msg}. Přeskakuje defaulty: ${VAR:-default}, ${VAR-default}.
#
#   Obě čtou soubor YAML parserem přes scripts/lib/compose-env-refs.mjs — tedy
#   tak, jak ho čte compose. Textový extraktor, který tu býval, zahazoval řádky
#   začínající `#` i UVNITŘ block-scalaru (`entrypoint: |`), kde jsou součástí
#   hodnoty a compose je interpoluje; naměřeno na docker-compose.coolify-prebuilt.yml:
#   API_DOMAIN, INTERNAL_TLD a KEYCLOAK_DOMAIN se kvůli tomu NEDORUČOVALY.
#   A `\${VAR}` bral jako „textovou ukázku" — compose ale zpětné lomítko jako
#   escape nezná a proměnnou interpoluje (`docker compose config` ověřeno).
#   Selže-li parser, funkce vrátí nenulu: prázdný seznam by vypadal jako
#   „compose nic nepotřebuje".
#
#   load_app_compose_map <manifest-file>
#       → naplní paralelní pole APP_NAMES[] a APP_COMPOSES[] (název bez prefixu
#       aisha- a cesta ke compose souboru z manifestu).
#
#   resolve_compose_for_app <app-name-without-prefix>
#       → echo path ke compose pro tu app (musí být po load_app_compose_map)
# ==============================================================================

# Jediný vstup do YAML extraktoru: jména podle režimu, bez SERVICE_* (ty si
# Coolify doplňuje sám). Návrat nenulový, když soubor nejde přečíst/parsovat.
_compose_refs() {
  local compose_file="$1" rezim="${2:-}" root refs
  [ -f "$compose_file" ] || { echo "compose env scan: $compose_file neexistuje" >&2; return 1; }
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  refs=$(node "$root/scripts/lib/compose-env-refs.mjs" "$compose_file" ${rezim:+"$rezim"}) || {
    echo "compose env scan: $compose_file nejde přečíst YAML parserem — seznam proměnných NEZNÁMÝ" >&2
    return 1
  }
  printf '%s\n' "$refs" | grep -vE '^SERVICE_(FQDN|URL|USER|PASSWORD|BASE)_' | awk 'NF' || true
}

extract_compose_vars() {
  _compose_refs "$1"
}

# Vypíše unikátní jména ARG deklarací ze všech Dockerfiles, na které compose
# odkazuje v build: blocích (dockerfile: <path>; cesty jsou relativní k repo
# rootu — build context je v tomto repu vždy repo root). Tyto klíče compose
# TEXTOVĚ nereferencuje, ale build je konzumuje (Coolify je při buildtime=true
# injektuje jako ARG hodnoty) — bez nich per-app filtr klíče nedoručí a build
# selže až za běhu (cold-start 2026-06-11: aisha-core web/render-app-config
# FATAL missing VITE_* — hodnoty existovaly v .env.coolify, filtr je nepustil).
extract_dockerfile_arg_vars() {
  local compose_file="$1"
  local root_dir
  root_dir="$(cd "$(dirname "$compose_file")" && pwd)"
  grep -vE '^[[:space:]]*#' "$compose_file" \
    | grep -oE '^[[:space:]]+dockerfile:[[:space:]]*[^[:space:]]+' \
    | awk '{print $2}' \
    | sort -u \
    | while IFS= read -r df; do
        [ -f "$root_dir/$df" ] || continue
        grep -hoE '^ARG[[:space:]]+[A-Z_][A-Z0-9_]*' "$root_dir/$df" | awk '{print $2}'
      done \
    | grep -vE '^SERVICE_(FQDN|URL|USER|PASSWORD|BASE)_' \
    | sort -u
}

extract_required_compose_vars() {
  # „Bez defaultu" = holé ${VAR}/$VAR i ${VAR:?}/${VAR?}: compose nemá čím mezeru
  # zaplnit. Co z toho compose SHODÍ, rozlišuje scripts/lib/povinne-promenne.mjs.
  _compose_refs "$1" --bez-defaultu
}

# Names of ${VAR} placeholders inside any realm-import TEMPLATE the app BAKES —
# the third derived key source, for the same reason as the Dockerfile ARGs above.
#
# An app can render a config file at runtime from a template baked into its
# image (Keycloak: Dockerfile COPYs keycloak/aisha-realm.json, render-realm
# substitutes ${VAR} at start-up). The compose TEXT never mentions those vars,
# so the per-app filter did not deliver them — and the value sat in .env.coolify
# unused. A fork sync added an openclaw-proxy client using ${COMPANION_DOMAIN},
# the keycloak container never received COMPANION_DOMAIN, the placeholder stayed
# literal in the rendered realm, and Keycloak refused every start with
# "Invalid client openclaw-proxy: A redirect URI is not a valid URI". It only
# fires on a FRESH database, exactly like the VITE_* incident this file already
# guards for Dockerfile ARGs.
#
# DERIVED, generic: any app whose Dockerfile COPYs a *realm*.json gets that
# template's placeholders delivered. A new client with a new domain is covered
# the day it is added to the realm — no per-app list to keep. UPPER_CASE only,
# matching render-realm; Keycloak's own ${client_id} placeholders are lower-case
# and stay literal on purpose.
extract_realm_template_vars() {
  local compose_file="$1"
  local root_dir
  root_dir="$(cd "$(dirname "$compose_file")" && pwd)"
  grep -vE '^[[:space:]]*#' "$compose_file" \
    | grep -oE '^[[:space:]]+dockerfile:[[:space:]]*[^[:space:]]+' \
    | awk '{print $2}' \
    | sort -u \
    | while IFS= read -r df; do
        [ -f "$root_dir/$df" ] || continue
        # Source paths of COPY'd realm templates (COPY <src> <dst>).
        grep -hoE '^COPY[[:space:]]+[^[:space:]]*realm[^[:space:]]*\.json' "$root_dir/$df" \
          | awk '{print $2}' \
          | while IFS= read -r tmpl; do
              [ -f "$root_dir/$tmpl" ] || continue
              grep -oE '\$\{[A-Z_][A-Z0-9_]*\}' "$root_dir/$tmpl" | sed -E 's/^\$\{//; s/\}$//'
            done
      done \
    | sort -u
}

# Globální paralelní pole (bash 3.2 kompatibilní)
APP_NAMES=()
APP_COMPOSES=()

# Service ids that config/services.json gates behind provision_when_env whose
# variable is NOT set — i.e. services this deployment does not provision.
#
# WHY THIS EXISTS: the topology resolver already skips them
# (scripts/lib/derive-domains.mjs: `if (svc.provision_when_env &&
# !process.env[svc.provision_when_env]) continue;`), but the env validator built
# on this map did not. Two components then disagreed about which services exist:
# the resolver produced no domains for an unprovisioned service while the
# validator still demanded every variable its compose references, and reported
# them as MISSING keys blocking cold-start. The operator was told to add
# credentials for a service they had deliberately not opted into.
#
# Derived from the catalog in one query — no list of service names lives here,
# so a fifth opt-in service is covered the day it declares its gate.
_unprovisioned_services() {
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  # Bez katalogu nebo bez node se na brány NEDÁ odpovědět. Dřív tu stálo
  # `return 0`, tedy „nic není vypnuté" — a mapa pak zahrnula i služby, které se
  # nenasazují. Neměřeno se nesmí vydávat za prázdný nález.
  [ -f "$root/config/services.json" ] || { echo "brány opt-in služeb: $root/config/services.json chybí" >&2; return 1; }
  command -v node >/dev/null 2>&1 || { echo "brány opt-in služeb: node chybí" >&2; return 1; }
  # The gate values are read from the instance's env FILE first, and only then
  # from the ambient shell.
  #
  # Reading process.env alone made the answer depend on HOW the script was
  # invoked rather than on what the instance declares. Cold-start exports these
  # variables, so opt-in services got created; a later standalone run (an env
  # sync, a preflight) did not export them, so the SAME services were classified
  # unprovisioned and dropped from the app→compose map. They then reported
  # "not in the manifest" while sitting in it, and their env was never synced —
  # measured 2026-07-21: <fork>-local-ingest and <fork>-potok kept a setup key from a
  # destroyed management DB because no sync ever reached them, while
  # INGEST_BUNDLE_GIT_URL was declared in .env.coolify the whole time.
  #
  # The env file is the durable declaration; the shell is a per-invocation
  # accident. Ambient still wins when explicitly set, so an operator can flip a
  # lane for one run without editing the file.
  local env_file="${ENV_FILE:-$root/.env.coolify}"
  # Co je „zapnuto", rozhoduje jeden domov (lib/provision-gate.mjs): i `false`
  # je vypínač. Selže-li čtení katalogu, mapa se NESESTAVÍ — prázdný seznam
  # vypnutých by tiše validoval a syncoval služby, které se nenasazují.
  node "$root/scripts/lib/provision-gate.mjs" --neprovisionovane --env-file "$env_file"
}

load_app_compose_map() {
  local manifest_file="$1"
  [ -f "$manifest_file" ] || { echo "load_app_compose_map: $manifest_file neexistuje" >&2; return 1; }
  APP_NAMES=()
  APP_COMPOSES=()
  APP_SLOTS=()
  local _skip_list
  local _neprovisionovane
  _neprovisionovane="$(_unprovisioned_services)" || {
    echo "load_app_compose_map: brány opt-in služeb nejdou vyhodnotit — mapu nesestavím" >&2
    return 1
  }
  _skip_list=" $(printf '%s' "$_neprovisionovane" | tr '\n' ' ') "
  while IFS= read -r line; do
    # formát: app: <name>:<server>:<compose-file>[:tag=value...]
    # Tag suffix (např. :bluegreen=on) je opt-in — story-init pak vytvoří B/G pair.
    # Pro sync-envs / preflight chceme jen čistou cestu k compose souboru.
    [[ "$line" =~ ^app:[[:space:]]*([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+):(.+)$ ]] || continue
    local compose_with_tags="${BASH_REMATCH[3]}"
    local app_id="${BASH_REMATCH[1]}"
    # Opt-in service the operator did not enable: not deployed, so its compose
    # must not be validated either. Same rule the topology resolver applies.
    case "$_skip_list" in *" $app_id "*) continue ;; esac
    APP_NAMES+=("$app_id")
    APP_SLOTS+=("${BASH_REMATCH[2]}")
    APP_COMPOSES+=("${compose_with_tags%%:*}")
  done < "$manifest_file"
}

# Slot (server label) aplikace podle manifestu — TÝŽ zdroj, kterým story-init
# rozhoduje umístění. Prázdný výstup = aplikace není v mapě (gated-off/cizí).
resolve_slot_for_app() {
  local needle="${1#aisha-}"
  local i
  for i in "${!APP_NAMES[@]}"; do
    if [ "${APP_NAMES[$i]}" = "$needle" ]; then
      echo "${APP_SLOTS[$i]}"
      return 0
    fi
  done
  return 1
}

# ─────────────────────────────────────────────────────────────────────────────
# UMÍSTĚNÍ MÁ DVA ZAPISOVATELE — a musí souhlasit
#
# ⛔ NAMĚŘENO 2026-08-25. Umístění služby říkají DVA soubory a nikdo je
# neporovnával:
#
#   manifest (`app: <id>:<slot>:<compose>`)  → kam Coolify aplikaci NASADÍ
#                                              a jaký slot vidí sync-envs
#   profil   (`service_overrides.<id>.placement`) → jakou ADRESU vydá derivace
#
# Na téhle instanci se rozešly přesně u netbirdu: manifest `frontend` (talos),
# profil `backend` (giah). Profil ten přesun udělal ZÁMĚRNĚ a svou poznámkou
# vysvětluje proč — netbird má bydlet u pki, aby `pki-init` dostal kolokovaný
# hop `http://<prefix>-pki-bridge:3040`. Ten krok mesh certifikát teprve RAZÍ,
# takže po mesh chodit nemůže a přes veřejnou adresu by potřeboval certifikát,
# který v tu chvíli ještě neexistuje.
#
# Následek rozporu byl tichý a projevil se o tři kroky dál: sync poslal
# netbirdu globální `PKI_BRIDGE_URL` (cross-host https), `pki-init` skončil
# exit 1, netbird `exited:unhealthy`, vlna 5 zastavena, mesh nevznikl — a
# hlášku o certifikátu nikdo nespojil s umístěním v manifestu.
#
# Manifest je navíc LOCAL-ONLY (mimo git, viz jeho hlavička), takže tenhle
# rozpor nemůže odhalit žádná brána v repu. Proto se kontroluje ZA BĚHU, tady,
# kde jsou obě hodnoty poprvé pohromadě: manifest v `APP_SLOTS`, profil
# v `<ID>_PLACEMENT`, které derive-domains vydává pro každou službu.
#
# Fail-closed: rozpor se NEOPRAVUJE dosazením. Který z těch dvou je správně, ví
# jen operátor — dosadit jeden by znamenalo tiše přesunout službu na jiný stroj,
# nebo tiše vydat adresu pro stroj, kde nic neběží.
#
# Volá se s načtenou mapou (`load_app_compose_map`) a s prostředím, kam se
# sourcovalo `.env.coolify`. Návrat 0 = shoda, 1 = rozpor (vypsán na stderr).
# ─────────────────────────────────────────────────────────────────────────────
assert_placement_agrees() {
  local i app slot var prof mismatches=0

  for i in "${!APP_NAMES[@]}"; do
    app="${APP_NAMES[$i]}"
    slot="${APP_SLOTS[$i]}"
    # `<ID>_PLACEMENT` — táž transformace, jakou používá derive-domains.
    var="$(printf '%s' "$app" | tr '[:lower:]-' '[:upper:]_')_PLACEMENT"
    prof="${!var:-}"

    # Profil o službě nemluví → manifest je jediný zdroj a rozpor nevzniká.
    [ -n "$prof" ] || continue
    [ "$prof" = "$slot" ] && continue

    if [ "$mismatches" -eq 0 ]; then
      echo "" >&2
      echo "  ⛔ UMÍSTĚNÍ SE NESHODUJE — manifest a profil si odporují:" >&2
      echo "" >&2
      printf '     %-22s %-14s %s\n' "služba" "manifest" "profil" >&2
    fi
    printf '     %-22s %-14s %s\n' "$app" "$slot" "$prof" >&2
    mismatches=$((mismatches + 1))
  done

  [ "$mismatches" -eq 0 ] && return 0

  echo "" >&2
  echo "     Manifest rozhoduje, KAM se aplikace nasadí; profil, jakou ADRESU dostane." >&2
  echo "     Když se rozejdou, služba běží jinde, než kam ostatní míří — a projeví se to" >&2
  echo "     až u někoho třetího (kolokace pki, mesh bootstrap, cross-node hop)." >&2
  echo "" >&2
  echo "     Sjednoť je. Který je správně, VÍ JEN OPERÁTOR:" >&2
  echo "       • má služba běžet jinde  → oprav slot v manifestu instance (app: <id>:<slot>:<compose>)" >&2
  echo "       • má zůstat, kde je      → oprav placement v profiles/<profil>.json (instanční overlay)" >&2
  echo "" >&2
  return 1
}

# Does the manifest DECLARE this app at all, ignoring provision gates?
#
# load_app_compose_map() drops gated-off services from the map, so "not in the
# map" answers two different questions at once: "this deployment does not own the
# app" and "this deployment owns it but the lane is not armed". Callers that
# report the first for the second tell the operator something false — and hide a
# running app whose env is silently never synced.
manifest_declares_app() {
  local manifest_file="$1" needle="${2#aisha-}"
  [ -f "$manifest_file" ] || return 1
  local line
  while IFS= read -r line; do
    [[ "$line" =~ ^app:[[:space:]]*([a-zA-Z0-9_-]+):[a-zA-Z0-9_-]+:(.+)$ ]] || continue
    [ "${BASH_REMATCH[1]}" = "$needle" ] && return 0
  done < "$manifest_file"
  return 1
}

resolve_compose_for_app() {
  local needle="$1"
  # akceptuj i s prefixem aisha-
  needle="${needle#aisha-}"
  local i
  for i in "${!APP_NAMES[@]}"; do
    if [ "${APP_NAMES[$i]}" = "$needle" ]; then
      echo "${APP_COMPOSES[$i]}"
      return 0
    fi
  done
  return 1
}
