#!/usr/bin/env bash
# ==============================================================================
# coolify-deploy-init.sh — Multi-stack Coolify deployment + Forgejo CI/CD setup
# ==============================================================================
#
# Automatizuje setup VŠECH 4 Coolify stacků a Forgejo CI/CD:
#
#   Stack       Compose file                         Popis
#   ─────────── ──────────────────────────────────── ──────────────────────────
#   core        docker-compose.coolify.yml           AISHA core (DB, Auth, API…)
#   keycloak    docker-compose.coolify-keycloak.yml  OIDC Identity Provider
#   web         docker-compose.coolify-prebuilt.yml  Frontend + migrace
#   langfuse    docker-compose.coolify-langfuse.yml  AI Observability
#   admin       docker-compose.coolify-admin.yml     NocoDB + Appsmith
#
# Pro každý stack:
#   1. Najde existující Coolify aplikaci (nebo požádá o UUID)
#   2. Nastaví env vars v Coolify (idempotentně — POST, fallback PATCH)
#   3. Pro web stack: nastaví COOLIFY_WEBHOOK_URL v Forgejo
#
# Prerekvizity:
#   - jq nainstalován (brew install jq / apt install jq)
#   - curl nainstalován
#   - Coolify API token (Settings → API Tokens v Coolify UI)
#   - Forgejo API token (Settings → Applications v Forgejo UI)
#
# Použití:
#   # Všechny stacky (default):
#   bash scripts/coolify-deploy-init.sh
#
#   # Konkrétní stack(y):
#   bash scripts/coolify-deploy-init.sh --stack web
#   bash scripts/coolify-deploy-init.sh --stack core,langfuse
#
#   # S tokeny jako env vars:
#   COOLIFY_API_TOKEN=xxx FORGEJO_API_TOKEN=xxx bash scripts/coolify-deploy-init.sh
#
#   # Dry run (jen ukáže co by udělal):
#   DRY_RUN=1 bash scripts/coolify-deploy-init.sh
#
# Idempotentní: při opakovaném spuštění aktualizuje existující konfiguraci.
# ==============================================================================

set -euo pipefail

# ── Identita instance: jediný zdroj, fail-closed ─────────────────────────────
# Vrátí prefix instance, nebo skončí chybou. ŽÁDNÝ default — dosazené „aisha"
# je přesně ta vlastnost, která z chybějící proměnné dělá zásah do cizího
# provozu: 2026-08-04 tak deploy z forku nasadil upstream core, produkci
# jiného zákazníka. Prefix rozhoduje o tom, které aplikace se objeví ve výběru
# (`startswith("<prefix>-")`), takže „nevím" nesmí znamenat „vezmi upstream".
#
# Upstream stack deklaruje svou identitu stejně jako kdokoli jiný
# (APP_NAME_PREFIX=aisha), takže tím o nic nepřichází.
#
# Tahle funkce existuje proto, že týž fallback byl v tomhle souboru DVAKRÁT.
# Opravit jednu kopii by neznamenalo opravit vadu.
require_instance_prefix() {
  local p="${APP_NAME_PREFIX:-${AISHA_STORY:-}}"
  if [ -z "$p" ]; then
    echo "FATAL: APP_NAME_PREFIX ani AISHA_STORY nejsou nastavené — nevím, KTERÉ instance se to týká." >&2
    echo "       Výchozí hodnota se ZÁMĚRNĚ nedosazuje: dosazené 'aisha' by z forku mířilo na cizí aplikace." >&2
    echo "       Deklaruj APP_NAME_PREFIX=<instance> v prostředí nebo v .env.coolify." >&2
    return 1
  fi
  printf '%s' "$p"
}

# ── Barvy ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()   { echo -e "${BLUE}ℹ${NC}  $*"; }
ok()     { echo -e "${GREEN}✅${NC} $*"; }
warn()   { echo -e "${YELLOW}⚠️${NC}  $*"; }
err()    { echo -e "${RED}❌${NC} $*" >&2; }

# ── Hodnota, která jmenuje CIZÍ instanci, se nesmí ZDĚDIT ───────────────────
#
# ⛔ NAMĚŘENO 2026-08-20: `N8N_DB_HOST=aisha-db` leželo v SoT a n8n na něm
# viselo hodinu na „waiting for DB…". To jméno se v síti téhle instance
# NEROZLOŽÍ (ověřeno `getent` z kontejneru). Generátor byl přitom správně —
# `aisha-cold-start.sh` vydává `${APP_NAME_PREFIX}-db` — jenže se ke slovu
# vůbec nedostal.
#
# Past je v TVARU té pojistky:
#     VAR="${VAR:-${APP_NAME_PREFIX:?identita se NEHÁDÁ}-db}"
# `:?` sedí UVNITŘ větve, která se vykoná jen když hodnota CHYBÍ — tedy
# právě tehdy, kdy není co hlídat. Existující hodnota jmenující cizí
# instanci projde beze slova. Pojistka je nedosažitelná přesně tehdy,
# kdy je potřeba.
#
# Proto se identita ověřuje AŽ NAD VÝSLEDKEM. Že se na to u dalšího klíče
# nedá zapomenout, hlídá brána `pojistka-identity-se-nesmi-minout`.
vyzaduj_identitu() {
  local __k="$1" __v="$2"
  [ -n "$__v" ] || return 0          # prázdno je věc `:?` u konzumenta, ne tahle
  case "$__v" in
    *"${APP_NAME_PREFIX:?identita instance není známa}-"*) return 0 ;;
  esac
  err "HODNOTA JMENUJE CIZÍ INSTANCI — odmítám nasazovat."
  err "  ${__k}=${__v}"
  err "  Tahle instance je '${APP_NAME_PREFIX}', takže hostitel má nést"
  err "  '${APP_NAME_PREFIX}-'. Cizí jméno se na sdíleném hostiteli buď"
  err "  NEROZLOŽÍ (výpadek), nebo trefí CIZÍHO nájemníka (horší)."
  err ""
  err "CO S TÍM: oprav hodnotu v .env.coolify (SoT). Je to zbytek po dřívějším"
  err "  generování — skript ji sám nepřepíše, protože '\${VAR:-…}' dává"
  err "  přednost existující hodnotě."
  err "NEDĚLEJ: nepřidávej výjimku a neměň tohle na varování. Tichý průchod je"
  err "  přesně to, co n8n na hodinu položilo."
  exit 1
}
step()   { echo -e "\n${BLUE}━━━ $* ━━━${NC}"; }
banner() { echo -e "\n${CYAN}═══ $* ═══${NC}"; }

# ── Konfigurace ───────────────────────────────────────────────────────────────
COOLIFY_URL="${COOLIFY_URL:-}"
# Iter 22h (May 2026): derive FORGEJO_URL from FORGEJO_DOMAIN if not explicitly
# set — same fallback chain as coolify-story-init.sh line 62-72. Operator's
# config/domains.env (or .example fallback) provides FORGEJO_DOMAIN; cold-start
# script sources that file before invoking us.
# The canonical chain comes FIRST, before deriving from FORGEJO_DOMAIN.
#
# FORGEJO_DOMAIN is a DERIVED topology name — on a profile with an internal TLD
# it resolves to repo.<internal_tld>, which is a zone the git host does not live
# in and DNS does not answer for. The operator's real Forgejo URL was sitting in
# .env.coolify all along (`FORGEJO_URL=https://repo.<real-host>`), but this
# script never read that file, so an unset shell variable fell straight through
# to the internal derivation and post-wipe deploy-init died on
# "Nelze se připojit k Forgejo API" pointing at a host that cannot exist.
#
# Derivation stays as the last resort for installs that genuinely host Forgejo
# inside their own zone.
# shellcheck source=scripts/lib/coolify-credentials.sh
if [ -z "${FORGEJO_URL:-}" ] && [ -f "${ROOT:-$(dirname "$0")/..}/scripts/lib/coolify-credentials.sh" ]; then
  . "${ROOT:-$(dirname "$0")/..}/scripts/lib/coolify-credentials.sh"
  FORGEJO_URL="$(config_env_key FORGEJO_URL 2>/dev/null || true)"
fi
if [ -z "${FORGEJO_URL:-}" ] && [ -n "${FORGEJO_DOMAIN:-}" ]; then
  FORGEJO_URL="https://${FORGEJO_DOMAIN}"
fi
FORGEJO_URL="${FORGEJO_URL:?FORGEJO_URL required (set FORGEJO_DOMAIN in config/domains.env or FORGEJO_URL in .env-prod-backup)}"
# Canonicalize operator inputs at the boundary. Existing environments may use
# FORGEJO_REPO=aisha/evymo-ai-orchestrator while newer ones split owner/repo.
# Without normalization the API path becomes /repos/aisha/aisha/repo and CI
# secrets are never updated. A trailing slash on FORGEJO_URL caused the same
# duplication in user-facing clone links.
normalize_forgejo_coordinates() {
  FORGEJO_URL="${FORGEJO_URL%/}"
  local repo_path=""
  if [[ "${FORGEJO_REPO:-}" == */* ]]; then
    repo_path="${FORGEJO_REPO#/}"
  elif [ -z "${FORGEJO_REPO:-}" ] && [ -n "${FORGEJO_REPO_PATH:-}" ]; then
    repo_path="${FORGEJO_REPO_PATH#/}"
  fi
  if [ -n "$repo_path" ]; then
    repo_path="${repo_path%.git}"
    # An owner-qualified repository is a complete coordinate and therefore
    # wins over a stale separately-exported owner.
    FORGEJO_OWNER="${repo_path%%/*}"
    FORGEJO_REPO="${repo_path##*/}"
  fi
  # ⛔ ŽÁDNÝ FALLBACK (2026-08-24). Nad tímhle řádkem se OWNER odvozuje z remote;
  # když se to nepovede, nesmí se dosadit donor — ukazoval by na cizí repo.
  FORGEJO_OWNER="${FORGEJO_OWNER:?FORGEJO_OWNER se nepodařilo odvodit z git remote — deklaruj ho}"
  FORGEJO_REPO="${FORGEJO_REPO:-$(basename "${PWD}")}"
  FORGEJO_REPO="${FORGEJO_REPO%.git}"
}

# ── Stack definitions (bash 3 compatible — no associative arrays) ─────────────
# llm-gateway + openclaw are tier=optional autopilot capabilities (Phase 2).
# Their deploy steps skip silently when the Coolify app isn't provisioned
# (the discovery loop returns empty UUID → set_coolify_env_if no-op).
ALL_STACKS="registry core pgadmin keycloak integration edge extranet observability monitoring admin orchestration messaging pki ledger exec netbird llm-gateway openclaw source-broker local-ingest potok realtime observability-stack livekit"

# ⛔ OPT-IN SLUŽBA, KTEROU OPERÁTOR NEZAPNUL, SE NENASAZUJE (2026-08-25).
#
# Ten seznam výš je LITERÁL — neptá se manifestu ani provisioning brány. Na této
# instanci je `source-broker` tier=optional a vyžaduje SOURCE_API_URL, které je
# prázdné; aplikace tedy v Coolify nikdy nevznikla. Deploy-init na ni přesto
# došel, nenašel ji a INTERAKTIVNĚ se zeptal na UUID — v neinteraktivním běhu je
# stdin zavřený, takže se prompt přečetl jako prázdná odpověď a celý krok skončil
# exit 1. V logu cold-startu z toho zbylo jen "deploy-init failed", bez zmínky
# o tom, která aplikace a proč.
#
# Pravidlo „nezapnutá opt-in služba se přeskakuje" v repu UŽ JE —
# `_unprovisioned_services()` (scripts/lib/coolify-app-vars.sh), které používá
# `load_app_compose_map`. Deploy-init ho jen neaplikoval. Tady se dopočítá týmž
# zdrojem, takže obě cesty vidí stejnou množinu služeb.
# Vlastní adresář, ne pracovní: `${REPO_ROOT:-.}` tu bylo dvakrát, jenže
# REPO_ROOT tenhle skript nikdy nedefinuje — takže se VŽDY použil fallback `.`
# a chod závisel na tom, odkud se skript spustí. Fallback nad cestou je táž
# třída jako fallback nad identitou: tiše funguje, dokud nezmění kontext.
_di_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/coolify-app-vars.sh
. "$_di_dir/lib/coolify-app-vars.sh"

# ── STACKY PODLE MANIFESTU INSTANCE ──────────────────────────────────────────
# ⛔ NAMĚŘENO 2026-09-13 (audit cesty cold-startu nad guru). Literál ALL_STACKS
# výš neznal web-render, shared-redis, ai-chat, domain-services, model, clamav,
# playwright, netinit-* ani mesh-router-* — tyto aplikace tedy nedostaly
# COMPOSE_PROFILES ani build-time VERDACCIO_*, a při MESH_ENABLED=true se jejich
# služby s `profiles: ["mesh"]` vůbec nespustily. Tiše: seznam se nikdy nesrovnal
# s tím, co instance opravdu nasazuje.
#
# Autorita je manifest instance (tatáž mapa, podle které sync posílá env —
# load_app_compose_map) bez služeb s vypnutou lane. Literál zůstává pro stacky se
# specifickou konfigurací; manifest k němu DOPLNÍ ty, které nezná (obecná
# konfigurace níž), a vyřadí nezapnuté opt-in služby.
_di_manifest="${MANIFEST_FILE:-}"
if [ -z "$_di_manifest" ]; then
  _di_manifest="$(node "$_di_dir/lib/coolify-instance-scope.mjs" --manifest-path)" || {
    err "Manifest instance nejde určit — nevím, které stacky tahle instance nasazuje."
    exit 1
  }
fi
load_app_compose_map "$_di_manifest" || { err "Mapu aplikací z manifestu ${_di_manifest} nejde sestavit."; exit 1; }
DI_MANIFEST_STACKS=" ${APP_NAMES[*]} "
_di_gated=" $(_unprovisioned_services | tr '\n' ' ') "
_di_kept=""
for _di_s in $ALL_STACKS; do
  case "$_di_gated" in *" $_di_s "*) continue ;; esac   # opt-in, operátor ji nezapnul
  _di_kept="${_di_kept}${_di_s} "
done
for _di_s in "${APP_NAMES[@]}"; do
  case " $_di_kept " in *" $_di_s "*) ;; *) _di_kept="${_di_kept}${_di_s} " ;; esac
done
ALL_STACKS="${_di_kept% }"
[ "$_di_gated" != "  " ] && echo "  ℹ Vynechány nezapnuté opt-in služby:${_di_gated%  }" >&2
unset _di_gated _di_kept _di_s
# Stacky z manifestu, které by se bez odpovídající aplikace v Coolify NENASTAVILY.
DI_NEDOKONCENO=()

stack_compose() {
  case "$1" in
    registry)      echo "docker-compose.coolify-registry.yml" ;;
    core)          echo "docker-compose.coolify.yml" ;;
    pgadmin)       echo "docker-compose.coolify-pgadmin.yml" ;;
    keycloak)      echo "docker-compose.coolify-keycloak.yml" ;;
    integration)   echo "docker-compose.coolify-integration.yml" ;;
    edge)          echo "docker-compose.coolify-prebuilt.yml" ;;
    extranet)      echo "docker-compose.coolify-extranet.yml" ;;
    observability) echo "docker-compose.coolify-langfuse.yml" ;;
    monitoring)    echo "docker-compose.coolify-monitoring.yml" ;;
    admin)         echo "docker-compose.coolify-admin.yml" ;;
    orchestration) echo "docker-compose.coolify-n8n.yml" ;;
    messaging)     echo "docker-compose.coolify-matrix.yml" ;;
    pki)           echo "docker-compose.coolify-pki.yml" ;;
    ledger)        echo "docker-compose.coolify-cosmos.yml" ;;
    exec)          echo "docker-compose.coolify-exec.yml" ;;
    netbird)       echo "docker-compose.coolify-netbird.yml" ;;
    llm-gateway)   echo "docker-compose.coolify-llm-gateway.yml" ;;
    openclaw)      echo "docker-compose.coolify-openclaw.yml" ;;
    source-broker) echo "docker-compose.coolify-source-broker.yml" ;;
    local-ingest)  echo "docker-compose.coolify-local-ingest.yml" ;;
    potok)         echo "docker-compose.coolify-potok.yml" ;;
    realtime)      echo "docker-compose.coolify-realtime.yml" ;;
    observability-stack) echo "docker-compose.coolify-observability.yml" ;;
    livekit)       echo "docker-compose.coolify-livekit.yml" ;;
    *)             resolve_compose_for_app "$1" ;;   # stack z manifestu, který literál nezná
  esac
}

stack_label() {
  case "$1" in
    core)          echo "Core (AISHA backbone: PG17 + PostgREST + aisha-gateway + MinIO + Redis + plugin-system)" ;;
    pgadmin)       echo "pgAdmin (internal DB administration)" ;;
    keycloak)      echo "Keycloak (OIDC Identity Provider)" ;;
    integration)   echo "Integration (ES + Ragnarok + RabbitMQ)" ;;
    edge)          echo "Edge (Frontend SPA — Frontend public)" ;;
    extranet)      echo "Extranet (customer surface — surface-host SPA; domain routed via edge)" ;;
    observability) echo "Observability (Langfuse)" ;;
    monitoring)    echo "Monitoring (Dozzle + OIDC proxy)" ;;
    admin)         echo "Admin (NocoDB + Appsmith)" ;;
    orchestration) echo "Orchestration (n8n Workflow Engine)" ;;
    messaging)     echo "Messaging (Matrix Synapse + Element)" ;;
    livekit)     echo "LiveKit (Voice/Video + TURN) [legacy]" ;;
    pki)         echo "PKI (Internal Certificate Authority)" ;;
    ledger)      echo "Ledger (Cosmos SDK Chain)" ;;
    exec)        echo "Exec (Isolated execution plane — Experimental, Kata Containers)" ;;
    netbird)     echo "Netbird (Mesh VPN — management + signal + relay)" ;;
    registry)    echo "Registry (Docker Hub pull-through cache)" ;;
    llm-gateway) echo "LLM Gateway (theopenco/llmgateway — IDE proxy + batch endpoint passthrough) [Phase 2D]" ;;
    openclaw)    echo "OpenClaw (advisory planner + sandbox + multi-channel notify) [Phase 2B]" ;;
    source-broker) echo "Source Broker (federation RPC — external source app's users → aisha session; tier=optional, requires SOURCE_API_URL)" ;;
    local-ingest) echo "Local Ingest (verified document ingestion engine — 3-gate validator, export bundles; tier=optional, requires INGEST_BUNDLE_GIT_URL)" ;;
    potok)       echo "Potok (flow-definition runtime — verification gates + provenance, gen via Omni /v1; tier=optional, requires POTOK_ENABLED)" ;;
    realtime)    echo "Realtime (WebSocket + event fabric)" ;;
    observability-stack) echo "Observability stack (Grafana + Loki + Prometheus)" ;;
    *)           echo "$1 (z manifestu instance)" ;;
  esac
}

stack_app_name() {
  # Tenant-aware app discovery: prefix derives from APP_NAME_PREFIX env
  # (generated by scripts/init-new-tenant.sh into the per-tenant overlay
  # `config/domains-<INSTANCE>.env` as `APP_NAME_PREFIX=<INSTANCE>`).
  # Defaults to the STORY (AISHA_STORY), falling back to "aisha" only for the
  # upstream stack — never hardcode "aisha", or a fork deploy that did not set
  # APP_NAME_PREFIX would discover and mutate the upstream aisha-* apps.
  local prefix
  prefix="$(require_instance_prefix)" || exit 2
  case "$1" in
    core)          echo "${prefix}-core" ;;
    pgadmin)       echo "${prefix}-pgadmin" ;;
    keycloak)      echo "${prefix}-keycloak" ;;
    integration)   echo "${prefix}-integration" ;;
    web|edge)      echo "${prefix}-edge" ;;
    extranet)      echo "${prefix}-extranet" ;;
    langfuse|observability) echo "${prefix}-observability" ;;
    monitoring)    echo "${prefix}-monitoring" ;;
    admin)         echo "${prefix}-admin" ;;
    n8n|orchestration) echo "${prefix}-orchestration" ;;
    matrix|messaging) echo "${prefix}-messaging" ;;
    pki)           echo "${prefix}-pki" ;;
    ledger)        echo "${prefix}-ledger" ;;
    exec)          echo "${prefix}-exec" ;;
    netbird)       echo "${prefix}-netbird" ;;
    registry)      echo "${prefix}-registry" ;;
    llm-gateway)   echo "${prefix}-llm-gateway" ;;
    openclaw)      echo "${prefix}-openclaw" ;;
    source-broker) echo "${prefix}-source-broker" ;;
    local-ingest)  echo "${prefix}-local-ingest" ;;
    potok)         echo "${prefix}-potok" ;;
    realtime)      echo "${prefix}-realtime" ;;
    observability-stack) echo "${prefix}-observability-stack" ;;
    livekit)       echo "${prefix}-livekit" ;;
    *)             echo "${prefix}-$1" ;;
  esac
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
# Env soubor prostředí z jednoho domova (PR2 izolace): ve stagingu `.env.<env>`,
# ne produkční `.env.coolify`. Cold-start předává ENV_FILE výslovně.
# shellcheck source=lib/prostredi-behu.sh
. "$SCRIPT_DIR/lib/prostredi-behu.sh"
DEPLOY_ENV_SOUBOR="${ENV_FILE:-$(pb_env_soubor "$PROJECT_ROOT" "${AISHA_ENV:-}")}" || {
  echo "✗ AISHA_ENV=${AISHA_ENV:-} není známý tvar prostředí." >&2; exit 1; }
source "$PROJECT_ROOT/scripts/lib/coolify-buildtime-envs.sh"
source "$PROJECT_ROOT/scripts/lib/coolify-our-apps.sh"

# ── Bariéra: než sáhneme na domény, musí mít Coolify načtený compose ─────────
#
# ⛔ NAMĚŘENO 2026-08-17: bez toho vrací PATCH domén 422 a cold-start dojel
# s instancí bez jediné Traefik routy (16 stacků ze 16). Plničem je asynchronní
# úloha `LoadComposeFile`; doba doručení je vlastnost TÉ fronty:
#   prázdná fronta          → do 8 s
#   fronta pod cold-startem → ~1 h (naměřeno na 31 aplikacích)
# Seed hodnoty v create payloadu to neobejde (ověřeno živě — Coolify ji zahodí).
#
# Čeká se tedy JEDNOU pro všechny, ne per aplikaci: fronta se plní sériově,
# takže jeden společný barrier je i nejrychlejší. Průběh se hlásí, aby to nikdy
# nebylo tiché čekání — a po vypršení se pokračuje s pojmenovaným následkem,
# ne mlčky: doména se nenastaví jen tam, kde compose chybí.
cekej_na_compose() {
  local api="${COOLIFY_URL%/}/api/v1" token="${COOLIFY_API_TOKEN:-${COOLIFY_API_KEY:-}}"
  local budget="${COMPOSE_RAW_WAIT_SECONDS:-1800}" step=15
  local zacatek chybi pocet apps
  local nemereno=0 mereno_aspon_raz=0
  zacatek=$(date +%s)
  while :; do
    apps=$(coolify_our_applications "$api" "$token" 2>/dev/null) || apps=""
    # ⛔ NAMĚŘENO 2026-08-17: tady se dřív na první nedoručený seznam čekání
    # VZDALO („NEMĚŘENO, pokračuji") — a přesně to se stalo: endpoint se seznamem
    # je ~1,3 MB a při load average 15 (běžící buildy) jednou vypršel. Bariéra
    # to vzala za výsledek a pustila krok 4 dál, takže 4 aplikace zůstaly bez
    # domény, přestože compose byl za chvíli k dispozici.
    #
    # Selhání nástroje NENÍ měření. Neúspěšný odečet je důvod měřit znovu,
    # ne přestat čekat. Vzdát se smí teprve rozpočet — a jen s tím, že se
    # nahlas řekne, že se za celou dobu nepodařilo změřit vůbec nic.
    if [ -z "$apps" ]; then
      nemereno=$((nemereno + 1))
      local uplynulo_n=$(( $(date +%s) - zacatek ))
      if [ "$uplynulo_n" -ge "$budget" ]; then
        if [ "$mereno_aspon_raz" = "0" ]; then
          warn "  compose bariéra: za ${uplynulo_n}s se seznam aplikací nepodařilo zjistit ANI RAZ (${nemereno} pokusů) — NEMĚŘENO"
          warn "    Domény se budou nastavovat naslepo; co selže, se pozná až z hlášky u jednotlivých stacků."
        fi
        return 0
      fi
      warn "  compose bariéra: seznam aplikací nedorazil (pokus ${nemereno}) — opakuji za ${step}s (${uplynulo_n}/${budget}s)"
      sleep "$step"
      continue
    fi
    mereno_aspon_raz=1
    chybi=$(coolify_apps_without_compose_raw "$apps")
    pocet=$(printf '%s' "$chybi" | grep -c . || true)
    [ "${pocet:-0}" -eq 0 ] && { ok "  compose bariéra: všechny aplikace mají načtený compose"; return 0; }
    local uplynulo=$(( $(date +%s) - zacatek ))
    if [ "$uplynulo" -ge "$budget" ]; then
      warn "  compose bariéra: po ${uplynulo}s stále ${pocet} aplikací bez compose — domény jim nastavit nepůjde"
      warn "    $(printf '%s' "$chybi" | tr '\n' ' ')"
      warn "    Fronta Coolify je pomalejší než rozpočet ${budget}s (COMPOSE_RAW_WAIT_SECONDS)."
      return 0
    fi
    info "  compose bariéra: čekám na Coolify frontu — ${pocet} aplikací bez compose (${uplynulo}/${budget}s)"
    sleep "$step"
  done
}

# jq filter for discovering Coolify apps per stack.
#
# Multi-tenancy invariant: Coolify is shared across multiple stories
# (aisha-*, acme-*, etc.). The previous filter combined
# a strict `^aisha-<role>$` check with a loose substring fallback like
# `|keycloak`, causing this lookup to ALSO match `acme-keycloak`
# and friends. That cross-story collision silently pushed our env vars
# into another team's apps during deploy-init.
#
# The fix is a hard pre-filter: `select(.name | startswith("aisha-"))`
# wraps every per-stack predicate, so foreign-prefixed apps are never
# even considered. Inside that guard we keep the existing alias support
# (web/edge, langfuse/observability, n8n/orchestration, matrix/messaging)
# and the compose-file location match — both forms are guaranteed to
# stay within the aisha- namespace because of the outer startswith().
#
# AISHA_STORY env (default "aisha") overrides the prefix for forks. The
# manifest's app names use the same prefix, so the guard adapts.
stack_jq_filter() {
  # App-name discovery prefix. Two env vars are checked, in order, for
  # backward compatibility:
  #   1. APP_NAME_PREFIX — written by scripts/init-new-tenant.sh into the
  #      per-tenant overlay `config/domains-<INSTANCE>.env` (canonical).
  #   2. AISHA_STORY     — older alias used by some operator scripts.
  # ⚠️ ŽÁDNÝ default. Tenhle řetězec jde do jq guardu `startswith("<story>-")`,
  # tedy do VÝBĚRU APLIKACÍ, na které se sáhne.
  local story
  story="$(require_instance_prefix)" || exit 2
  local guard="(.name // \"\" | startswith(\"${story}-\")) and "
  case "$1" in
    core)        echo "${guard}((.docker_compose_location // \"\" | test(\"docker-compose\\\\.coolify\\\\.yml$\"; \"i\")) or (.name | test(\"^${story}-core$\"; \"i\")))" ;;
    pgadmin)     echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-pgadmin\"; \"i\")) or (.name | test(\"^${story}-pgadmin$\"; \"i\")))" ;;
    keycloak)    echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-keycloak\"; \"i\")) or (.name | test(\"^${story}-keycloak$\"; \"i\")))" ;;
    integration) echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-integration\"; \"i\")) or (.name | test(\"^${story}-integration$\"; \"i\")))" ;;
    web)         echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-prebuilt\"; \"i\")) or (.name | test(\"^${story}-(edge|web)$\"; \"i\")))" ;;
    edge)        echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-prebuilt\"; \"i\")) or (.name | test(\"^${story}-(edge|web)$\"; \"i\")))" ;;
    extranet)    echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-extranet\"; \"i\")) or (.name | test(\"^${story}-extranet$\"; \"i\")))" ;;
    langfuse)    echo "${guard}((.docker_compose_location // \"\" | test(\"langfuse\"; \"i\")) or (.name | test(\"^${story}-(observability|langfuse)$\"; \"i\")))" ;;
    observability) echo "${guard}((.docker_compose_location // \"\" | test(\"langfuse\"; \"i\")) or (.name | test(\"^${story}-(observability|langfuse)$\"; \"i\")))" ;;
    monitoring)  echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-monitoring\"; \"i\")) or (.name | test(\"^${story}-monitoring$\"; \"i\")))" ;;
    admin)       echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-admin\"; \"i\")) or (.name | test(\"^${story}-admin$\"; \"i\")))" ;;
    n8n)         echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-n8n\"; \"i\")) or (.name | test(\"^${story}-(orchestration|n8n)$\"; \"i\")))" ;;
    orchestration) echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-n8n\"; \"i\")) or (.name | test(\"^${story}-(orchestration|n8n)$\"; \"i\")))" ;;
    matrix)      echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-matrix\"; \"i\")) or (.name | test(\"^${story}-(messaging|matrix)$\"; \"i\")))" ;;
    messaging)   echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-matrix\"; \"i\")) or (.name | test(\"^${story}-(messaging|matrix)$\"; \"i\")))" ;;
    livekit)     echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-livekit\"; \"i\")) or (.name | test(\"^${story}-livekit$\"; \"i\")))" ;;
    exec)        echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-exec\"; \"i\")) or (.name | test(\"^${story}-exec$\"; \"i\")))" ;;
    netbird)     echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-netbird\"; \"i\")) or (.name | test(\"^${story}-netbird$\"; \"i\")))" ;;
    registry)    echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-registry\"; \"i\")) or (.name | test(\"^${story}-registry$\"; \"i\")))" ;;
    pki)         echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-pki\"; \"i\")) or (.name | test(\"^${story}-pki$\"; \"i\")))" ;;
    ledger)      echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-cosmos\"; \"i\")) or (.name | test(\"^${story}-ledger$\"; \"i\")))" ;;
    llm-gateway) echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-llm-gateway\"; \"i\")) or (.name | test(\"^${story}-llm-gateway$\"; \"i\")))" ;;
    openclaw)    echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-openclaw\"; \"i\")) or (.name | test(\"^${story}-openclaw$\"; \"i\")))" ;;
    source-broker) echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-source-broker\"; \"i\")) or (.name | test(\"^${story}-source-broker$\"; \"i\")))" ;;
    local-ingest) echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-local-ingest\"; \"i\")) or (.name | test(\"^${story}-local-ingest$\"; \"i\")))" ;;
    potok)       echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-potok\"; \"i\")) or (.name | test(\"^${story}-potok$\"; \"i\")))" ;;
    realtime)    echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-realtime\"; \"i\")) or (.name | test(\"^${story}-realtime$\"; \"i\")))" ;;
    observability-stack) echo "${guard}((.docker_compose_location // \"\" | test(\"coolify-observability\\\\.yml\"; \"i\")) or (.name | test(\"^${story}-observability-stack$\"; \"i\")))" ;;
    *)           echo "${guard}(.name == \"${story}-$1\")" ;;   # stack z manifestu: jméno aplikace = <prefix>-<id>
  esac
}

# Per-stack UUIDs — pre-fill from env if caller (e.g. aisha-cold-start.sh)
# already exported them; otherwise they remain empty and discovery runs.
UUID_CORE="${UUID_CORE:-}"               UUID_KEYCLOAK="${UUID_KEYCLOAK:-}"
UUID_INTEGRATION="${UUID_INTEGRATION:-}" UUID_WEB="${UUID_WEB:-${UUID_EDGE:-}}"
UUID_EDGE="${UUID_EDGE:-${UUID_WEB:-}}"
UUID_LANGFUSE="${UUID_LANGFUSE:-${UUID_OBSERVABILITY:-}}"
UUID_OBSERVABILITY="${UUID_OBSERVABILITY:-${UUID_LANGFUSE:-}}"
UUID_ADMIN="${UUID_ADMIN:-}"
UUID_PGADMIN="${UUID_PGADMIN:-}"
UUID_MONITORING="${UUID_MONITORING:-}"
UUID_REALTIME="${UUID_REALTIME:-}"
UUID_OBSERVABILITY_STACK="${UUID_OBSERVABILITY_STACK:-}"
UUID_N8N="${UUID_N8N:-${UUID_ORCHESTRATION:-}}"
UUID_ORCHESTRATION="${UUID_ORCHESTRATION:-${UUID_N8N:-}}"
UUID_MATRIX="${UUID_MATRIX:-${UUID_MESSAGING:-}}"
UUID_MESSAGING="${UUID_MESSAGING:-${UUID_MATRIX:-}}"
UUID_LIVEKIT="${UUID_LIVEKIT:-}"         UUID_PKI="${UUID_PKI:-}"
UUID_LEDGER="${UUID_LEDGER:-}"
UUID_EXEC="${UUID_EXEC:-}"
UUID_NETBIRD="${UUID_NETBIRD:-}"
UUID_REGISTRY="${UUID_REGISTRY:-}"
# Phase 2 autopilot capabilities (opt-in)
UUID_LLM_GATEWAY="${UUID_LLM_GATEWAY:-}"
UUID_OPENCLAW="${UUID_OPENCLAW:-}"
# Federation broker (opt-in; provisioned only when SOURCE_API_URL is set)
UUID_SOURCE_BROKER="${UUID_SOURCE_BROKER:-}"
# Verified ingestion + flow-runtime loop (opt-in; provisioned only when
# INGEST_BUNDLE_GIT_URL / POTOK_ENABLED are set)
# Extranet — the customer-facing surface. Its own container and compose, like
# every other stack; edge only ROUTES its domain. Before 2026-07-29 it existed
# in Coolify but in NO stack registry, so nothing deployed it: it sat on a
# commit from the previous night while three PRs merged past it.
UUID_EXTRANET="${UUID_EXTRANET:-}"
UUID_LOCAL_INGEST="${UUID_LOCAL_INGEST:-}"
UUID_POTOK="${UUID_POTOK:-}"

get_stack_uuid() {
  case "$1" in
    core)          echo "$UUID_CORE" ;;
    pgadmin)       echo "$UUID_PGADMIN" ;;
    keycloak)      echo "$UUID_KEYCLOAK" ;;
    integration)   echo "$UUID_INTEGRATION" ;;
    web)           echo "$UUID_WEB" ;;
    edge)          echo "$UUID_EDGE" ;;
    extranet)      echo "$UUID_EXTRANET" ;;
    langfuse)      echo "$UUID_LANGFUSE" ;;
    observability) echo "$UUID_OBSERVABILITY" ;;
    monitoring)    echo "$UUID_MONITORING" ;;
    admin)         echo "$UUID_ADMIN" ;;
    n8n)           echo "$UUID_N8N" ;;
    orchestration) echo "$UUID_ORCHESTRATION" ;;
    matrix)        echo "$UUID_MATRIX" ;;
    messaging)     echo "$UUID_MESSAGING" ;;
    livekit)       echo "$UUID_LIVEKIT" ;;
    pki)           echo "$UUID_PKI" ;;
    ledger)        echo "$UUID_LEDGER" ;;
    exec)          echo "$UUID_EXEC" ;;
    llm-gateway)   echo "$UUID_LLM_GATEWAY" ;;
    openclaw)      echo "$UUID_OPENCLAW" ;;
    source-broker) echo "$UUID_SOURCE_BROKER" ;;
    local-ingest)  echo "$UUID_LOCAL_INGEST" ;;
    potok)         echo "$UUID_POTOK" ;;
    netbird)       echo "$UUID_NETBIRD" ;;
    registry)      echo "$UUID_REGISTRY" ;;
    realtime)      echo "$UUID_REALTIME" ;;
    observability-stack) echo "$UUID_OBSERVABILITY_STACK" ;;
    *) local _v="UUID_$(printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_')"; echo "${!_v:-}" ;;
  esac
}

set_stack_uuid() {
  case "$1" in
    core)          UUID_CORE="$2" ;;
    pgadmin)       UUID_PGADMIN="$2" ;;
    keycloak)      UUID_KEYCLOAK="$2" ;;
    integration)   UUID_INTEGRATION="$2" ;;
    web)           UUID_WEB="$2"; UUID_EDGE="$2" ;;
    edge)          UUID_EDGE="$2"; UUID_WEB="$2" ;;
    extranet)      UUID_EXTRANET="$2" ;;
    langfuse)      UUID_LANGFUSE="$2"; UUID_OBSERVABILITY="$2" ;;
    observability) UUID_OBSERVABILITY="$2"; UUID_LANGFUSE="$2" ;;
    monitoring)    UUID_MONITORING="$2" ;;
    admin)         UUID_ADMIN="$2" ;;
    n8n)           UUID_N8N="$2"; UUID_ORCHESTRATION="$2" ;;
    orchestration) UUID_ORCHESTRATION="$2"; UUID_N8N="$2" ;;
    matrix)        UUID_MATRIX="$2"; UUID_MESSAGING="$2" ;;
    messaging)     UUID_MESSAGING="$2"; UUID_MATRIX="$2" ;;
    livekit)       UUID_LIVEKIT="$2" ;;
    pki)           UUID_PKI="$2" ;;
    ledger)        UUID_LEDGER="$2" ;;
    exec)          UUID_EXEC="$2" ;;
    llm-gateway)   UUID_LLM_GATEWAY="$2" ;;
    openclaw)      UUID_OPENCLAW="$2" ;;
    netbird)       UUID_NETBIRD="$2" ;;
    registry)      UUID_REGISTRY="$2" ;;
    source-broker) UUID_SOURCE_BROKER="$2" ;;
    local-ingest)  UUID_LOCAL_INGEST="$2" ;;
    potok)         UUID_POTOK="$2" ;;
    realtime)      UUID_REALTIME="$2" ;;
    observability-stack) UUID_OBSERVABILITY_STACK="$2" ;;
    *) printf -v "UUID_$(printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_')" '%s' "$2" ;;
  esac
}

# ── Argument parsing ──────────────────────────────────────────────────────────
SELECTED_STACKS="$ALL_STACKS"
SET_BUILD_SERVER=0

while [ $# -gt 0 ]; do
  case "$1" in
    --stack|-s)
      raw="${2:-all}"
      SELECTED_STACKS="$(echo "$raw" | tr ',' ' ')"
      shift 2
      ;;
    --set-build-server)
      SET_BUILD_SERVER=1
      shift
      ;;
    --dry-run|-n)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--stack core|integration|web|langfuse|admin|all] [--set-build-server] [--dry-run]"
      echo ""
      echo "Stacks:"
      echo "  core         AISHA core: DB, Auth, API, Studio, Edge Functions + Keycloak OIDC"
      echo "  integration  ES + Ragnarok RAG engine"
      echo "  web          Frontend (Vite/React) + DB migrations"
      echo "  langfuse     AI Observability (ClickHouse, Redis, MinIO, Langfuse v3)"
      echo "  admin        NocoDB + Appsmith administration tools"
      echo "  all          All stacks (default)"
      echo ""
      echo "Flags:"
      echo "  --set-build-server  Set use_build_server=true on all discovered apps"
      exit 0
      ;;
    *)
      err "Neznámý argument: $1 (použij --help)"
      exit 1
      ;;
  esac
done

[ "$SELECTED_STACKS" = "all" ] && SELECTED_STACKS="$ALL_STACKS"

# ── Self-hosted defaults ──────────────────────────────────────────────────────
# These match fallbacks in docker-compose.coolify*.yml.
# ALL values are self-configurable: override via .env or .env.coolify.
# If not overridden, compose :-fallbacks ensure a working default.

# ── Shared secrets ────────────────────────────────────────────────────────────
# All secrets sourced from caller's env (loaded via .env-prod-backup or
# generated by aisha-cold-start.sh::regenerate_secrets). No literal values
# committed — repo treats secrets as runtime-only material. Cold-start
# script handles fresh-generation when env is empty; this script just
# fails fast if a required value isn't present.
require_secret() {
  local var_name="$1"
  if [ -z "${!var_name:-}" ]; then
    printf '[coolify-deploy-init] FATAL: %s is empty — source .env-prod-backup or run aisha-cold-start.sh first.\n' \
      "$var_name" >&2
    exit 2
  fi
}
# ── Konfigurace MUSÍ dorazit dřív než se na ni kdokoli zeptá ─────────────────
#
# `require_secret` níž shazoval skript o 190 řádků dřív, než se vůbec načetl
# `.env.coolify`, který ta tajemství nese. Samostatné
# `bash scripts/coolify-deploy-init.sh --stack edge` proto skončilo hláškou
# „POSTGRES_PASSWORD is empty — source .env-prod-backup or run
# aisha-cold-start.sh first" i na instanci, kde heslo prokazatelně JE.
# Fungovalo jedině volání z cold-startu, protože ten si soubor sourcuje sám —
# a to je právě ta vlastnost, kvůli které si operátor píše jednorázový launcher
# místo aby použil hotový nástroj (viz hlavička scripts/lib/config-env-files.mjs).
# Kontrola má měřit KONFIGURACI, ne to, kdo skript zavolal.
#
# ⚠️ PROČ TADY A JEŠTĚ JEDNOU NÍŽ, a ne prostě přesunout: pod tímhle blokem se
# sourcuje `config/domains.env`, které `.env.coolify` smí přebít. Kdyby se load
# jen posunul sem, precedence by se OTOČILA a domény by najednou vyhrávaly nad
# instanční konfigurací — tiše. Soubor je prostý `KLÍČ=hodnota`, takže druhé
# načtení je idempotentní; platí se za to jedním průchodem souboru.
#
# ⚠️ Naivní `source` tu nestačí a nikdy nestačil: Coolify Sanctum token má tvar
# `id|secret` a `|` v nezaquotované hodnotě je pro bash roura. Proto se čte
# řádek po řádku.
#
# ⛔ HODNOTA JAKO PO `source` (naměřeno 2026-09-19, guru): uvozovky se dřív jen
# odřízly a escapy zůstaly — `AISHA_OPERATORS` odsud šel do Coolify jako
# `{\"email\":…}` a operátoři se nikdy neprovisionovali. Čte sdílený
# parse_env_soubor (lib/env-soubor.sh), totéž, co coolify-sync-envs.
# shellcheck source=scripts/lib/env-soubor.sh
. "$_di_dir/lib/env-soubor.sh"
load_env_file() {
  local env_file="$1" key value
  [ -f "$env_file" ] || return 0
  info "Načítám: $(basename "$env_file")"
  while IFS=$'\t' read -r key value; do
    [[ -z "$key" || -z "$value" ]] && continue
    export "$key=$value"
  done < <(parse_env_soubor "$env_file")
  ok "$(basename "$env_file") načten"
}

load_env_file "$PROJECT_ROOT/.env"
load_env_file "$DEPLOY_ENV_SOUBOR"

require_secret POSTGRES_PASSWORD
require_secret JWT_SECRET
require_secret ANON_KEY
require_secret SERVICE_ROLE_KEY
JWT_EXP="${JWT_EXP:-3600}"
# VAULT_ENCRYPTION_KEY auto-generated on first run (truly per-deploy
# ephemeral if not pre-set). 64 hex chars = 32 bytes random. Bail if
# openssl isn't available — refuses to fall back to a deterministic value.
if [ -z "${VAULT_ENCRYPTION_KEY:-}" ]; then
  if command -v openssl >/dev/null 2>&1; then
    VAULT_ENCRYPTION_KEY="$(openssl rand -hex 32)"
  else
    printf '[coolify-deploy-init] FATAL: VAULT_ENCRYPTION_KEY is empty and openssl unavailable for auto-gen.\n' >&2
    exit 2
  fi
fi

# ── Core stack domains ────────────────────────────────────────────────────────
# ── Core stack domains — sourced from config/domains.env (single source of truth)
# .env / .env.coolify can still override individual values per deploy.
DOMAINS_FILE="${PROJECT_ROOT}/config/domains.env"
if [ -f "$DOMAINS_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$DOMAINS_FILE"
  set +a
fi
# All domain values MUST come from config/domains.env (SoT). No literal
# fallbacks — fail fast if any required var is missing.
: "${APP_DOMAIN:?APP_DOMAIN required from config/domains.env}"
: "${API_DOMAIN:?API_DOMAIN required from config/domains.env}"
: "${API_DOMAIN_PUBLIC:?API_DOMAIN_PUBLIC required from config/domains.env}"
: "${MCP_DOMAIN:?MCP_DOMAIN required from config/domains.env}"
: "${DIRIGENT_DOMAIN:?DIRIGENT_DOMAIN required from config/domains.env}"
: "${STUDIO_DOMAIN_DIRECT:?STUDIO_DOMAIN_DIRECT required from config/domains.env}"
: "${KEYCLOAK_DOMAIN:?KEYCLOAK_DOMAIN required from config/domains.env}"

# ── Core — AISHA backbone internals ────────────────────────────────────────
# Real secrets are required (no static fallbacks); short/structural defaults
# (release cookies, schema lists) stay inline because they're not credentials.
require_secret LOGFLARE_API_KEY
require_secret REALTIME_SECRET_KEY_BASE
LOGFLARE_RELEASE_COOKIE="${LOGFLARE_RELEASE_COOKIE:-cookie}"
REALTIME_DB_ENC_KEY="${REALTIME_DB_ENC_KEY:-$LOGFLARE_API_KEY}"  # alias of LOGFLARE_API_KEY (required above) — never a hardcoded default
PGRST_DB_SCHEMAS="${PGRST_DB_SCHEMAS:-public,storage,graphql_public}"
# OpenAPI introspection OFF: default follow-privileges leaks the full schema
# (table/RPC names+shapes) to anon at GET /. Platform is RPC-only, so disable it.
PGRST_OPENAPI_MODE="${PGRST_OPENAPI_MODE:-disabled}"
PGRST_DB_POOL="${PGRST_DB_POOL:-20}"
PGRST_DB_MAX_ROWS="${PGRST_DB_MAX_ROWS:-1000}"
STORAGE_FILE_SIZE_LIMIT="${STORAGE_FILE_SIZE_LIMIT:-52428800}"
STORAGE_REGION="${STORAGE_REGION:-local}"
IMGPROXY_ENABLE_WEBP_DETECTION="${IMGPROXY_ENABLE_WEBP_DETECTION:-true}"
IMGPROXY_KEY="${IMGPROXY_KEY:-}"
IMGPROXY_SALT="${IMGPROXY_SALT:-}"

# ── Core — Auth defaults (runtime auth je Keycloak OIDC) ─
DISABLE_SIGNUP="${DISABLE_SIGNUP:-false}"
ENABLE_EMAIL_SIGNUP="${ENABLE_EMAIL_SIGNUP:-true}"
ENABLE_EMAIL_AUTOCONFIRM="${ENABLE_EMAIL_AUTOCONFIRM:-false}"
ENABLE_ANONYMOUS_SIGN_INS="${ENABLE_ANONYMOUS_SIGN_INS:-false}"
ENABLE_PHONE_SIGNUP="${ENABLE_PHONE_SIGNUP:-false}"
RATE_LIMIT_EMAIL_SENT="${RATE_LIMIT_EMAIL_SENT:-100}"

# ── Core — SMTP ──────────────────────────────────────────────────────────────
SMTP_HOST="${SMTP_HOST:-}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASS="${SMTP_PASS:-}"
# Derive from the instance's own apex when the operator didn't supply one. APP_DOMAIN is
# hard-required 38 lines up (:399), so it is always present here — the fallback can never
# be empty. This was the last hard-required input a fork could not answer from its own
# identity: every cold-start of a new instance died here until someone hand-exported an
# address the deploy already knew how to build. operator-inputs.mjs states the rule in its
# own header ("everything a fork cannot DERIVE" — derivable values MUST NOT be inputs);
# this key just never got the treatment. Operator-explicit still wins.
SMTP_ADMIN_EMAIL="${SMTP_ADMIN_EMAIL:-admin@${APP_DOMAIN}}"
SMTP_SENDER_NAME="${SMTP_SENDER_NAME:-Evymo Platform}"
MAILER_SUBJECTS_CONFIRMATION="${MAILER_SUBJECTS_CONFIRMATION:-Confirm your email}"
MAILER_SUBJECTS_RECOVERY="${MAILER_SUBJECTS_RECOVERY:-Reset your password}"
MAILER_SUBJECTS_MAGIC_LINK="${MAILER_SUBJECTS_MAGIC_LINK:-Your login link}"
MAILER_SUBJECTS_EMAIL_CHANGE="${MAILER_SUBJECTS_EMAIL_CHANGE:-Confirm email change}"
MAILER_SUBJECTS_INVITE="${MAILER_SUBJECTS_INVITE:-You have been invited}"
MAILER_TEMPLATES_CONFIRMATION="${MAILER_TEMPLATES_CONFIRMATION:-}"
MAILER_TEMPLATES_RECOVERY="${MAILER_TEMPLATES_RECOVERY:-}"
MAILER_TEMPLATES_MAGIC_LINK="${MAILER_TEMPLATES_MAGIC_LINK:-}"
MAILER_TEMPLATES_EMAIL_CHANGE="${MAILER_TEMPLATES_EMAIL_CHANGE:-}"
MAILER_TEMPLATES_INVITE="${MAILER_TEMPLATES_INVITE:-}"

# ── Core — KeyCloak OIDC ─────────────────────────────────────────────────────
ENABLE_KEYCLOAK="${ENABLE_KEYCLOAK:-true}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-aisha-app}"
KEYCLOAK_CLIENT_SECRET="${KEYCLOAK_CLIENT_SECRET:-}"
KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}"
require_secret KEYCLOAK_ADMIN_PASSWORD   # generated by generate-secrets; no hardcoded fallback
require_secret KEYCLOAK_DB_PASSWORD       # generated by generate-secrets; no hardcoded fallback

# ── Core — Google/Apple OAuth ────────────────────────────────────────────────
ENABLE_GOOGLE_OAUTH="${ENABLE_GOOGLE_OAUTH:-true}"
OAUTH_GOOGLE_CLIENT_ID="${OAUTH_GOOGLE_CLIENT_ID:-}"
OAUTH_GOOGLE_CLIENT_SECRET="${OAUTH_GOOGLE_CLIENT_SECRET:-}"
ENABLE_APPLE_OAUTH="${ENABLE_APPLE_OAUTH:-true}"
OAUTH_APPLE_CLIENT_ID="${OAUTH_APPLE_CLIENT_ID:-}"
OAUTH_APPLE_CLIENT_SECRET="${OAUTH_APPLE_CLIENT_SECRET:-}"

# ── Core — Studio ────────────────────────────────────────────────────────────
# Organizace zobrazená ve studiu = identita provozovatele. Dřív tu byl
# literál dárcovské značky, a k tomu dva JINÉ defaulty na dalších dvou
# místech (aisha-cold-start.sh, aisha-env-doctor.mjs) — tři nesouhlasné
# pravdy o téže hodnotě. Teď teče z jednoho vstupu operátora.
STUDIO_DEFAULT_ORG="${STUDIO_DEFAULT_ORG:-${AISHA_OPERATOR_ORG:-}}"
STUDIO_DEFAULT_PROJECT="${STUDIO_DEFAULT_PROJECT:-AI Orchestrator}"
STUDIO_BASIC_AUTH="${STUDIO_BASIC_AUTH:-}"

# ── Core — Edge Functions / AI / Integrations ────────────────────────────────
EDGE_RUNTIME_MODE="${EDGE_RUNTIME_MODE:-production}"
EDGE_VERIFY_JWT="${EDGE_VERIFY_JWT:-false}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
GOOGLE_AI_API_KEY="${GOOGLE_AI_API_KEY:-}"
N8N_WEBHOOK_URL="${N8N_WEBHOOK_URL:-}"
N8N_API_KEY="${N8N_API_KEY:-}"
require_secret RAGNAROK_API_KEY          # generated by generate-secrets; no hardcoded fallback
RAGNAROK_URL="${RAGNAROK_URL:-http://ragnarok:9696}"
GITHUB_WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"

# ── Core — Push Notifications ────────────────────────────────────────────────
WEB_PUSH_VAPID_PUBLIC_KEY="${WEB_PUSH_VAPID_PUBLIC_KEY:-}"
WEB_PUSH_VAPID_PRIVATE_KEY="${WEB_PUSH_VAPID_PRIVATE_KEY:-}"
WEB_PUSH_VAPID_SUBJECT="${WEB_PUSH_VAPID_SUBJECT:-mailto:${SMTP_ADMIN_EMAIL}}"
FIREBASE_SERVICE_ACCOUNT_JSON="${FIREBASE_SERVICE_ACCOUNT_JSON:-}"

# ── Core — Stripe ────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-}"
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-}"

# ── Core — Sentry ────────────────────────────────────────────────────────────
VITE_SENTRY_DSN="${VITE_SENTRY_DSN:-}"
SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN:-}"
SENTRY_URL="${SENTRY_URL:-}"
SENTRY_ORG="${SENTRY_ORG:-sentry}"
SENTRY_PROJECT="${SENTRY_PROJECT:-platform-web}"
SOURCE_COMMIT="${SOURCE_COMMIT:-}"

# ── Service domains — all from config/domains.env (no literal fallbacks)
: "${LANGFUSE_DOMAIN:?LANGFUSE_DOMAIN required from config/domains.env}"
: "${NOCODB_DOMAIN:?NOCODB_DOMAIN required from config/domains.env}"
: "${APPSMITH_DOMAIN:?APPSMITH_DOMAIN required from config/domains.env}"
# DOZZLE_DOMAIN is profile-optional. If monitoring is extracted for a profile
# that does not publish a direct host, its application is configured without a
# Coolify ingress contract rather than aborting the whole deployment.
: "${N8N_DOMAIN:?N8N_DOMAIN required from config/domains.env}"
: "${MATRIX_DOMAIN:?MATRIX_DOMAIN required from config/domains.env}"
: "${ELEMENT_DOMAIN:?ELEMENT_DOMAIN required from config/domains.env}"
: "${ELEMENT_CALL_DOMAIN:?ELEMENT_CALL_DOMAIN required from config/domains.env}"
: "${LIVEKIT_DOMAIN:?LIVEKIT_DOMAIN required from config/domains.env}"
: "${TURN_DOMAIN:?TURN_DOMAIN required from config/domains.env}"
: "${PKI_DOMAIN:?PKI_DOMAIN required from config/domains.env}"
: "${REGISTRY_DOMAIN:?REGISTRY_DOMAIN required from config/domains.env}"

# ── SSO / OIDC secrets ────────────────────────────────────────────────────────
LANGFUSE_OIDC_SECRET="${LANGFUSE_OIDC_SECRET:-}"
APPSMITH_OIDC_SECRET="${APPSMITH_OIDC_SECRET:-}"
OAUTH2_PROXY_COOKIE_SECRET="${OAUTH2_PROXY_COOKIE_SECRET:-}"
NOCODB_DB_PASSWORD="${NOCODB_DB_PASSWORD:-}"

DRY_RUN="${DRY_RUN:-0}"
NORMALIZE_BUILDTIME="${NORMALIZE_BUILDTIME:-1}"

# ── Načti .env soubory (vyšší priorita přepisuje) ────────────────────────────
# Zůstává ZÁMĚRNĚ pod `config/domains.env`: ten se sourcuje výš a tenhle load ho
# smí přebít — přesně jak slibuje komentář u DOMAINS_FILE („.env / .env.coolify
# can still override individual values per deploy"). Kdo tenhle blok posune nad
# domains.env, tu precedenci OTOČÍ, aniž by o tom cokoli řeklo.
load_env_file "$PROJECT_ROOT/.env"
load_env_file "$DEPLOY_ENV_SOUBOR"

# Tenant overlay: when AISHA_PROFILE is set, load config/domains-<profile>.env
# This is the same file `aisha-cold-start.sh` sources to pick up per-tenant
# APP_NAME_PREFIX, APP_DOMAIN, API_DOMAIN, KEYCLOAK_DOMAIN, etc. Without it,
# this script falls back to upstream evymo defaults — running it against a
# downstream fork (e.g. acme) would PATCH the wrong Coolify apps (matching
# evymo-prefixed names instead of fork-prefixed). See stack_app_name() above.
if [ -n "${AISHA_PROFILE:-}" ]; then
  load_env_file "$PROJECT_ROOT/config/domains-${AISHA_PROFILE}.env"
fi

# Run only after every configuration layer has been loaded; earlier
# normalization would be overwritten by the second .env.coolify pass above.
normalize_forgejo_coordinates

load_topology_env() {
  local derive_script="$PROJECT_ROOT/scripts/lib/derive-domains.mjs"
  [ -f "$derive_script" ] || { err "Missing topology resolver: $derive_script"; exit 1; }
  local topology_env
  topology_env=$(mktemp -t aisha-deploy-topology.XXXXXX.env)
  node "$derive_script" --check >/dev/null
  node "$derive_script" --shell > "$topology_env"
  set -a
  # shellcheck source=/dev/null
  . "$topology_env"
  set +a
  rm -f "$topology_env"
  # Hláška NESMÍ dosazovat: ukázat „cloud-multi" tam, kde profil nikdo
  # nedeklaroval, znamená diagnostiku, která tvrdí víc, než ví.
  ok "Topology env načten (profile=${AISHA_PROFILE:-<NEDEKLAROVÁN>}, mesh=${MESH_ENABLED})"
}

load_topology_env

# ── Surface origins → ALLOWED_ORIGINS ────────────────────────────────────────
# config/domains.env composes ALLOWED_ORIGINS at line ~411, which runs BEFORE
# load_topology_env — so its `${SURFACE_ORIGINS:+,…}` had nothing to interpolate
# and the surfaces silently fell out of the list. Appending here, after the
# resolver has emitted them, is the only point where both halves exist.
#
# Why it matters: a surface SPA is a browser origin calling this same API. Left
# out, it authenticates and then has every request rejected at the CORS
# preflight with `Origin … not in CORS allowlist` — which reads as a backend
# fault and is a config omission. Measured on the live extranet 2026-07-28.
#
# Idempotent: an origin already in the list is not appended twice, so re-running
# deploy-init cannot grow the value.
if [ -n "${SURFACE_ORIGINS:-}" ]; then
  _ao_before="${ALLOWED_ORIGINS:-}"
  for _surface_origin in ${SURFACE_ORIGINS//,/ }; do
    case ",${ALLOWED_ORIGINS:-}," in
      *",${_surface_origin},"*) ;;
      *) ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}${ALLOWED_ORIGINS:+,}${_surface_origin}" ;;
    esac
  done
  export ALLOWED_ORIGINS
  [ "$_ao_before" = "$ALLOWED_ORIGINS" ] \
    && info "ALLOWED_ORIGINS už obsahuje všechny povrchy" \
    || ok "ALLOWED_ORIGINS rozšířeno o povrchy: ${SURFACE_ORIGINS}"
fi

require_env() {
  local key="$1"
  local value="${!key:-}"
  [ -n "$value" ] || { err "$key je prázdné — oprav topology/env contract před deployem"; exit 1; }
}

require_env COOLIFY_URL
case "$COOLIFY_URL" in
  http://*|https://*) ;;
  *) err "COOLIFY_URL musí být absolutní http(s) URL, aktuálně: $COOLIFY_URL"; exit 1 ;;
esac
COOLIFY_BASE_URL="${COOLIFY_BASE_URL:-$COOLIFY_URL}"

# Post-load derived defaults for contracts that may be absent in older local env files.
# Secret defaults stay empty; cold-start generates real values into .env.coolify.
: "${KEYCLOAK_REALM:?KEYCLOAK_REALM required from config/domains.env}"
KEYCLOAK_URL="${KEYCLOAK_URL:-https://${KEYCLOAK_DOMAIN}}"

: "${AUTH_DOMAIN_PUBLIC:?AUTH_DOMAIN_PUBLIC required from config/domains.env}"
AISHA_API_URL="${AISHA_API_URL:-https://${API_DOMAIN_PUBLIC}}"
AISHA_ANON_KEY="${AISHA_ANON_KEY:-${ANON_KEY}}"
AISHA_BACKEND_URL="${AISHA_BACKEND_URL:-${AISHA_API_URL}}"
AISHA_BACKEND_ANON_KEY="${AISHA_BACKEND_ANON_KEY:-${AISHA_ANON_KEY}}"
AISHA_BACKEND_SERVICE_KEY="${AISHA_BACKEND_SERVICE_KEY:-${SERVICE_ROLE_KEY}}"
AISHA_DB_URL="${AISHA_DB_URL:-postgresql://postgres:${POSTGRES_PASSWORD}@${APP_NAME_PREFIX:?identita instance — adresa databáze se NEHÁDÁ}-db:5432/postgres}"
vyzaduj_identitu AISHA_DB_URL "$AISHA_DB_URL"
VITE_API_URL="${VITE_API_URL:-${AISHA_API_URL}}"
# Realtime WS endpoint — live.${PUBLIC_TLD} fronted by edge-proxy → ws-gateway.
# Set ONLY when realtime is enabled (LIVE_DOMAIN_PUBLIC present in domains.env);
# otherwise left empty so the web bundle falls back per realtime.ts resolveWsUrl.
VITE_WS_URL="${VITE_WS_URL:-${LIVE_DOMAIN_PUBLIC:+wss://${LIVE_DOMAIN_PUBLIC}/ws}}"
VITE_AISHA_BACKEND_URL="${VITE_AISHA_BACKEND_URL:-${AISHA_BACKEND_URL}}"
VITE_AISHA_BACKEND_ANON_KEY="${VITE_AISHA_BACKEND_ANON_KEY:-${AISHA_BACKEND_ANON_KEY}}"
VITE_AISHA_BACKEND_PUBLISHABLE_KEY="${VITE_AISHA_BACKEND_PUBLISHABLE_KEY:-${AISHA_BACKEND_ANON_KEY}}"
VITE_AISHA_GATEWAY_URL="${VITE_AISHA_GATEWAY_URL:-${AISHA_API_URL}}"
VITE_AISHA_GATEWAY_KEY="${VITE_AISHA_GATEWAY_KEY:-${ANON_KEY}}"
VITE_PUBLIC_SITE_URL="${VITE_PUBLIC_SITE_URL:-https://${APP_DOMAIN}}"
PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-${VITE_PUBLIC_SITE_URL}}"
VITE_REQUIRE_AISHA_ENV="${VITE_REQUIRE_AISHA_ENV:-false}"
VITE_REQUIRE_AISHA_BACKEND_ENV="${VITE_REQUIRE_AISHA_BACKEND_ENV:-false}"
VITE_WEB_PUSH_VAPID_PUBLIC_KEY="${VITE_WEB_PUSH_VAPID_PUBLIC_KEY:-${WEB_PUSH_VAPID_PUBLIC_KEY}}"
AUTH_PUBLIC_URL="https://${AUTH_DOMAIN_PUBLIC}"
VITE_KC_URL="${VITE_KC_URL:-${AUTH_PUBLIC_URL}}"
VITE_KC_AUTHORITY="${VITE_KC_AUTHORITY:-${AUTH_PUBLIC_URL}/realms/${KEYCLOAK_REALM}}"
VITE_KC_CLIENT_ID="${VITE_KC_CLIENT_ID:-aisha-app}"
VITE_AUTH_REDIRECT_URI="${VITE_AUTH_REDIRECT_URI:-https://${APP_DOMAIN}/auth/callback}"
VITE_AUTH_POST_LOGOUT_URI="${VITE_AUTH_POST_LOGOUT_URI:-https://${APP_DOMAIN}}"
GIT_SHA="${GIT_SHA:-${SOURCE_COMMIT:-}}"

N8N_OIDC_SECRET="${N8N_OIDC_SECRET:-}"
N8N_COOKIE_SECRET="${N8N_COOKIE_SECRET:-}"
N8N_DB_HOST="${N8N_DB_HOST:-${APP_NAME_PREFIX:?identita instance — hostitel databáze se NEHÁDÁ}-db}"
vyzaduj_identitu N8N_DB_HOST "$N8N_DB_HOST"
N8N_DB_PORT="${N8N_DB_PORT:-5432}"
N8N_DB_NAME="${N8N_DB_NAME:-postgres}"
N8N_DB_USER="${N8N_DB_USER:-n8n_app}"
RABBITMQ_DEFAULT_USER="${RABBITMQ_DEFAULT_USER:-aisha}"
RABBITMQ_DEFAULT_PASS="${RABBITMQ_DEFAULT_PASS:-}"
RABBITMQ_USER="${RABBITMQ_USER:-${RABBITMQ_DEFAULT_USER}}"
RABBITMQ_PASS="${RABBITMQ_PASS:-${RABBITMQ_DEFAULT_PASS}}"
: "${RABBITMQ_HOST:?RABBITMQ_HOST required (mesh hostname for RabbitMQ)}"
: "${RABBITMQ_PORT:?RABBITMQ_PORT required — odvozuje katalog (integration.internal_tcp_endpoints), doručuje env-doktor}"

: "${NETBIRD_DOMAIN:?NETBIRD_DOMAIN required from config/domains.env}"
NETBIRD_API_URL="${NETBIRD_API_URL:-https://${NETBIRD_DOMAIN}}"
NETBIRD_AUTH_SCHEME="${NETBIRD_AUTH_SCHEME:-Bearer}"
NETBIRD_SANDBOX_GROUP="${NETBIRD_SANDBOX_GROUP:-sandbox-run}"
NETBIRD_DNS_IP="${NETBIRD_DNS_IP:-127.0.0.11}"
NETBIRD_MGMT_SECRET="${NETBIRD_MGMT_SECRET:-}"
NETBIRD_OIDC_CLIENT_ID="${NETBIRD_OIDC_CLIENT_ID:-netbird}"
NETBIRD_OIDC_SECRET="${NETBIRD_OIDC_SECRET:-}"
NETBIRD_RELAY_SECRET="${NETBIRD_RELAY_SECRET:-}"
NETBIRD_DATASTORE_ENC_KEY="${NETBIRD_DATASTORE_ENC_KEY:-}"
NETBIRD_DB_PASSWORD="${NETBIRD_DB_PASSWORD:-}"
NETBIRD_TURN_USERNAME="${NETBIRD_TURN_USERNAME:-netbird-turn}"
NETBIRD_TURN_PASSWORD="${NETBIRD_TURN_PASSWORD:-}"

: "${PLUGIN_SYSTEM_URL:?PLUGIN_SYSTEM_URL required (mesh URL for plugin-system)}"
: "${PLUGIN_BROKER_URL:?PLUGIN_BROKER_URL required}"
: "${POSTGREST_URL:?POSTGREST_URL required (mesh URL for PostgREST)}"
KATA_DEFAULT_RUNTIME="${KATA_DEFAULT_RUNTIME:-kata-dragonball}"

# ── Kontrola prerekvizit ──────────────────────────────────────────────────────
step "Kontrola prerekvizit"

if ! command -v jq &>/dev/null; then
  err "jq není nainstalován. Nainstaluj: brew install jq / apt install jq"
  exit 1
fi
ok "jq"

if ! command -v curl &>/dev/null; then
  err "curl není nainstalován"
  exit 1
fi
ok "curl"

if [ "$DRY_RUN" = "1" ]; then
  warn "DRY RUN mód — nic nebude skutečně změněno"
fi

# ── DEKLAROVANÉ DRŽENÍ: držený stack se NENASTAVUJE ──────────────────────────
# ⛔ ZMĚŘENO ČTENÍM 2026-10-04: tenhle krok nastavoval env, domény a build server
# každému stacku instance — i tomu, který overlay deklaruje jako držený
# (nasazeni-drzene.json). Nenasazuje, ale přepisuje konfiguraci, se kterou
# aplikace naběhne při příštím nasazení nebo restartu. Držený stack se proto
# vyřadí ze VŠECH smyček níž (env, buildtime, build server) — i když ho obsluha
# jmenuje přes --stack. Pravidla a validace: lib/nasazeni-drzene.mjs (čtenář
# lib/drzeni.sh). Nečitelná nebo neplatná deklarace = STOP před prvním zápisem.
# Stojí AŽ TADY: identita instance (prefix) je známá teprve po načtení env souborů.
# shellcheck source=lib/drzeni.sh
. "$SCRIPT_DIR/lib/drzeni.sh"
# Adresu webhooku nasazení vydává jediný domov mutace (viz WEBHOOK SETUP níž).
# shellcheck source=lib/coolify-mutace.sh
. "$SCRIPT_DIR/lib/coolify-mutace.sh"
if ! drzeni_nacti "coolify-deploy-init" "$DEPLOY_ENV_SOUBOR"; then
  err "Deklaraci držení aplikací nejde přečíst nebo je neplatná (důvod výš) — nevím, který stack smím nastavit. Nic jsem nezapsal."
  exit 1
fi
bez_drzenych() {
  local _bd_s _bd_role _bd_prefix _bd_out=""
  _bd_prefix="$(require_instance_prefix)" || exit 2
  for _bd_s in $1; do
    _bd_role="$(stack_app_name "$_bd_s")"
    _bd_role="${_bd_role#"${_bd_prefix}"-}"
    if drzena "$_bd_role"; then
      # Jednou za stack (funkce běží dvakrát: všechny a vybrané stacky).
      case " ${DI_DRZENE} " in *" $_bd_s "*) ;; *) DI_DRZENE="${DI_DRZENE:+$DI_DRZENE }$_bd_s"; warn "$(drzeni_hlaska "$_bd_role"). Stack '${_bd_s}' se NENASTAVUJE (env, domény, build server)." ;; esac
      continue
    fi
    # EXTERNÍ služba (profil prostředí: external_domain; vlastnictví načetl
    # load_app_compose_map výš): v tomhle prostředí není naše — literál ALL_STACKS
    # ji jmenovat smí (keycloak), nastavovat se nesmí.
    if externi "$_bd_role"; then
      case " ${DI_EXTERNI} " in *" $_bd_s "*) ;; *) DI_EXTERNI="${DI_EXTERNI:+$DI_EXTERNI }$_bd_s"; warn "$(vlastnictvi_hlaska "$_bd_role"). Stack '${_bd_s}' se NENASTAVUJE (env, domény, build server)." ;; esac
      continue
    fi
    _bd_out="${_bd_out}${_bd_s} "
  done
  BEZ_DRZENYCH="${_bd_out% }"
}
DI_DRZENE=""
DI_EXTERNI=""
bez_drzenych "$ALL_STACKS";      ALL_STACKS="$BEZ_DRZENYCH"
bez_drzenych "$SELECTED_STACKS"; SELECTED_STACKS="$BEZ_DRZENYCH"
unset BEZ_DRZENYCH

info "Stacky k deploymentu: ${SELECTED_STACKS}"

# ── API tokeny ────────────────────────────────────────────────────────────────
step "API tokeny"

if [ -z "${COOLIFY_API_TOKEN:-}" ]; then
  echo ""
  info "Coolify API token: ${COOLIFY_URL} → Settings → API Tokens → Create"
  echo -n "  Coolify API token: "
  read -r COOLIFY_API_TOKEN
  echo ""
fi

if [ -z "$COOLIFY_API_TOKEN" ]; then
  err "COOLIFY_API_TOKEN není nastaven. Bez něj nelze pokračovat."
  exit 1
fi
ok "Coolify API token"

# Pověření se HLEDÁ v kanonickém řetězci, teprve pak se na něj ptáme člověka.
# Cold-start zapisuje token pod jménem `FORGEJO_TOKEN`, kdežto tenhle skript
# chtěl `FORGEJO_API_TOKEN` — dvě jména pro tutéž věc znamenala, že skript
# INTERAKTIVNĚ vyzval k zadání tokenu, který měl celou dobu na disku, a
# neinteraktivní běh (`NON_INTERACTIVE=1`, cron, agent) na tom skončil.
# Týž postup, jakým se pár řádků výš resolvuje FORGEJO_URL.
# shellcheck source=scripts/lib/coolify-credentials.sh
if [ -z "${FORGEJO_API_TOKEN:-}" ] && [ -f "${PROJECT_ROOT}/scripts/lib/coolify-credentials.sh" ]; then
  . "${PROJECT_ROOT}/scripts/lib/coolify-credentials.sh"
  FORGEJO_API_TOKEN="$(config_env_key FORGEJO_API_TOKEN FORGEJO_TOKEN 2>/dev/null || true)"
fi

if [ -z "${FORGEJO_API_TOKEN:-}" ]; then
  echo ""
  info "Forgejo API token: ${FORGEJO_URL} → Settings → Applications → Manage Access Tokens"
  echo -n "  Forgejo API token: "
  read -r FORGEJO_API_TOKEN
  echo ""
fi

if [ -z "$FORGEJO_API_TOKEN" ]; then
  err "FORGEJO_API_TOKEN není nastaven. Bez něj nelze pokračovat."
  exit 1
fi
ok "Forgejo API token"

# ── Helper funkce ─────────────────────────────────────────────────────────────

coolify_api() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"

  local args=(
    -s -S --max-time 30 --connect-timeout 10
    -X "$method"
    -H "Authorization: Bearer $COOLIFY_API_TOKEN"
    -H "Accept: application/json"
    -H "Content-Type: application/json"
  )

  if [ -n "$data" ]; then
    args+=(-d "$data")
  fi

  # Retry up to 5x s exponenciálním backoffem.
  # - curl-level transient (timeout/DNS/connect-fail/empty-reply): 28/6/7/56/18/52
  # - HTTP 429 "Too Many Attempts" (Coolify v4 rate limit): backoff a retry
  # Coolify v4 throttle = ~60 reqs/minutě per IP. Bez 429 retry by bulk env
  # push 100+ klíčů v jednom běhu lossily padal.
  local attempt response curl_rc http_code body_file
  body_file=$(mktemp)
  for attempt in 1 2 3 4 5; do
    http_code=$(curl "${args[@]}" -w '%{http_code}' -o "$body_file" "${COOLIFY_URL}/api/v1${endpoint}" 2>/dev/null)
    curl_rc=$?
    response=$(cat "$body_file" 2>/dev/null)
    if [ $curl_rc -eq 0 ] && [ "$http_code" != "429" ]; then
      printf '%s' "$response"
      rm -f "$body_file"
      return 0
    fi
    # Backoff: 2s, 4s, 8s, 16s, 32s
    local delay=$((2 ** attempt))
    if [ "$http_code" = "429" ]; then
      [ "$attempt" -lt 5 ] && sleep "$delay" && continue
    fi
    case $curl_rc in
      28|6|7|56|18|52) [ "$attempt" -lt 5 ] && sleep "$delay" ;;
      *) break ;;
    esac
  done
  # Exhausted retries — return body (may be 429 message), caller handles
  rm -f "$body_file"
  printf '%s' "$response"
  return ${curl_rc:-1}
}

# ── Project-scoped application list ───────────────────────────────────────────
# Echoes a JSON ARRAY of THIS project's applications. Prefers the
# project-environment endpoint `GET /projects/{uuid}/{env}` (only this project's
# apps → ~32 s) over the GLOBAL `GET /applications`, whose body grows past
# curl's --max-time once the full stack exists (timeouts mid-body — incident
# 2026-06-03). Falls back to the global list when project/env identity is
# unknown. Caller validates with `jq type=="array"`.
coolify_list_apps() {
  local raw=""
  local proj="${COOLIFY_PROJECT_UUID:-}" env_name="${COOLIFY_ENVIRONMENT:-production}"
  if [ -n "$proj" ]; then
    raw=$(coolify_api GET "/projects/${proj}/${env_name}" 2>/dev/null \
      | tr -d '\000-\037' | jq -c '.applications // empty' 2>/dev/null)
    if [ -n "$raw" ] && echo "$raw" | jq -e 'type=="array"' >/dev/null 2>&1; then
      printf '%s' "$raw"
      return 0
    fi
  fi
  coolify_api GET "/applications" 2>/dev/null | tr -d '\000-\037'
}

forgejo_api() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"

  local args=(
    -s -S --max-time 30
    -X "$method"
    -H "Authorization: token $FORGEJO_API_TOKEN"
    -H "Accept: application/json"
    -H "Content-Type: application/json"
  )

  if [ -n "$data" ]; then
    args+=(-d "$data")
  fi

  curl "${args[@]}" "${FORGEJO_URL}/api/v1${endpoint}"
}

# ------------------------------------------------------------------------------
# Idempotentní nastavení env var v Coolify aplikaci přes bulk upsert.
#
# Coolify v4 env var datový model (ověřeno 2026-04-22):
#   - Každý klíč má 2 záznamy: production (is_preview=false) + preview (is_preview=true)
#   - POST /envs — vytvoří OBA záznamy (production i preview); není idempotentní
#   - PATCH /envs — update-only, selže pokud klíč neexistuje
#   - PATCH /envs/bulk — idempotentní upsert PRODUCTION záznamu (is_preview=false):
#       * klíč neexistuje → vytvoří oba (production + preview) se stejnou hodnotou
#       * klíč existuje → aktualizuje pouze production; preview zůstane beze změny
#
# Používáme proto výhradně PATCH /envs/bulk. Jedno volání = jeden env var
# (můžeme batchovat více najednou, ale pro jasné error reporting per-key to
# zatím dělám individuálně).
# ------------------------------------------------------------------------------
# Sloučí profil "mesh" s profily, které si aplikace deklaruje sama.
#
# ⛔ NAMĚŘENO 2026-09-04 na produkci <fork>: `admin` a `ai-chat` hlásily
# running:unhealthy s FailingStreak 776, ačkoli SLUŽBY samotné byly zdravé.
# Nezdravé byly jen `*-mesh-ingress` sidecary: bez směrovací tabulky naslouchají
# na :8000 a vracejí 503 („aby bylo VIDĚT, že tabulka chybí"), kdežto healthcheck
# se ptá na servisní port (:80 u admina, :3011 u ai-chatu). Ten záměr je správný
# pro instanci S meshem, které se nepodařilo odvodit trasy — na profilu BEZ meshe
# je prázdná tabulka správný stav a trvalé unhealthy jen šum. A sidecar to nemohl
# rozlišit: dostával jen *_MESH_INGRESS_ROUTES, nikdy MESH_ENABLED.
#
# Mesh komponenty (netbird-agent, *-mesh-ingress, *-mesh-tcp) proto nesou
# `profiles: ["mesh"]` a nespustí se, dokud mesh nestojí.
#
# ⚠ SLOUČIT, NEPŘEPSAT — pravidlo i pomocník `mesh_profile_merge` bydlí
# v lib/mesh-profile.sh, protože profil zapíná i vlnová rovina
# (coolify-sync-envs.sh). Dvě kopie by se rozešly; naměřeno 2026-09-13, kdy
# vlnová rovina profil nepsala vůbec a API forku vracelo 502.
# shellcheck source=lib/mesh-profile.sh
. "$_di_dir/lib/mesh-profile.sh"

set_coolify_env() {
  local app_uuid="$1"
  local key="$2"
  local value="$3"
  local is_build="${4:-false}"  # informativní — Coolify sám rozhoduje z compose

  if [ "$DRY_RUN" = "1" ]; then
    local type_label="runtime"
    [ "$is_build" = "true" ] && type_label="build"
    # Environment values include credentials and tokens. A dry-run proves
    # which keys would be touched, never any portion of their values.
    info "[DRY RUN] ${key} (${type_label}) would be upserted (value redacted)"
    return 0
  fi

  # ── Compose template safety ────────────────────────────────────────────────
  # Coolify ukládá hodnoty 1:1 do .env i do build-time.env. Compose runtime
  # parser by interpretoval `foo$bar` jako proměnnou — ale Coolify build-time
  # parser MÁ VLASTNÍ interpretaci a `$$` chápe jako začátek nedokončeného
  # `${...}` (→ "Invalid template" fail). Plošný escape je proto NESPRÁVNÝ.
  #
  # Naše generované secrets z gen_secret() (openssl rand -base64 | tr) NIKDY
  # neobsahují `$`. Pokud user vloží secret obsahující `$` ručně, dostane
  # warning a musí se rozhodnout sám.
  if [[ "$value" == *'$'* ]]; then
    warn "  ${key} — value contains literal '\$' (may break Coolify build-time parser)"
  fi

  # Coolify v4 vytváří per-key dva záznamy (production+preview, oba is_buildtime).
  # Bez explicitního is_preview flag PATCH /envs/bulk update jen production —
  # preview entry zůstane se starou hodnotou a contaminuje docker compose .env
  # (preview wins on duplicate key). Posíláme proto 2× — production + preview.
  local prod_payload preview_payload
  prod_payload=$(jq -n \
    --arg key "$key" \
    --arg value "$value" \
    '{data: [{key: $key, value: $value, is_preview: false}]}')
  preview_payload=$(jq -n \
    --arg key "$key" \
    --arg value "$value" \
    '{data: [{key: $key, value: $value, is_preview: true}]}')

  local result curl_rc
  result=$(coolify_api PATCH "/applications/${app_uuid}/envs/bulk" "$prod_payload")
  curl_rc=$?
  # Sync preview too (best-effort, ignore errors — production is what matters)
  coolify_api PATCH "/applications/${app_uuid}/envs/bulk" "$preview_payload" >/dev/null 2>&1 || true

  # Úspěšná odpověď je pole objektů (uuid, key, value, ...).
  if [ $curl_rc -eq 0 ] && echo "$result" | jq -e 'type=="array" and length>0 and .[0].uuid' &>/dev/null; then
    ok "  ${key} — nastaveno (bulk upsert)"
    return 0
  fi

  # Surface real cause: curl exit code, HTTP error message, or unexpected body shape.
  local reason
  if [ $curl_rc -ne 0 ]; then
    reason="curl exit $curl_rc (timeout/network) after 3 retries"
  else
    reason=$(echo "$result" | jq -c '.message // .error // .' 2>/dev/null || echo "(unparseable: ${result:0:80})")
  fi
  warn "  ${key} — bulk upsert selhal: $reason"
  # Return 0 so `set -e` in caller doesn't abort the per-stack env loop on a
  # single failed key. The warn is visible; deploy-init.sh prints a summary
  # at the end. coolify-sync-envs.sh runs afterward and re-syncs full env to
  # all apps, providing redundancy for transient API hiccups.
  return 0
}


# Nastaví env var pouze pokud má neprázdnou hodnotu
set_coolify_env_if() {
  local app_uuid="$1"
  local key="$2"
  local value="$3"
  local is_build="${4:-false}"

  if [ -n "$value" ]; then
    set_coolify_env "$app_uuid" "$key" "$value" "$is_build"
  fi
}

# Smaže Coolify env var ze všech matching production/preview záznamů.
# Potřebujeme to pro legacy klíče, které už v compose nejsou, ale Coolify je
# stále injektuje do runtime envu (např. OAuth2 Proxy fixed redirect URL).
delete_coolify_env() {
  local app_uuid="$1"
  local key="$2"

  if [ "$DRY_RUN" = "1" ]; then
    info "[DRY RUN] delete ${key}"
    return 0
  fi

  local envs uuids uuid
  envs=$(coolify_api GET "/applications/${app_uuid}/envs" "") || {
    warn "  ${key} — nepodařilo se načíst envs pro delete"
    return 0
  }

  uuids=$(echo "$envs" | jq -r --arg key "$key" '.[]? | select(.key == $key) | .uuid' 2>/dev/null || true)
  if [ -z "$uuids" ]; then
    ok "  ${key} — absent"
    return 0
  fi

  while IFS= read -r uuid; do
    [ -z "$uuid" ] && continue
    coolify_api DELETE "/applications/${app_uuid}/envs/${uuid}" "" >/dev/null 2>&1 \
      && ok "  ${key} — smazáno" \
      || warn "  ${key} — delete selhal (${uuid})"
  done <<EOF_DELETE_ENV
$uuids
EOF_DELETE_ENV
}

# Nastaví docker_compose_domains pro Coolify stack (Traefik routing)
# Argumenty: app_uuid domain_entries...
#   domain_entries = "service-name=https://domain" (libovolný počet)
#
# DŮLEŽITÉ — Coolify PATCH API formát:
#   Coolify PATCH /applications/{uuid} vyžaduje ARRAY format:
#     [{"name": "service", "domain": "https://domain"}]
#   GET /applications/{uuid} vrací OBJECT format (pro verifikaci).
#
# POZNÁMKA K PORTŮM:
#   Neuvádějte port v URL — Coolify Traefik routuje na port 80 by default.
#   Pokud service neposlouchá na 80, nastavte PORT env var v Coolify.
#   Příklady:
#     expose: 80   → "web=https://web.${PUBLIC_TLD}"     (přímé)
#     expose: 8080 → "keycloak=https://auth.${PUBLIC_TLD}" + KC_HTTP_PORT=80


# Hodnota domény, kterou služba SKUTEČNĚ registruje v Coolify — zrcadlo
# domenaProCoolify v scripts/lib/edge-vlastni-jmena.mjs (doktor); brána
# edge-vlastni-jmena-na-svem-uzlu obě roviny spouští nad týmiž vstupy.
#   domena_pro_coolify <služba> <doména[,doména…]>  → stdout: výsledná hodnota
# Vyřadí mesh jména (`*.internal`) i jména ve vlastnictví edge (EDGE_OWNED_HOSTS).
# ⛔ (2026-10-02) Když nezbude NIC, dřív se položka jen přeskočila — a v Coolify
# zůstal starý router (n8n-auth: veřejné mcp/dirigent mimo edge). Teď jde
# uvolňovací sentinel; bez APP_NAME_PREFIX prázdný výstup (volající vynechá
# a ohlásí), protože sentinel bez identity instance by kolidoval s jiným projektem.
domena_pro_coolify() {
  local sluzba="$1" domena="$2" zbyva="" h host vyrazeno=0
  local vlastni=",,"
  if [ "$sluzba" != "edge-proxy" ]; then
    vlastni=",$(printf '%s' "${EDGE_OWNED_HOSTS:-}" | tr 'A-Z' 'a-z' | tr -d ' '),"
  fi
  while IFS= read -r h; do
    h="$(printf '%s' "$h" | tr -d ' ')"
    [ -z "$h" ] && continue
    host="${h#*://}"; host="${host%%/*}"; host="${host%%:*}"
    host="$(printf '%s' "$host" | tr 'A-Z' 'a-z')"
    case "$host" in
      *.internal) vyrazeno=$((vyrazeno + 1)); continue ;;
    esac
    case "$vlastni" in
      *",${host},"*) vyrazeno=$((vyrazeno + 1)); continue ;;
    esac
    zbyva="${zbyva:+${zbyva},}${h}"
  done <<EOF_DOMENA_PRO_COOLIFY
$(printf '%s' "$domena" | tr ',' '\n')
EOF_DOMENA_PRO_COOLIFY
  if [ "$vyrazeno" -eq 0 ]; then
    printf '%s' "$domena"
  elif [ -n "$zbyva" ]; then
    printf '%s' "$zbyva"
  elif [ -z "${APP_NAME_PREFIX:-}" ]; then
    echo "  ⚠ ${sluzba}: nemá co registrovat, ale APP_NAME_PREFIX chybí — router NEuvolňuji" >&2
    printf ''
  else
    printf 'http://%s-%s.edge-vlastni.invalid:80' "$sluzba" "$APP_NAME_PREFIX"
  fi
}

set_coolify_domains() {
  local app_uuid="$1"
  shift

  # Coolify PATCH API requires ARRAY format:
  #   [{"name": "service", "domain": "https://domain"}]
  # GET response returns OBJECT format (used for verification below).
  local json_arr="["
  local first=true
  local svc_names=()
  for entry in "$@"; do
    local svc_name="${entry%%=*}"
    local svc_domain="${entry#*=}"
    local key="${svc_name}"

    # ⛔ MESHOVÉ JMÉNO SE DO COOLIFY DOMÉN NEPOSÍLÁ (naměřeno 2026-08-27
    # z logů Traefiku na uzlu).
    #
    # Coolify z každé domény udělá Traefik router a PŘILEPÍ mu
    # `certresolver=letsencrypt`. Jenže na `*.internal` LE certifikát vydat
    # NEMŮŽE NIKDY:
    #
    #   Cannot issue for "<svc>.mesh.<instance>.internal":
    #     Domain name does not end with a valid public suffix (TLD)
    #
    # Každý takový pokus spálí kus limitu ACME účtu, až LE zablokuje vydávání
    # i pro LEGITIMNÍ hostitele téhož účtu:
    #
    #   429 too many failed authorizations (5) for "<prefix>-auth.backend.<tld>"
    #   429 Your account is temporarily prevented from requesting certificates
    #
    # Následek byl celý bring-up: auth měl router, ale bez certifikátu — HTTP
    # vracelo 302, HTTPS 404. Naměřeno 17 našich aplikací s `.internal` doménou.
    #
    # Mesh je VNITŘNÍ rovina: jede přes wireguard a vlastní mesh-ingress
    # s certifikátem od AISHA PKI, ne přes veřejný Traefik s ACME. Ven se
    # vystrkuje jedině edge.
    # Mesh jména a jména ve vlastnictví edge vyřadí domena_pro_coolify (výš);
    # když nezbude nic, pošle uvolňovací sentinel — jinak by starý router zůstal.
    local svc_domain_coolify
    svc_domain_coolify="$(domena_pro_coolify "$svc_name" "$svc_domain")"
    if [ -z "$svc_domain_coolify" ]; then
      info "  ${key}: nic k registraci a bez identity instance nejde uvolnit — vynecháno"
      continue
    fi
    if [ "$svc_domain_coolify" != "$svc_domain" ]; then
      info "  ${key}: mesh jména / jména ve vlastnictví edge vynechána → ${svc_domain_coolify}"
      svc_domain="$svc_domain_coolify"
    fi

    if [ "$first" = true ]; then
      first=false
    else
      json_arr="${json_arr},"
    fi
    json_arr="${json_arr}{\"name\":\"${key}\",\"domain\":\"${svc_domain}\"}"
    svc_names+=("$key")
  done
  json_arr="${json_arr}]"

  if [ "$DRY_RUN" = "1" ]; then
    info "[DRY RUN] docker_compose_domains = ${json_arr}"
    return 0
  fi

  local payload="{\"docker_compose_domains\": ${json_arr}}"
  # Force-override variant — used when Coolify returns "Domain conflicts"
  # because a legacy app (orphan from previous deploy or upstream-vintage
  # cold-start) still claims the FQDN we want to bind. Fork deploys are the
  # explicit right-of-way; the legacy holder is dead-by-definition (we're
  # rebuilding the stack). Without this, set_coolify_domains silently warns
  # and the new app keeps its upstream-default `${SVC}.backend.${INTERNAL_TLD}` FQDNs.
  # UPSTREAMABLE: pure recovery path, zero behavior change without conflict.
  local payload_forced="{\"docker_compose_domains\": ${json_arr}, \"force_domain_override\": true}"
  local result
  # Retry up to 3x — na PŘECHODNÁ selhání (API stall, tichý drop hodnoty).
  #
  # ⛔ Dřív tu stálo, že opakování řeší i „compose ještě nebyl načten". Nemůže:
  # Coolify načítá compose z gitu až při NASAZENÍ a v okně mezi třemi pokusy
  # ho nic nedoplní. Prázdný docker_compose_raw je proto DETERMINISTICKÉ
  # selhání a opakovat ho znamená jen třikrát počkat na stejné 422 — a navíc
  # si vysloužit throttling Coolify („Too Many Attempts"). Odchytáváme ho
  # proto níže a přerušujeme hned, s návodem.
  #
  # CRITICAL Coolify v4 quirk (memory: feedback_coolify_api_quirks.md):
  # PATCH may return 200 + {"uuid":...} but the docker_compose_domains
  # value is silently NOT persisted (GET shows null afterward). We must
  # verify post-PATCH and re-issue the PATCH if the GET shows null —
  # not just warn and proceed. Without this loop, KC would deploy without
  # a Traefik route registered (auth.backend.${INTERNAL_TLD} returns 404).
  local attempt
  local persisted=0
  for attempt in 1 2 3; do
    result=$(curl -sS --http1.1 -X PATCH "${COOLIFY_URL}/api/v1/applications/${app_uuid}" \
      -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -d "$payload" 2>/dev/null || echo '{"error": true}')

    # Opakování v řádu sekund tohle nespraví, jen vyvolá throttling. Coolify
    # plní docker_compose_raw JEDINĚ (a) řazenou úlohou LoadComposeFile, nebo
    # (b) při nasazení. Fronta pod zátěží cold-startu doběhne řádově v desítkách
    # minut (naměřeno ~1 h), takže tři pokusy po pár sekundách jsou proti ní
    # bez šance. Seed v create payloadu to neobejde — Coolify poslanou hodnotu
    # zahodí (ověřeno živě).
    if echo "$result" | tr -d '\000-\037' | grep -q 'without docker_compose_raw'; then
      warn "  docker_compose_domains — Coolify pro tuhle aplikaci nemá compose, takže domény odmítá."
      warn "  Opakování v řádu sekund nepomůže: compose doručuje asynchronní fronta Coolify."
      warn "  Náprava: počkat na frontu (COMPOSE_RAW_WAIT_SECONDS) nebo nechat aplikaci jednou nasadit."
      break
    fi

    # Systemic fork right-of-way: if Coolify rejected with "Domain conflicts"
    # because a legacy/orphan app holds the FQDN, retry once with
    # force_domain_override=true. Only sanctioned use-case for the override:
    # fork migration where the source-of-truth manifest claims the domain.
    # Idempotent: subsequent runs have no conflict and never re-trigger force.
    if echo "$result" | tr -d '\000-\037' | grep -q 'Domain conflicts detected'; then
      if [ "${ALLOW_DOMAIN_FORCE_OVERRIDE:-0}" = "1" ]; then
        warn "  docker_compose_domains — domain conflict; ALLOW_DOMAIN_FORCE_OVERRIDE=1 → force_domain_override (does NOT unbind the prior owner — verify no double-binding)"
        result=$(curl -sS --http1.1 -X PATCH "${COOLIFY_URL}/api/v1/applications/${app_uuid}" \
          -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
          -H "Content-Type: application/json" \
          -H "Accept: application/json" \
          -d "$payload_forced" 2>/dev/null || echo '{"error": true}')
      else
        # force_domain_override leaves the PRIOR owner bound → double-binding → Traefik
        # no-router 404 (incident 2026-07-09, tenantcache). Fail loud instead of silently forcing.
        warn "  docker_compose_domains — DOMAIN CONFLICT: another Coolify app already claims this host."
        warn "  NOT forcing (would double-bind → no-router 404). Resolve the squatter first:"
        warn "    node scripts/coolify-domain-doctor.mjs --json   (see FQDN_CONFLICT + claimants)"
        warn "  Sanctioned fork-migration override only: re-run with ALLOW_DOMAIN_FORCE_OVERRIDE=1."
      fi
    fi

    # PATCH-level success: response body has uuid. May still be silently
    # dropped on the server side — verify with a GET below.
    if ! echo "$result" | tr -d '\000-\037' | grep -q '"uuid"'; then
      sleep 3
      continue
    fi

    # Post-patch verification: GET app and confirm docker_compose_domains
    # is non-null. If null → Coolify silently dropped the write → retry.
    # JSON parseability check is critical: under `set -euo pipefail`, a
    # jq parse error on truncated response would abort deploy-init.
    local verify stored verify_attempt
    stored=""
    for verify_attempt in 1 2 3; do
      verify=$(curl -sS --http1.1 --max-time 30 --connect-timeout 10 \
        -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
        -H "Accept: application/json" \
        "${COOLIFY_URL}/api/v1/applications/${app_uuid}" 2>/dev/null | tr -d '\000-\037' || echo '{}')
      if ! echo "$verify" | jq -e 'type == "object"' >/dev/null 2>&1; then
        [ "$verify_attempt" -lt 3 ] && warn "  docker_compose_domains — verify GET truncated/invalid (attempt ${verify_attempt}/3) — retrying..."
        sleep $((verify_attempt * 2))
        continue
      fi
      stored=$(echo "$verify" | jq -r '.docker_compose_domains // ""' 2>/dev/null || echo "")
      if [ -n "$stored" ] && [ "$stored" != "null" ]; then
        break
      fi
      sleep 2
    done

    if [ -n "$stored" ] && [ "$stored" != "null" ]; then
      # Persisted! Now check service-level coverage AND VALUE match.
      # UPSTREAMABLE: earlier impl only checked key presence (`has($k)`); a
      # stale upstream value `nocodb.backend.${INTERNAL_TLD}` would falsely report as
      # "verified" when we actually wanted `<svc>.<fork-staging-host>`.
      # New impl reads `.domain` and compares against the wanted value,
      # surfacing `stale values: X(stored=Y wanted=Z)` so drift is caught.
      # Also handles Coolify's kebab→snake key transform (we send
      # `element-web`, Coolify stores `element_web`) by checking both forms.
      if [ "$attempt" -gt 1 ]; then
        ok "  docker_compose_domains — nastaveno (PATCH attempt ${attempt}/3 persisted)"
      else
        ok "  docker_compose_domains — nastaveno"
      fi
      local missing=() mismatched=()
      for entry in "$@"; do
        local svc_name="${entry%%=*}"
        local svc_domain="${entry#*=}"
        # Porovnává se s tím, co se ODESLALO (domena_pro_coolify), jinak by
        # vynechaná mesh jména a jména edge vypadala jako falešný „stale value".
        svc_domain="$(domena_pro_coolify "$svc_name" "$svc_domain")"
        [ -z "$svc_domain" ] && continue
        local snake_key="${svc_name//-/_}"
        local stored_dom=""
        stored_dom=$(echo "$stored" | jq -r --arg k1 "$svc_name" --arg k2 "$snake_key" \
          'fromjson? // . | (.[$k1] // .[$k2] // {}) | .domain // ""' 2>/dev/null || echo "")
        if [ -z "$stored_dom" ]; then
          missing+=("$svc_name")
        elif [ "$stored_dom" != "$svc_domain" ]; then
          mismatched+=("${svc_name}(stored=${stored_dom} wanted=${svc_domain})")
        fi
      done
      if [ ${#mismatched[@]} -gt 0 ]; then
        warn "  docker_compose_domains — ${#mismatched[@]} service(s) have stale values: ${mismatched[*]}"
      elif [ ${#missing[@]} -gt 0 ]; then
        info "  docker_compose_domains — ${#svc_names[@]} requested, ${missing[*]} not stored (profile-gated services are expected)"
      else
        ok "  docker_compose_domains — verified (${#svc_names[@]} service(s))"
      fi
      persisted=1
      break
    fi

    # PATCH returned 200 but GET shows null — Coolify v4 silent-drop quirk.
    # Re-issue the PATCH (same payload). If this is the last attempt, we
    # fall through to the error block below.
    if [ "$attempt" -lt 3 ]; then
      warn "  docker_compose_domains — PATCH ${attempt}/3 was silently dropped by Coolify (GET shows null) — retrying PATCH in $((attempt * 5))s..."
      sleep $((attempt * 5))
    fi
  done

  if [ "$persisted" = "1" ]; then
    return 0
  fi

  # ⛔ NAMĚŘENO 2026-08-17: tady se dřív tisklo POUZE `.message`. Coolify přitom
  # dává skutečný důvod do `.errors` a `.message` je jen zastřešující nálepka —
  # u 422 doslova „Validation failed." Celý cold-start tak 16× ohlásil
  # „Validation failed." a zamlčel větu, kterou Coolify poslal hned vedle:
  #   „Cannot set docker_compose_domains without docker_compose_raw.
  #    Reload the compose file from the git repository first."
  # Diagnostika, která zahodí návod a nechá si nálepku, pošle člověka hledat
  # vadu jinam. Tiskneme tedy obojí.
  local msg
  msg=$(echo "$result" | tr -d '\000-\037' | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("odpověď nebyla JSON")
    raise SystemExit
if not isinstance(d, dict):
    print("odpověď nebyla objekt")
    raise SystemExit
m = d.get("message", "unknown")
e = d.get("errors")
if not e:
    print(m)
    raise SystemExit
if isinstance(e, dict):
    detail = " | ".join(
        k + ": " + (v if isinstance(v, str) else "; ".join(str(x) for x in v))
        for k, v in e.items()
    )
else:
    detail = str(e)
print(m + " → " + detail)
' 2>/dev/null || echo "unknown")
  warn "  docker_compose_domains — chyba po 3 pokusech: ${msg}"
}

# ── Ověření připojení ─────────────────────────────────────────────────────────
step "Ověření připojení k API"

# Test Coolify API
COOLIFY_CHECK=$(coolify_api GET "/servers" 2>/dev/null || echo '{"error": true}')
if echo "$COOLIFY_CHECK" | jq -e 'if type == "array" then true elif .error then false else true end' &>/dev/null 2>&1; then
  ok "Coolify API (${COOLIFY_URL})"
else
  # Fallback endpoint
  COOLIFY_CHECK=$(coolify_api GET "/teams" 2>/dev/null || echo '{"error": true}')
  if echo "$COOLIFY_CHECK" | jq -e '.error' &>/dev/null 2>&1; then
    err "Nelze se připojit ke Coolify API na ${COOLIFY_URL}"
    err "Zkontroluj URL a API token."
    exit 1
  fi
  ok "Coolify API (${COOLIFY_URL})"
fi

# Test Forgejo API
FORGEJO_CHECK=$(forgejo_api GET "/user" 2>/dev/null || echo '{"error": true}')
FORGEJO_USER=$(echo "$FORGEJO_CHECK" | jq -r '.login // empty' 2>/dev/null || true)
if [ -n "$FORGEJO_USER" ]; then
  ok "Forgejo API (${FORGEJO_URL}) — přihlášen jako ${FORGEJO_USER}"
else
  err "Nelze se připojit k Forgejo API na ${FORGEJO_URL}"
  err "Zkontroluj URL a API token."
  exit 1
fi

# Domény se v tomhle skriptu nastavují až dole, ale čekat se má TADY: fronta
# Coolify mezitím běží a env-var fáze jí dá čas zadarmo. Kdybychom čekali až
# u prvního PATCHe domén, promarníme celou tu dobu.
cekej_na_compose

# Načti všechny Coolify aplikace (jednou pro discovery všech stacků)
# Pozn: Coolify v4 odpovědi obsahují kontrolní znaky → tr -d je nutné jinak jq selže.
# Project-scoped list (coolify_list_apps) se vyhne pomalému globálnímu
# /applications endpointu, který při plném stacku timeoutuje (incident 2026-06-03).
# ⛔ Nečitelný seznam aplikací NENÍ prázdný projekt. Dřív tu `|| echo '[]'` s pouhým
# varováním proměnil výpadek API v „žádná aplikace neexistuje" — a každý stack bez
# UUID z prostředí se tiše přeskočil (NON_INTERACTIVE).
if ! ALL_APPS=$(coolify_list_apps 2>/dev/null) || ! echo "$ALL_APPS" | jq -e 'type == "array"' &>/dev/null; then
  err "Seznam aplikací z Coolify nejde přečíst jako JSON pole — stackům nejde přiřadit aplikace. Končím."
  exit 1
fi

# ══════════════════════════════════════════════════════════════════════════════
# NETBIRD SELF-HEAL — validate setup keys before per-stack env propagation
# ══════════════════════════════════════════════════════════════════════════════
# Mesh peer enrollment requires a valid setup key. Keys can become invalid
# (revoked manually, NetBird DB wipe, Keycloak realm reimport...). Without
# self-heal, deploy-init would propagate stale keys to Coolify and the agent
# would fail enrollment with "setup key is invalid" → mesh routing broken.
#
# netbird-bootstrap.sh now validates each setup key against NetBird API and
# auto-regenerates if invalid. This is idempotent: no-op if all keys are valid,
# regenerates + updates Coolify env + triggers redeploy if any are stale.
#
# Skip with NETBIRD_SELFHEAL_SKIP=1 if running deploy-init in environments
# without NetBird mgmt access (e.g. fresh install before NetBird is up).
#
# IMPORTANT: cold-start.sh sets NETBIRD_SELFHEAL_SKIP=1 because at this point
# (step 4: env vars), KC is not yet deployed. The Keycloak gate inside
# netbird-bootstrap.sh would burn 180s timing out trying to reach an
# unreachable auth.backend.${INTERNAL_TLD} before falling back. Self-heal is meaningful
# only on incremental re-runs where KC is already up.
if [ "$DRY_RUN" = "1" ] && [ "${NETBIRD_SELFHEAL_SKIP:-0}" != "1" ] && [ -n "${NETBIRD_API_URL:-}" ]; then
  banner "NetBird setup key self-heal — DRY RUN"
  info "[DRY RUN] would validate setup keys; mutation helper intentionally not invoked"
elif [ "${NETBIRD_SELFHEAL_SKIP:-0}" != "1" ] && [ -n "${NETBIRD_API_URL:-}" ]; then
  banner "NetBird setup key self-heal"
  if SYNC_COOLIFY=1 bash "$(dirname "$0")/netbird-bootstrap.sh" </dev/null 2>&1 | tail -10; then
    ok "NetBird self-heal complete (idempotent: no-op if all keys valid)"
  else
    warn "NetBird self-heal returned non-zero — proceeding with existing keys"
    warn "If mesh enrollment fails, run: bash scripts/netbird-bootstrap.sh"
  fi
elif [ "${NETBIRD_SELFHEAL_SKIP:-0}" = "1" ]; then
  banner "NetBird setup key self-heal — SKIPPED"
  info "NETBIRD_SELFHEAL_SKIP=1 — typical for cold-start --wipe (KC not yet up)"
  info "Self-heal will run during Phase D (after KC bootstrap)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STACK DEPLOYMENT LOOP
# ══════════════════════════════════════════════════════════════════════════════

for stack in $SELECTED_STACKS; do
  banner "$(stack_label "$stack") — $(stack_compose "$stack")"

  # ── Discover or prompt for UUID ──────────────────────────────────────────
  # Priority: 1) pre-set env (UUID_CORE etc.), 2) API discovery, 3) prompt.
  local_uuid="$(get_stack_uuid "$stack")"

  if [ -z "$local_uuid" ] && echo "$ALL_APPS" | jq -e 'type == "array"' &>/dev/null 2>&1; then
    jq_filter=$(stack_jq_filter "$stack")
    local_uuid=$(echo "$ALL_APPS" | jq -r \
      "[.[] | select(${jq_filter})] | first | .uuid // empty" \
      2>/dev/null || true)
  fi

  if [ -n "$local_uuid" ]; then
    local_name=$(echo "$ALL_APPS" | jq -r ".[] | select(.uuid == \"$local_uuid\") | .name // \"unknown\"" 2>/dev/null || echo "unknown")
    ok "Nalezena: ${local_name} (UUID: ${local_uuid})"
  else
    warn "Aplikace '$(stack_label "$stack")' nenalezena v Coolify"
    if [ "${NON_INTERACTIVE:-0}" = "1" ]; then
      local_uuid=""
      case "$DI_MANIFEST_STACKS" in
        *" $stack "*)
          # Manifest ho NASAZUJE, a aplikace chybí — env se nenastaví. Nedokončeno, ne skip.
          err "  Stack '$stack' je v manifestu instance, ale aplikace v Coolify NENÍ — env se nenastaví"
          DI_NEDOKONCENO+=("$stack")
          ;;
        *) info "  Stack '$stack' manifest instance nenasazuje — přeskočen" ;;
      esac
    else
      echo ""
      info "Vytvoř v Coolify UI:"
      info "  1. ${COOLIFY_URL} → New Resource → Docker Compose"
      info "  2. Repository: ${FORGEJO_URL}/${FORGEJO_OWNER}/${FORGEJO_REPO}.git"
      info "  3. Branch: main"
      info "  4. Compose: $(stack_compose "$stack")"
      echo ""
      echo -n "  UUID vytvořené aplikace (Enter = přeskočit): "
      read -r local_uuid
    fi
  fi

  set_stack_uuid "$stack" "$local_uuid"

  if [ -z "$local_uuid" ]; then
    warn "Stack '${stack}' přeskočen (nemá UUID)"
    continue
  fi

  # ── Set env vars per stack ───────────────────────────────────────────────
  step "  Env vars — ${stack}"

  # Všechna volání set_coolify_env používají PATCH /envs/bulk (idempotentní upsert)
  # — není třeba předem mazat nebo po-POST dedupovat.

  # Profil "mesh" dostane KAŽDÁ aplikace — mesh komponenty (netbird-agent,
  # *-mesh-ingress, *-mesh-tcp) jsou jím podmíněné ve 22 compose souborech.
  # Tři aplikace níž si COMPOSE_PROFILES nastavují znovu, ale přes týž merge,
  # takže si profil neseberou.
  stack_compose_profiles="$(mesh_profile_merge "")"
  set_coolify_env "$local_uuid" "COMPOSE_PROFILES" "${stack_compose_profiles}"

  case "$stack" in
    core)
      info "Nastavuji Core (AISHA + Keycloak) — KOMPLETNÍ konfigurace..."

      # ── Domains (critical for routing) ──────────────────────────
      # NOTE: STUDIO_DOMAIN_DIRECT (= db.backend.${INTERNAL_TLD}) — db is admin-only,
      # NOT exposed publicly. Per scope decision (2026-05-07).
      set_coolify_env "$local_uuid" "APP_DOMAIN"            "${APP_DOMAIN}"
      set_coolify_env "$local_uuid" "API_DOMAIN"            "${API_DOMAIN}"
      set_coolify_env "$local_uuid" "STUDIO_DOMAIN_DIRECT"  "${STUDIO_DOMAIN_DIRECT}"
      set_coolify_env "$local_uuid" "KEYCLOAK_DOMAIN"       "${KEYCLOAK_DOMAIN}"

      # ── Core secrets ────────────────────────────────────────────
      set_coolify_env "$local_uuid" "POSTGRES_PASSWORD"      "${POSTGRES_PASSWORD}"
      # Per-service DB passwords — aisha-db entrypoint-wrapper.sh používá tyto env
      # pro ALTER ROLE ... WITH PASSWORD. Bez nich fallbackuje na POSTGRES_PASSWORD,
      # což způsobí auth mismatch s ostatními stacky (matrix, n8n, keycloak, langfuse).
      set_coolify_env "$local_uuid" "SYNAPSE_DB_PASSWORD"    "${SYNAPSE_DB_PASSWORD}"
      set_coolify_env "$local_uuid" "NOCODB_DB_PASSWORD"     "${NOCODB_DB_PASSWORD}"
      set_coolify_env "$local_uuid" "LANGFUSE_DB_PASSWORD"   "${LANGFUSE_DB_PASSWORD}"
      set_coolify_env "$local_uuid" "N8N_DB_PASSWORD"        "${N8N_DB_PASSWORD}"
      set_coolify_env "$local_uuid" "REDIS_PASSWORD"         "${REDIS_PASSWORD}"
      # Monitoring role for postgres-exporter (Phase 12 WP 0.2). Must reach the
      # shared aisha-db (core) so set-passwords.sh can ALTER ROLE, and must reach
      # the exporter container in the observability stack for its DATA_SOURCE_NAME.
      # See infra/postgres/set-passwords.sh (conditional on role existence post-migration)
      # and docker-compose.coolify-langfuse.yml (postgres-exporter service).
      set_coolify_env_if "$local_uuid" "POSTGRES_EXPORTER_PASSWORD" "${POSTGRES_EXPORTER_PASSWORD}"
      set_coolify_env "$local_uuid" "JWT_SECRET"             "${JWT_SECRET}"
      set_coolify_env "$local_uuid" "JWT_EXP"                "${JWT_EXP}"
      set_coolify_env "$local_uuid" "ANON_KEY"               "${ANON_KEY}"
      set_coolify_env "$local_uuid" "SERVICE_ROLE_KEY"       "${SERVICE_ROLE_KEY}"
      set_coolify_env "$local_uuid" "VAULT_ENCRYPTION_KEY"   "${VAULT_ENCRYPTION_KEY}"

      # ── AISHA core backbone internals ─────────────────────────────────────
      set_coolify_env "$local_uuid" "LOGFLARE_API_KEY"         "${LOGFLARE_API_KEY}"
      set_coolify_env "$local_uuid" "LOGFLARE_RELEASE_COOKIE"  "${LOGFLARE_RELEASE_COOKIE}"
      set_coolify_env "$local_uuid" "REALTIME_SECRET_KEY_BASE" "${REALTIME_SECRET_KEY_BASE}"
      set_coolify_env "$local_uuid" "REALTIME_DB_ENC_KEY"      "${REALTIME_DB_ENC_KEY}"
      set_coolify_env "$local_uuid" "PGRST_DB_SCHEMAS"         "${PGRST_DB_SCHEMAS}"
      set_coolify_env "$local_uuid" "PGRST_OPENAPI_MODE"       "${PGRST_OPENAPI_MODE}"
      set_coolify_env "$local_uuid" "PGRST_DB_POOL"            "${PGRST_DB_POOL}"
      set_coolify_env "$local_uuid" "PGRST_DB_MAX_ROWS"        "${PGRST_DB_MAX_ROWS}"

      # ── Storage / imgproxy ──────────────────────────────────────
      set_coolify_env "$local_uuid" "STORAGE_FILE_SIZE_LIMIT"       "${STORAGE_FILE_SIZE_LIMIT}"
      set_coolify_env "$local_uuid" "STORAGE_REGION"                "${STORAGE_REGION}"
      set_coolify_env "$local_uuid" "IMGPROXY_ENABLE_WEBP_DETECTION" "${IMGPROXY_ENABLE_WEBP_DETECTION}"
      set_coolify_env_if "$local_uuid" "IMGPROXY_KEY"               "${IMGPROXY_KEY}"
      set_coolify_env_if "$local_uuid" "IMGPROXY_SALT"              "${IMGPROXY_SALT}"

      # ── Auth settings (Keycloak OIDC) ───────────────────────────
      set_coolify_env "$local_uuid" "DISABLE_SIGNUP"              "${DISABLE_SIGNUP}"
      set_coolify_env "$local_uuid" "ENABLE_EMAIL_SIGNUP"         "${ENABLE_EMAIL_SIGNUP}"
      set_coolify_env "$local_uuid" "ENABLE_EMAIL_AUTOCONFIRM"    "${ENABLE_EMAIL_AUTOCONFIRM}"
      set_coolify_env "$local_uuid" "ENABLE_ANONYMOUS_SIGN_INS"   "${ENABLE_ANONYMOUS_SIGN_INS}"
      set_coolify_env "$local_uuid" "ENABLE_PHONE_SIGNUP"         "${ENABLE_PHONE_SIGNUP}"
      set_coolify_env "$local_uuid" "RATE_LIMIT_EMAIL_SENT"       "${RATE_LIMIT_EMAIL_SENT}"
      set_coolify_env_if "$local_uuid" "ADDITIONAL_REDIRECT_URLS" "${ADDITIONAL_REDIRECT_URLS:-}"

      # ── SMTP ────────────────────────────────────────────────────
      set_coolify_env "$local_uuid" "SMTP_PORT"         "${SMTP_PORT}"
      set_coolify_env "$local_uuid" "SMTP_ADMIN_EMAIL"  "${SMTP_ADMIN_EMAIL}"
      set_coolify_env "$local_uuid" "SMTP_SENDER_NAME"  "${SMTP_SENDER_NAME}"
      set_coolify_env_if "$local_uuid" "SMTP_HOST"      "${SMTP_HOST}"
      set_coolify_env_if "$local_uuid" "SMTP_USER"      "${SMTP_USER}"
      set_coolify_env_if "$local_uuid" "SMTP_PASS"      "${SMTP_PASS}"

      # ── Mailer subjects & templates ─────────────────────────────
      set_coolify_env "$local_uuid" "MAILER_SUBJECTS_CONFIRMATION"  "${MAILER_SUBJECTS_CONFIRMATION}"
      set_coolify_env "$local_uuid" "MAILER_SUBJECTS_RECOVERY"      "${MAILER_SUBJECTS_RECOVERY}"
      set_coolify_env "$local_uuid" "MAILER_SUBJECTS_MAGIC_LINK"    "${MAILER_SUBJECTS_MAGIC_LINK}"
      set_coolify_env "$local_uuid" "MAILER_SUBJECTS_EMAIL_CHANGE"  "${MAILER_SUBJECTS_EMAIL_CHANGE}"
      set_coolify_env "$local_uuid" "MAILER_SUBJECTS_INVITE"        "${MAILER_SUBJECTS_INVITE}"
      set_coolify_env_if "$local_uuid" "MAILER_TEMPLATES_CONFIRMATION" "${MAILER_TEMPLATES_CONFIRMATION}"
      set_coolify_env_if "$local_uuid" "MAILER_TEMPLATES_RECOVERY"     "${MAILER_TEMPLATES_RECOVERY}"
      set_coolify_env_if "$local_uuid" "MAILER_TEMPLATES_MAGIC_LINK"   "${MAILER_TEMPLATES_MAGIC_LINK}"
      set_coolify_env_if "$local_uuid" "MAILER_TEMPLATES_EMAIL_CHANGE" "${MAILER_TEMPLATES_EMAIL_CHANGE}"
      set_coolify_env_if "$local_uuid" "MAILER_TEMPLATES_INVITE"       "${MAILER_TEMPLATES_INVITE}"

      # ── Keycloak OIDC (klient + server — součást core stacku)
      set_coolify_env "$local_uuid" "ENABLE_KEYCLOAK"          "${ENABLE_KEYCLOAK}"
      set_coolify_env "$local_uuid" "KEYCLOAK_CLIENT_ID"       "${KEYCLOAK_CLIENT_ID}"
      set_coolify_env_if "$local_uuid" "KEYCLOAK_CLIENT_SECRET" "${KEYCLOAK_CLIENT_SECRET}"
      set_coolify_env "$local_uuid" "KEYCLOAK_ADMIN"           "${KEYCLOAK_ADMIN}"
      set_coolify_env "$local_uuid" "KEYCLOAK_ADMIN_PASSWORD"  "${KEYCLOAK_ADMIN_PASSWORD}"
      set_coolify_env "$local_uuid" "KEYCLOAK_DB_PASSWORD"     "${KEYCLOAK_DB_PASSWORD}"
      set_coolify_env "$local_uuid" "KEYCLOAK_URL"             "${KEYCLOAK_URL}"
      set_coolify_env "$local_uuid" "KEYCLOAK_REALM"           "${KEYCLOAK_REALM}"

      # ── Per-implementation data fill + operator provisioning ────────────────
      # The migrate seeds platform + selected implementation/private overlay
      # (AISHA_SEED_PROFILE + AISHA_IMPLEMENTATION), and the provision-operators
      # sidecar restores users on wipe from this install's roster
      # (AISHA_OPERATORS, PII -> env-only, never committed).
      set_coolify_env    "$local_uuid" "AISHA_SEED_PROFILE"        "${AISHA_SEED_PROFILE:-instance}"
      set_coolify_env    "$local_uuid" "AISHA_IMPLEMENTATION"      "${AISHA_IMPLEMENTATION:-$(require_instance_prefix)}"
      set_coolify_env_if "$local_uuid" "AISHA_OPERATORS"           "${AISHA_OPERATORS:-}"
      set_coolify_env_if "$local_uuid" "AISHA_PRIMARY_ADMIN_EMAIL" "${AISHA_PRIMARY_ADMIN_EMAIL:-}"
      # PLATFORM_ADMIN_EMAIL is the ONE provisioning key this push was missing.
      # generate-secrets emits it on every stack (it is the reachable admin the
      # realm import creates), and the entrypoint folds it in as the primary
      # admin when a roster file is present — so without it a roster install
      # finishes with that admin authenticated but holding no public.user_roles
      # row (is_admin_or_staff false → /admin 403). Pushed here rather than
      # hard-listed in docker-compose.coolify.yml: this is the delivery channel,
      # and the compose file is committed (see instance-data-provisioning gate).
      set_coolify_env_if "$local_uuid" "PLATFORM_ADMIN_EMAIL"      "${PLATFORM_ADMIN_EMAIL:-}"
      set_coolify_env_if "$local_uuid" "AISHA_IMPLEMENTATION_HOOK" "${AISHA_IMPLEMENTATION_HOOK:-scripts/deploy/instance-data-hook.sh}"
      set_coolify_env_if "$local_uuid" "AISHA_TENANT_HOOK"         "${AISHA_TENANT_HOOK:-}"
      # Private instance overlay clone URL (migrate hook). Loaded from
      # .env.coolify above (cold-start derives it from FORGEJO creds via
      # generate-secrets.mjs). _if: empty = community install → key stays
      # absent/empty in Coolify → compose default `${VAR:-}` → hook no-op.
      set_coolify_env_if "$local_uuid" "AISHA_INSTANCE_DATA_GIT_URL" "${AISHA_INSTANCE_DATA_GIT_URL:-}"

      set_coolify_env_if "$local_uuid" "NETBIRD_DOMAIN"        "${NETBIRD_DOMAIN:-}"
      set_coolify_env_if "$local_uuid" "NETBIRD_STACK_KEY_FRONTEND" "${NETBIRD_STACK_KEY_FRONTEND:-}"

      # ── Google OAuth ────────────────────────────────────────────
      set_coolify_env "$local_uuid" "ENABLE_GOOGLE_OAUTH"          "${ENABLE_GOOGLE_OAUTH}"
      set_coolify_env_if "$local_uuid" "OAUTH_GOOGLE_CLIENT_ID"     "${OAUTH_GOOGLE_CLIENT_ID}"
      set_coolify_env_if "$local_uuid" "OAUTH_GOOGLE_CLIENT_SECRET" "${OAUTH_GOOGLE_CLIENT_SECRET}"

      # ── Apple OAuth ─────────────────────────────────────────────
      set_coolify_env "$local_uuid" "ENABLE_APPLE_OAUTH"           "${ENABLE_APPLE_OAUTH}"
      set_coolify_env_if "$local_uuid" "OAUTH_APPLE_CLIENT_ID"      "${OAUTH_APPLE_CLIENT_ID}"
      set_coolify_env_if "$local_uuid" "OAUTH_APPLE_CLIENT_SECRET"  "${OAUTH_APPLE_CLIENT_SECRET}"

      # ── Studio ──────────────────────────────────────────────────
      set_coolify_env "$local_uuid" "STUDIO_DEFAULT_ORG"     "${STUDIO_DEFAULT_ORG}"
      set_coolify_env "$local_uuid" "STUDIO_DEFAULT_PROJECT" "${STUDIO_DEFAULT_PROJECT}"
      set_coolify_env_if "$local_uuid" "STUDIO_BASIC_AUTH"   "${STUDIO_BASIC_AUTH}"
      set_coolify_env_if "$local_uuid" "STUDIO_OIDC_SECRET"  "${STUDIO_OIDC_SECRET:-}"
      set_coolify_env_if "$local_uuid" "STUDIO_COOKIE_SECRET" "${STUDIO_COOKIE_SECRET:-}"

      # ── pgAdmin (Studio DB UI) ─────────────────────────────────
      set_coolify_env_if "$local_uuid" "PGADMIN_EMAIL"       "${PGADMIN_EMAIL:-}"
      set_coolify_env_if "$local_uuid" "PGADMIN_PASSWORD"    "${PGADMIN_PASSWORD:-}"

      # ── MinIO (storage — shared with langfuse) ──────────────────
      set_coolify_env_if "$local_uuid" "MINIO_ROOT_USER"     "${MINIO_ROOT_USER:-}"
      set_coolify_env_if "$local_uuid" "MINIO_ROOT_PASSWORD" "${MINIO_ROOT_PASSWORD:-}"

      # ── Langfuse DB password (used by shared aisha-db init)  ─────
      set_coolify_env_if "$local_uuid" "LANGFUSE_DB_PASSWORD" "${LANGFUSE_DB_PASSWORD:-}"

      # ── n8n DB password (used by shared aisha-db init for n8n_app role) ──
      set_coolify_env_if "$local_uuid" "N8N_DB_PASSWORD" "${N8N_DB_PASSWORD:-}"

      # ── Keycloak DB password (used by shared aisha-db init for keycloak_app role) ──
      set_coolify_env_if "$local_uuid" "KEYCLOAK_DB_PASSWORD" "${KEYCLOAK_DB_PASSWORD:-}"

      # ── Edge Functions / AI / LLM ───────────────────────────────
      set_coolify_env "$local_uuid" "EDGE_RUNTIME_MODE"  "${EDGE_RUNTIME_MODE}"
      set_coolify_env "$local_uuid" "EDGE_VERIFY_JWT"    "${EDGE_VERIFY_JWT}"
      set_coolify_env_if "$local_uuid" "OPENAI_API_KEY"     "${OPENAI_API_KEY}"
      set_coolify_env_if "$local_uuid" "ANTHROPIC_API_KEY"  "${ANTHROPIC_API_KEY}"
      set_coolify_env_if "$local_uuid" "GOOGLE_AI_API_KEY"  "${GOOGLE_AI_API_KEY}"
      # Derived internal LLM-gateway URL — migrate reconciles the registry endpoint to it.
      set_coolify_env_if "$local_uuid" "AISHA_LLM_GATEWAY_URL" "${AISHA_LLM_GATEWAY_URL:-}"

      # ── n8n ────────────────────────────────────────────────────
      set_coolify_env_if "$local_uuid" "N8N_WEBHOOK_URL"     "${N8N_WEBHOOK_URL}"
      set_coolify_env_if "$local_uuid" "N8N_API_KEY"         "${N8N_API_KEY}"

      # ── Ragnarok (Knowledge Engine) ─────────────────────────────
      set_coolify_env "$local_uuid" "RAGNAROK_API_KEY"  "${RAGNAROK_API_KEY}"
      set_coolify_env "$local_uuid" "RAGNAROK_URL"      "${RAGNAROK_URL}"

      # ── Push Notifications ──────────────────────────────────────
      set_coolify_env_if "$local_uuid" "WEB_PUSH_VAPID_PUBLIC_KEY"  "${WEB_PUSH_VAPID_PUBLIC_KEY}"
      set_coolify_env_if "$local_uuid" "WEB_PUSH_VAPID_PRIVATE_KEY" "${WEB_PUSH_VAPID_PRIVATE_KEY}"
      set_coolify_env "$local_uuid" "WEB_PUSH_VAPID_SUBJECT"        "${WEB_PUSH_VAPID_SUBJECT}"
      set_coolify_env_if "$local_uuid" "FIREBASE_SERVICE_ACCOUNT_JSON" "${FIREBASE_SERVICE_ACCOUNT_JSON}"

      # ── Stripe ──────────────────────────────────────────────────
      set_coolify_env_if "$local_uuid" "STRIPE_SECRET_KEY"       "${STRIPE_SECRET_KEY}"
      set_coolify_env_if "$local_uuid" "STRIPE_WEBHOOK_SECRET"   "${STRIPE_WEBHOOK_SECRET}"

      # ── GitHub / Webhooks ───────────────────────────────────────
      set_coolify_env_if "$local_uuid" "GITHUB_WEBHOOK_SECRET"   "${GITHUB_WEBHOOK_SECRET}"
      # Canonical CORS / origin allowlist from domains.env SoT (single source of truth).
      # All consumers (gateway, storage-auth, ai-chat, blockchain, docs, etc.) should
      # read ALLOWED_ORIGINS. We publish only this name; code has legacy fallback
      # to CORS_ORIGINS for transition.
      set_coolify_env_if "$local_uuid" "ALLOWED_ORIGINS"         "${ALLOWED_ORIGINS}"

      # ── Sentry ──────────────────────────────────────────────────
      set_coolify_env_if "$local_uuid" "VITE_SENTRY_DSN"    "${VITE_SENTRY_DSN}"
      set_coolify_env_if "$local_uuid" "SENTRY_AUTH_TOKEN"  "${SENTRY_AUTH_TOKEN}"
      set_coolify_env_if "$local_uuid" "SENTRY_URL"         "${SENTRY_URL}"
      set_coolify_env "$local_uuid" "SENTRY_ORG"            "${SENTRY_ORG}"
      set_coolify_env "$local_uuid" "SENTRY_PROJECT"        "${SENTRY_PROJECT}"
      set_coolify_env_if "$local_uuid" "SOURCE_COMMIT"      "${SOURCE_COMMIT}"

      # ── Domains (Coolify Traefik routing) ─────────────────────────
      # NOTE: APP_DOMAIN je routován přes aisha-web app (prebuilt compose),
      # NE přes core. Core exposuje:
      #   - gateway (application API) — direct internal route via *.backend.${INTERNAL_TLD};
      #     PUBLIC alias api.${PUBLIC_TLD} routes via aisha-edge edge-proxy → mesh
      step "  Domains — core"
      set_coolify_domains "$local_uuid" \
        "gateway=https://${API_DOMAIN}:3001"
      ;;

    pgadmin)
      info "Nastavuji pgAdmin — interní administrační route..."
      step "  Domains — pgadmin (direct only)"
      set_coolify_domains "$local_uuid" \
        "pgadmin-auth=https://${STUDIO_DOMAIN_DIRECT:?STUDIO_DOMAIN_DIRECT required}:4180"
      ;;

    integration)
      info "Nastavuji Integration (ES + Ragnarok)..."

      # ── Ragnarok ────────────────────────────────────────────────
      set_coolify_env "$local_uuid" "RAGNAROK_API_KEY"  "${RAGNAROK_API_KEY}"
      set_coolify_env_if "$local_uuid" "OPENAI_API_KEY"  "${OPENAI_API_KEY}"
      set_coolify_env_if "$local_uuid" "ELASTIC_PASSWORD" "${ELASTIC_PASSWORD:-}"
      set_coolify_env "$local_uuid" "RABBITMQ_DEFAULT_USER" "${RABBITMQ_DEFAULT_USER}"
      set_coolify_env "$local_uuid" "RABBITMQ_DEFAULT_PASS" "${RABBITMQ_DEFAULT_PASS}"
      set_coolify_env_if "$local_uuid" "NETBIRD_DOMAIN" "${NETBIRD_DOMAIN:-}"
      set_coolify_env_if "$local_uuid" "NETBIRD_STACK_KEY_INTEGRATION" "${NETBIRD_STACK_KEY_INTEGRATION:-}"

      # No domains — internal only when on Backend (Traefik labels removed)
      # On Frontend: no domains needed either (reached via Docker network)
      ;;

    web|edge)
      info "Nastavuji Web (Frontend) — KOMPLETNÍ konfigurace..."

      # ── Build-time (baked into Vite bundle) ─────────────────────
      set_coolify_env "$local_uuid" "VITE_AISHA_BACKEND_URL" "${VITE_AISHA_BACKEND_URL}" "true"
      set_coolify_env "$local_uuid" "VITE_AISHA_BACKEND_ANON_KEY" "${VITE_AISHA_BACKEND_ANON_KEY}" "true"
      set_coolify_env "$local_uuid" "VITE_AISHA_BACKEND_PUBLISHABLE_KEY" "${VITE_AISHA_BACKEND_PUBLISHABLE_KEY}" "true"
      set_coolify_env "$local_uuid" "VITE_AISHA_GATEWAY_URL"      "${VITE_AISHA_GATEWAY_URL}"       "true"
      set_coolify_env "$local_uuid" "VITE_AISHA_GATEWAY_KEY" "${VITE_AISHA_GATEWAY_KEY}"  "true"
      set_coolify_env "$local_uuid" "VITE_API_URL"          "${VITE_API_URL}"           "true"
      set_coolify_env "$local_uuid" "VITE_PUBLIC_SITE_URL"   "${VITE_PUBLIC_SITE_URL}"    "true"
      set_coolify_env "$local_uuid" "PUBLIC_SITE_URL"        "${PUBLIC_SITE_URL}"         "true"
      set_coolify_env "$local_uuid" "VITE_REQUIRE_AISHA_ENV" "${VITE_REQUIRE_AISHA_ENV}" "true"
      set_coolify_env "$local_uuid" "VITE_REQUIRE_AISHA_BACKEND_ENV" "${VITE_REQUIRE_AISHA_BACKEND_ENV}" "true"
      set_coolify_env_if "$local_uuid" "VITE_SENTRY_DSN"      "${VITE_SENTRY_DSN}"         "true"
      set_coolify_env_if "$local_uuid" "VITE_WEB_PUSH_VAPID_PUBLIC_KEY" "${VITE_WEB_PUSH_VAPID_PUBLIC_KEY}" "true"
      set_coolify_env "$local_uuid" "VITE_KC_URL" "${VITE_KC_URL}" "true"
      set_coolify_env "$local_uuid" "VITE_KC_AUTHORITY" "${VITE_KC_AUTHORITY}" "true"
      set_coolify_env "$local_uuid" "VITE_KC_CLIENT_ID" "${VITE_KC_CLIENT_ID}" "true"
      set_coolify_env "$local_uuid" "VITE_AUTH_REDIRECT_URI" "${VITE_AUTH_REDIRECT_URI}" "true"
      set_coolify_env "$local_uuid" "VITE_AUTH_POST_LOGOUT_URI" "${VITE_AUTH_POST_LOGOUT_URI}" "true"

      # ── Sentry sourcemaps (build-time) ──────────────────────────
      set_coolify_env_if "$local_uuid" "SENTRY_AUTH_TOKEN"  "${SENTRY_AUTH_TOKEN}"  "true"
      set_coolify_env_if "$local_uuid" "SENTRY_URL"         "${SENTRY_URL}"         "true"
      set_coolify_env "$local_uuid" "SENTRY_ORG"            "${SENTRY_ORG}"         "true"
      set_coolify_env "$local_uuid" "SENTRY_PROJECT"        "${SENTRY_PROJECT}"     "true"
      set_coolify_env_if "$local_uuid" "SOURCE_COMMIT"      "${SOURCE_COMMIT}"
      set_coolify_env_if "$local_uuid" "GIT_SHA"            "${GIT_SHA:-${SOURCE_COMMIT:-}}" "true"

      # ── Runtime (for migrate service in compose) ────────────────
      set_coolify_env "$local_uuid" "AISHA_DB_URL"        "${AISHA_DB_URL}"

      # ── Edge env vars (mesh routing config) ────────────────────────
      # edge-proxy reads these to populate its Caddyfile per-host targets.
      # Each public domain maps to ONE explicit upstream — over the mesh
      # (NetBird WireGuard) when MESH_ENABLED=true, or via public Backend TLS
      # (https://*.backend.${INTERNAL_TLD}) when MESH_ENABLED=false (the default at
      # cold-start so the platform can come up without waiting for cert
      # acquisition / OpenXPKI bootstrap).
      # SCOPE: only "provided services" — db is admin-only and intentionally
      # NOT exposed publicly (admins use db.backend.${INTERNAL_TLD} direct).
      set_coolify_env "$local_uuid" "MCP_DOMAIN"         "${MCP_DOMAIN}"
      set_coolify_env "$local_uuid" "DIRIGENT_DOMAIN"    "${DIRIGENT_DOMAIN}"
      set_coolify_env "$local_uuid" "API_DOMAIN_PUBLIC"  "${API_DOMAIN_PUBLIC}"
      set_coolify_env "$local_uuid" "AUTH_DOMAIN_PUBLIC" "${AUTH_DOMAIN_PUBLIC}"

      # ── Apex / public-web brand routing (env-driven, no cert logic) ────────
      # edge-proxy builds its Caddyfile apex router from these at runtime
      # (308 redirect vs serve). Push them explicitly so apex behaviour follows
      # OUR env contract, not the compose-default fallback (AISHA_WEB_APEX_MODE
      # → 'redirect'), which silently 308s the apex away from its branding host.
      # All emitted by scripts/lib/derive-domains.mjs (sourced above). TLS/ACME
      # is terminated upstream on pfSense/HAProxy — nothing cert-related here.
      set_coolify_env "$local_uuid" "PUBLIC_TLD"          "${PUBLIC_TLD:-}"
      set_coolify_env "$local_uuid" "APP_DOMAIN"          "${APP_DOMAIN:-}"
      set_coolify_env "$local_uuid" "AISHA_WEB_APEX_MODE" "${AISHA_WEB_APEX_MODE:-redirect}"
      set_coolify_env "$local_uuid" "EDGE_APEX_DOMAIN"    "${EDGE_APEX_DOMAIN:-}"

      for required_edge_key in MCP_DOMAIN DIRIGENT_DOMAIN API_DOMAIN_PUBLIC AUTH_DOMAIN_PUBLIC MESH_ENABLED MCP_UPSTREAM_PUBLIC API_UPSTREAM_PUBLIC DIRIGENT_UPSTREAM_PUBLIC AUTH_UPSTREAM_PUBLIC MCP_UPSTREAM_MESH API_UPSTREAM_MESH DIRIGENT_UPSTREAM_MESH AUTH_UPSTREAM_MESH; do
        require_env "$required_edge_key"
      done

      # Optional operator overrides. Empty means the entrypoint derives from
      # MESH_ENABLED plus the generated *_UPSTREAM_PUBLIC / *_UPSTREAM_MESH
      # values; syncing empty values also clears stale pins from previous runs.
      set_coolify_env "$local_uuid" "MCP_UPSTREAM"       "${MCP_UPSTREAM:-}"
      set_coolify_env "$local_uuid" "API_UPSTREAM"       "${API_UPSTREAM:-}"
      set_coolify_env "$local_uuid" "DIRIGENT_UPSTREAM"  "${DIRIGENT_UPSTREAM:-}"
      set_coolify_env "$local_uuid" "AUTH_UPSTREAM"      "${AUTH_UPSTREAM:-}"

      # MESH_ENABLED switch — generated by the topology resolver / env contract.
      set_coolify_env "$local_uuid" "MESH_ENABLED"       "${MESH_ENABLED}"

      # Generated route targets from the topology resolver.
      set_coolify_env "$local_uuid" "MCP_UPSTREAM_PUBLIC"      "${MCP_UPSTREAM_PUBLIC}"
      set_coolify_env "$local_uuid" "API_UPSTREAM_PUBLIC"      "${API_UPSTREAM_PUBLIC}"
      set_coolify_env "$local_uuid" "DIRIGENT_UPSTREAM_PUBLIC" "${DIRIGENT_UPSTREAM_PUBLIC}"
      set_coolify_env "$local_uuid" "AUTH_UPSTREAM_PUBLIC"     "${AUTH_UPSTREAM_PUBLIC}"
      set_coolify_env "$local_uuid" "MCP_UPSTREAM_MESH"        "${MCP_UPSTREAM_MESH}"
      set_coolify_env "$local_uuid" "API_UPSTREAM_MESH"        "${API_UPSTREAM_MESH}"
      set_coolify_env "$local_uuid" "DIRIGENT_UPSTREAM_MESH"   "${DIRIGENT_UPSTREAM_MESH}"
      set_coolify_env "$local_uuid" "AUTH_UPSTREAM_MESH"       "${AUTH_UPSTREAM_MESH}"
      # Host pro mesh lane (přísný mesh-ingress routuje podle <endpoint>.<zóna>).
      # Volitelný: derivace ho vydá jen při portové shodě edge_mesh_upstream ×
      # internal_endpoints; prázdno = entrypoint drží host z upstream URL.
      set_coolify_env_if "$local_uuid" "API_MESH_HOST"          "${API_MESH_HOST:-}"

      # Optional edge-fronted faces (tier:optional services — live/gateway/
      # companion). Domains are always emitted by the resolver (real value or
      # `.invalid` sentinel); upstreams only when the service is in the
      # profile. set_coolify_env_if skips empties, the entrypoint's
      # conditional-block guards handle the rest.
      set_coolify_env_if "$local_uuid" "LIVE_DOMAIN_PUBLIC"        "${LIVE_DOMAIN_PUBLIC:-}"
      set_coolify_env_if "$local_uuid" "LIVE_UPSTREAM_PUBLIC"      "${LIVE_UPSTREAM_PUBLIC:-}"
      # Extranet: edge ROUTUJE jeho veřejný host, nehostuje ho. Do 2026-07-29
      # si extranet nesl doménu sám a edge obcházel.
      set_coolify_env_if "$local_uuid" "EXTRANET_DOMAIN_PUBLIC"    "${EXTRANET_DOMAIN_PUBLIC:-}"
      set_coolify_env_if "$local_uuid" "EXTRANET_UPSTREAM_PUBLIC"  "${EXTRANET_UPSTREAM_PUBLIC:-}"
      set_coolify_env_if "$local_uuid" "LIVE_UPSTREAM_MESH"        "${LIVE_UPSTREAM_MESH:-}"
      set_coolify_env_if "$local_uuid" "GATEWAY_DOMAIN_PUBLIC"     "${GATEWAY_DOMAIN_PUBLIC:-}"
      set_coolify_env_if "$local_uuid" "GATEWAY_UPSTREAM_PUBLIC"   "${GATEWAY_UPSTREAM_PUBLIC:-}"
      set_coolify_env_if "$local_uuid" "GATEWAY_UPSTREAM_MESH"     "${GATEWAY_UPSTREAM_MESH:-}"
      set_coolify_env_if "$local_uuid" "COMPANION_DOMAIN_PUBLIC"   "${COMPANION_DOMAIN_PUBLIC:-}"
      set_coolify_env_if "$local_uuid" "COMPANION_UPSTREAM_PUBLIC" "${COMPANION_UPSTREAM_PUBLIC:-}"
      set_coolify_env_if "$local_uuid" "COMPANION_UPSTREAM_MESH"   "${COMPANION_UPSTREAM_MESH:-}"

      # ── Domains (Coolify proxy routing) ────────────────────────────
      # `web` registers the instance's public web hostnames → web container.
      # ⛔ NAMĚŘENO 2026-10-04 (ostrý cold-start forku s víc značkami): tady se
      # domény webu skládaly vlastním výkladem (`${WEB_FQDNS:-https://${APP_DOMAIN}}`
      # + aliasy a apex jen bez WEB_FQDNS), kdežto coolify-domain-doctor.mjs jiným
      # (APP_DOMAIN + aliasy + apex, WEB_FQDNS vůbec neznal). Doktor běží v kroku 4
      # PO tomhle zápisu, takže jeho užší výklad vyhrál a `web` přišel o routy
      # značek (Traefik 404, bez certifikátu). Teď je výklad JEDEN:
      # scripts/lib/domeny-webu.mjs (pravidlo, pořadí, „nevím" i neplatné vstupy
      # popisuje tam). Nesložené domény = konec, ne prázdný/užší seznam.
      #
      # `edge-proxy` is the Caddy listener (port 80) that reverse-proxies the
      # public *.${PUBLIC_TLD} hostnames to their *.backend.${INTERNAL_TLD}
      # upstreams (auth/api/mcp/dirigent). Register ALL public hostnames on it
      # as ONE comma-separated docker_compose_domains entry — Coolify auto-gen
      # then emits one Traefik router per host + the matching loadbalancer
      # service (port 80). This is the production routing source of truth:
      # the compose Traefik labels carry ${VAR} placeholders (correct for
      # local `docker compose up`) but Coolify escapes $ → $$ at deploy time,
      # so ${AUTH_DOMAIN_PUBLIC} would stay a literal string and never match.
      #
      # `mesh-router` has NO public listener (NetBird agent + iptables DNAT
      # only), therefore it MUST NOT appear in docker_compose_domains at all.
      # Even a reserved `.invalid` value is indexed by Coolify as a globally
      # unique domain and poisons the whole multi-tenant PATCH.
      step "  Domains — edge (web + edge-proxy public hostnames)"
      if ! WEB_DOMAINS="$(node "$_di_dir/lib/domeny-webu.mjs" --csv)"; then
        err "  Domény webu nejdou složit z deklarace instance (důvody výše) — doménový kontrakt edge se NEZAPÍŠE"
        exit 1
      fi

      # Apex (bare ${PUBLIC_TLD}) joins the edge-proxy host list ONLY in
      # redirect mode when the operator's apex differs from the canonical web
      # host — edge-proxy's Caddy answers it with HTTP 308 →
      # https://${APP_DOMAIN}${uri}. In serve mode, web receives the apex and
      # DB branding_hostname_mapping decides which GrapesJS page is rendered.
      # ⛔ AUTH_DOMAIN_PUBLIC tu BÝVAL a byl odstraněn 2026-08-25.
      # Edge překládá veřejné jméno na MESH — jenže tehdy si netbird management
      # z OIDC discovery PŘEPSAL vnitřní AuthKeysLocation na VEŘEJNÝ jwks_uri,
      # sáhl na edge (který přichází až PO meshi), dostal 503 "no available
      # server" a odmítl KAŽDÝ token. Veřejnou tvář auth proto servíruje
      # Keycloak SÁM (KEYCLOAK_DOMAIN_DIRECT), od vlny 4 a bez meshe.
      #
      # ⭐ PŘEMĚŘENO 2026-09-04: TA PŘÍČINA UŽ NEPLATÍ. `OIDCConfigEndpoint` je
      # z management.json odstraněný (téhož dne 08-25), takže discovery vnitřní
      # adresu nepřebíjí. Sweep přes VŠECHNY běžící kontejnery nenašel ANI JEDEN
      # backchannel endpoint (JWKS/token/admin/keys) na veřejné tváři: brána má
      # KC_JWKS_URL=http://<prefix>-keycloak:80, KC_TOKEN_URL přes mesh,
      # a KC_ISSUER slouží jen k ověření claimu `iss`, nic se z něj nestahuje.
      # Veřejná adresa zůstala JEN ve `VITE_KC_*`, tedy tam, kde je na druhé
      # straně prohlížeč (frontchannel).
      #
      # ⛔ TENHLE ZÁPIS PROTO NENÍ ZÁKAZ, JE TO HISTORIE. Zůstal platit i poté,
      # co příčina zmizela — nikdo se ho znovu nezeptal. Přesně ta třída, kdy se
      # něco ověří JEDNOU a platí napořád (zmrazená kotva důvěry, placeholder
      # vyplněný při prvním běhu).
      #
      # ⭐ CO Z TOHO PLYNE PRO DVEŘE. Majitelovo zadání zní „přihlásit se můžeš,
      # ale až potom co správně zaklepeš". Správná cesta k tomu NENÍ vrátit
      # AUTH_DOMAIN_PUBLIC sem — to by auth svázalo s hranou a meshem, tedy
      # s fázemi, kdy ještě nestojí, a kruh by se vrátil. Správná cesta je
      # dveřník PŘÍMO PŘED Keycloakem (forward_auth na svc-knock + lokální
      # proxy), který mesh nepotřebuje a funguje v každé fázi.
      EDGE_PROXY_DOMAINS="https://${API_DOMAIN_PUBLIC},https://${MCP_DOMAIN},https://${DIRIGENT_DOMAIN}"
      # Režim apexu vykládá TENTÝŽ normalizátor jako složení webu výš a doktor domén
      # (lib/domeny-webu.mjs → derive-domains normalizeApexMode). Vlastní porovnání
      # s doslovným "serve" by surové `web`/`spa` četlo jako redirect, kdežto web
      # jako serve — apex by dostal web i edge-proxy.
      if ! WEB_APEX_REZIM="$(node "$_di_dir/lib/domeny-webu.mjs" --rezim-apexu)"; then
        err "  Režim apexu nejde určit (důvod výše) — doménový kontrakt edge se NEZAPÍŠE"
        exit 1
      fi
      if [ "${WEB_APEX_REZIM}" != "serve" ] && [ -n "${PUBLIC_TLD:-}" ] && [ "${PUBLIC_TLD}" != "${APP_DOMAIN:-}" ]; then
        EDGE_PROXY_DOMAINS="${EDGE_PROXY_DOMAINS},https://${PUBLIC_TLD}"
      fi
      # Optional edge-fronted public faces (live/gateway/companion). The
      # resolver emits real hostnames when the service is in the profile, or
      # `.invalid` sentinels when not — only real hostnames join the frontend
      # Traefik contract. Must match coolify-domain-doctor.mjs edgeProxyDomains().
      # ⛔ AUTH PATŘÍ MEZI NĚ (naměřeno 2026-08-28) — a dřívější námitka už neplatí.
      #
      # `coolify-domain-doctor.mjs` vynechával AUTH_DOMAIN_PUBLIC s odůvodněním
      # „servíruje si ji Keycloak sám, protože edge ji umí přeložit až přes mesh".
      # Jenže:
      #   1) do kontraktu Keycloaku se to NIKDY nepropsalo (registroval jen PŘÍMOU
      #      tvář), takže veřejné jméno nemělo router U NIKOHO → Traefik 404;
      #   2) zaregistrovat ho na Keycloaku NELZE: ten běží v zóně `*.backend`
      #      (uzel Giah), kdežto `auth.<public-tld>` posílá pfSense na uzel s edge.
      #      Router by vznikl tam, kam provoz nedorazí — a navíc by si vyžádal
      #      certifikát, který nemůže projít validací, a pálil limit ACME účtu;
      #   3) edge auth NEPŘEKLÁDÁ přes mesh. Jeho vlastní log říká:
      #        [edge-proxy] AUTH_DOMAIN_PUBLIC=auth.<public> → https://<prefix>-auth.backend.<tld>
      #      tedy PŘÍMÁ tvář. Kruh „mesh bez Keycloaku nevznikne" tady nevzniká.
      #
      # Následek chybějící registrace byl tichý a drahý: `extra.<public>` správně
      # přesměroval na `auth.<public>/realms/…/auth`, to vrátilo 404 a KAŽDÉ OIDC
      # přihlášení skončilo dřív, než začalo. Vypadalo to na vadu extranetu.
      for _edge_face_var in KEYCLOAK_DOMAIN_PUBLIC LIVE_DOMAIN_PUBLIC GATEWAY_DOMAIN_PUBLIC COMPANION_DOMAIN_PUBLIC INGEST_DOMAIN_PUBLIC POTOK_DOMAIN_PUBLIC EXTRANET_DOMAIN_PUBLIC; do
        _edge_face_val="$(eval "printf '%s' \"\${${_edge_face_var}:-}\"")"
        case "${_edge_face_val}" in
          ""|*.invalid) : ;;
          *) EDGE_PROXY_DOMAINS="${EDGE_PROXY_DOMAINS},https://${_edge_face_val}" ;;
        esac
      done
      # netbird.<public> — řídicí rovina meshe: edge → PŘÍMÁ tvář (výjimka
      # z „veřejné jde do meshe", majitel 2026-09-16). Jen s přímou tváří, jinak
      # router bez trasy. Musí souhlasit s coolify-domain-doctor.mjs.
      # ⛔ Jedno jméno pro obě tváře (jednouzlová topologie — derivace ho
      # nevyrábí, instanční profil ano): jméno si vezme netbird-proxy níž. Kdyby
      # ho vzal i edge, jsou na jednom Traefiku dva Host routery pro týž host
      # (nejednoznačné směrování) a edge by proxoval sám na sebe.
      if [ "${NETBIRD_DOMAIN:-}" != "${NETBIRD_DOMAIN_DIRECT:-}" ]; then
        case "${NETBIRD_DOMAIN:-}|${NETBIRD_DOMAIN_DIRECT:-}" in
          "|"*|*"|"|*.invalid"|"*|*.invalid) : ;;
          *) EDGE_PROXY_DOMAINS="${EDGE_PROXY_DOMAINS},https://${NETBIRD_DOMAIN}" ;;
        esac
      fi
      # Cizí aplikace přes mesh (EXTERNAL_FACES) — seznam z derivace.
      # Musí souhlasit s coolify-domain-doctor.mjs.
      for _edge_ext_host in $(printf '%s' "${EDGE_EXTERNAL_FACE_HOSTS:-}" | tr ',' ' '); do
        case "${_edge_ext_host}" in
          *.invalid) : ;;
          *) EDGE_PROXY_DOMAINS="${EDGE_PROXY_DOMAINS},https://${_edge_ext_host}" ;;
        esac
      done
      set_coolify_domains "$local_uuid" \
        "web=${WEB_DOMAINS}" \
        "edge-proxy=${EDGE_PROXY_DOMAINS}"

      # ── Zaťukání na dveře (svc-knock) ─────────────────────────────────────
      # Vrátný jede s edge, protože hlídá právě jeho hranu. Zapíná se PROFILEM,
      # ne změnou kódu — týž vzor, jakým se zapínají matrixové mosty níž.
      #
      # ⭐ VÝCHOZÍ STAV JE MĚŘENÍ, NE PROVOZ. `SPA_DIAGNOSE=1` znamená, že
      # služba odmítne start s operátory, takže STRUKTURÁLNĚ nemůže nic otevřít.
      # Čerstvá instance tak má dveře, které měří, jestli datagram vůbec doletí.
      step "  Env — dveře (svc-knock)"
      set_coolify_env    "$local_uuid" "SPA_DIAGNOSE"          "${SPA_DIAGNOSE:-1}"
      # Port je RUČNÍ deklarace operátora (env-doktor), žádný literál; prázdný jen bez dveří.
      set_coolify_env    "$local_uuid" "SPA_KNOCK_PUBLIC_PORT" "${SPA_KNOCK_PUBLIC_PORT:-}"
      set_coolify_env    "$local_uuid" "REDIS_PASSWORD_CORE"   "${REDIS_PASSWORD_CORE:-}"
      set_coolify_env    "$local_uuid" "SHARED_REDIS_HOST"     "${SHARED_REDIS_HOST:-}"
      set_coolify_env_if "$local_uuid" "SPA_OPERATORS_B64"     "${SPA_OPERATORS_B64:-}"
      set_coolify_env_if "$local_uuid" "SPA_STATIC_ALLOW"      "${SPA_STATIC_ALLOW:-}"
      set_coolify_env_if "$local_uuid" "SPA_BLACKLIST"         "${SPA_BLACKLIST:-}"
      set_coolify_env_if "$local_uuid" "SPA_ALERT_WEBHOOK"     "${SPA_ALERT_WEBHOOK:-}"

      # Dveře zapíná JEN deklarace instance (`EDGE_COMPOSE_PROFILES` ∋ knock,
      # lib/dvere-soulad.mjs) — roster ne. Prázdno = dveře se nenasadí a merge
      # tedy nikdy nic nerozsvítí sám. Odvozené profily se k deklaraci SLUČUJÍ
      # (lib/mesh-profile.sh: edge_compose_profily), nevylučují.
      edge_compose_profiles="${EDGE_COMPOSE_PROFILES:-}"
      # ⛔ `extranet-gate` BYL OSIŘELÝ PROFIL (naměřeno 2026-08-27 na živém edge).
      #
      # `extranet-auth` (oauth2-proxy před povrchem extranetu) má v compose
      # `profiles: ["extranet-gate"]`, jenže ten řetězec se v CELÉM repu
      # vyskytoval na jediném místě — v té deklaraci. Nezapínal ho žádný skript,
      # žádná dokumentace, žádná proměnná. Compose profil, který nikdo nevyhlásí,
      # službu NEVYTVOŘÍ vůbec: kontejner nebyl ani spuštěný, ani ukončený.
      #
      # Edge se zachoval správně a fail-closed:
      #     [edge-proxy] extranet: brána vyhlášená, ale extranet-auth NEODPOVÍDÁ
      #                  — route VYPNUTA (radši nedostupné než otevřené)
      # a `extra.<public-tld>` vracelo 404. Vypadalo to na chybějící routu;
      # ve skutečnosti chyběla služba, kterou nešlo zapnout.
      #
      # Zapíná se tedy podle DEKLARACE instance, ne ručně: kdo v `AISHA_SURFACES`
      # vyhlásí extranet, dostane i jeho bránu.
      edge_compose_profiles="$(edge_compose_profily "${edge_compose_profiles}" "${AISHA_SURFACES:-}")"
      # Deklarované dveře musí být v souladu (režim ↔ roster) DŘÍV, než se profil
      # zapíše: svc-knock v rozporu nenaběhne a stáhne s sebou edge.
      if [[ ",${edge_compose_profiles}," == *,knock,* ]] && [ "$DRY_RUN" != "1" ]; then
        if ! node "$_di_dir/lib/dvere-soulad.mjs" --soulad; then
          err "  Dveře: deklarace instance není v souladu (výpis výše) — COMPOSE_PROFILES edge se NEZAPÍŠE"
          exit 1
        fi
      fi
      edge_compose_profiles="$(mesh_profile_merge "${edge_compose_profiles}")"
      set_coolify_env "$local_uuid" "COMPOSE_PROFILES" "${edge_compose_profiles}"
      ;;

    extranet)
      info "Nastavuji Extranet — canonical internal route; public alias owns edge..."
      step "  Domains — extranet (internal canonical host)"
      set_coolify_domains "$local_uuid" \
        "extranet=https://${EXTRANET_DOMAIN:?EXTRANET_DOMAIN required}:8080"
      ;;

    monitoring)
      info "Nastavuji Monitoring (Dozzle)..."
      if [ -n "${DOZZLE_DOMAIN:-}" ]; then
        step "  Domains — monitoring"
        set_coolify_domains "$local_uuid" \
          "dozzle-auth=https://${DOZZLE_DOMAIN}:4181"
      else
        info "Monitoring domain is not configured for this profile — direct route skipped"
      fi
      ;;

    langfuse|observability)
      info "Nastavuji Langfuse (AI Observability) — KOMPLETNÍ konfigurace..."

      # ── Shared DB ───────────────────────────────────────────────
      set_coolify_env "$local_uuid" "POSTGRES_PASSWORD"      "${POSTGRES_PASSWORD}"
      set_coolify_env "$local_uuid" "LANGFUSE_DB_PASSWORD"   "${LANGFUSE_DB_PASSWORD}"
      set_coolify_env "$local_uuid" "LANGFUSE_ENCRYPTION_KEY" "${LANGFUSE_ENCRYPTION_KEY}"
      # postgres-exporter (in this stack) scrapes core's db; needs the dedicated
      # password so DATA_SOURCE_NAME works. The ALTER happens in core's db init.
      set_coolify_env_if "$local_uuid" "POSTGRES_EXPORTER_PASSWORD" "${POSTGRES_EXPORTER_PASSWORD}"

      # ── ClickHouse ──────────────────────────────────────────────
      set_coolify_env_if "$local_uuid" "CLICKHOUSE_USER"     "${CLICKHOUSE_USER:-}"
      set_coolify_env_if "$local_uuid" "CLICKHOUSE_PASSWORD" "${CLICKHOUSE_PASSWORD:-}"

      # ── Redis ───────────────────────────────────────────────────
      set_coolify_env_if "$local_uuid" "REDIS_PASSWORD"      "${REDIS_PASSWORD:-}"

      # ── MinIO ───────────────────────────────────────────────────
      set_coolify_env_if "$local_uuid" "MINIO_ROOT_USER"     "${MINIO_ROOT_USER:-}"
      set_coolify_env_if "$local_uuid" "MINIO_ROOT_PASSWORD" "${MINIO_ROOT_PASSWORD:-}"

      # ── Langfuse app ────────────────────────────────────────────
      set_coolify_env "$local_uuid" "LANGFUSE_DOMAIN"              "${LANGFUSE_DOMAIN}"
      set_coolify_env_if "$local_uuid" "LANGFUSE_NEXTAUTH_SECRET"  "${LANGFUSE_NEXTAUTH_SECRET:-}"
      set_coolify_env_if "$local_uuid" "LANGFUSE_SALT"             "${LANGFUSE_SALT:-}"
      set_coolify_env_if "$local_uuid" "LANGFUSE_PUBLIC_KEY"       "${LANGFUSE_PUBLIC_KEY:-}"
      set_coolify_env_if "$local_uuid" "LANGFUSE_SECRET_KEY"       "${LANGFUSE_SECRET_KEY:-}"
      set_coolify_env_if "$local_uuid" "LANGFUSE_ADMIN_EMAIL"      "${LANGFUSE_ADMIN_EMAIL:-}"
      set_coolify_env_if "$local_uuid" "LANGFUSE_ADMIN_PASSWORD"   "${LANGFUSE_ADMIN_PASSWORD:-}"

      # ── SSO / OIDC ──────────────────────────────────────────────
      set_coolify_env "$local_uuid" "KEYCLOAK_DOMAIN"              "${KEYCLOAK_DOMAIN}"
      set_coolify_env_if "$local_uuid" "LANGFUSE_OIDC_SECRET"      "${LANGFUSE_OIDC_SECRET:-}"

      step "  Domains — langfuse"
      set_coolify_domains "$local_uuid" \
        "langfuse-gateway=https://${LANGFUSE_DOMAIN}:8080"
      ;;

    admin)
      info "Nastavuji Admin (NocoDB + Appsmith) — KOMPLETNÍ konfigurace..."

      # ── Shared DB ───────────────────────────────────────────────
      set_coolify_env "$local_uuid" "POSTGRES_PASSWORD"      "${POSTGRES_PASSWORD}"

      # ── NocoDB ──────────────────────────────────────────────────
      set_coolify_env "$local_uuid" "NOCODB_DOMAIN"                "${NOCODB_DOMAIN}"
      set_coolify_env_if "$local_uuid" "NOCODB_JWT_SECRET"         "${NOCODB_JWT_SECRET:-}"
      set_coolify_env_if "$local_uuid" "NOCODB_OIDC_SECRET"        "${NOCODB_OIDC_SECRET:-}"

      # ── Appsmith ────────────────────────────────────────────────
      set_coolify_env "$local_uuid" "APPSMITH_DOMAIN"                    "${APPSMITH_DOMAIN}"
      set_coolify_env_if "$local_uuid" "INTRANET_DOMAIN"                 "${INTRANET_DOMAIN:-}"
      set_coolify_env_if "$local_uuid" "APPSMITH_ENCRYPTION_PASSWORD"    "${APPSMITH_ENCRYPTION_PASSWORD:-}"
      set_coolify_env_if "$local_uuid" "APPSMITH_ENCRYPTION_SALT"        "${APPSMITH_ENCRYPTION_SALT:-}"
      # Admin login — generated by generate-secrets; provision-appsmith.sh reads it.
      set_coolify_env_if "$local_uuid" "APPSMITH_ADMIN_PASSWORD"         "${APPSMITH_ADMIN_PASSWORD:-}"

      # ── SSO / OIDC ──────────────────────────────────────────────
      set_coolify_env "$local_uuid" "KEYCLOAK_DOMAIN"                    "${KEYCLOAK_DOMAIN}"
      set_coolify_env_if "$local_uuid" "NOCODB_DB_PASSWORD"              "${NOCODB_DB_PASSWORD:-}"
      set_coolify_env_if "$local_uuid" "APPSMITH_OIDC_SECRET"            "${APPSMITH_OIDC_SECRET:-}"
      # APPSMITH_INTRANET_OIDC_SECRET — used by intranet-auth (OAuth2
      # Proxy variant for staff-only Appsmith intranet route). Memory
      # audit_aisha_admin_2026-05-07.md flagged this missing → restart
      # loop with "missing client-secret". Generated in cold-start via
      # preserve_or_gen but was never propagated to the aisha-admin app.
      set_coolify_env_if "$local_uuid" "APPSMITH_INTRANET_OIDC_SECRET"   "${APPSMITH_INTRANET_OIDC_SECRET:-}"
      set_coolify_env_if "$local_uuid" "OAUTH2_PROXY_COOKIE_SECRET"      "${OAUTH2_PROXY_COOKIE_SECRET:-}"

      # OAUTH2_COOKIE_DOMAINS — picked up by all 3 OAuth2-Proxy services
      # (nocodb-auth, appsmith-auth, intranet-auth). Profile-driven, so
      # cloud-multi → ".backend.${INTERNAL_TLD},.${PUBLIC_TLD}"; local-dev → ".local"; etc.
      # Compose has fallback ${OAUTH2_COOKIE_DOMAINS:-.backend.${INTERNAL_TLD}} for
      # backward-compat.
      set_coolify_env_if "$local_uuid" "OAUTH2_COOKIE_DOMAINS"           "${OAUTH2_COOKIE_DOMAINS:-}"
      set_coolify_env_if "$local_uuid" "OAUTH2_WHITELIST_DOMAINS"        "${OAUTH2_WHITELIST_DOMAINS:-}"

      step "  Domains — admin"
      set_coolify_domains "$local_uuid" \
        "nocodb=https://${NOCODB_DOMAIN}:8080" \
        "appsmith-auth=https://${APPSMITH_DOMAIN}:4180" \
        "intranet-auth=https://${INTRANET_DOMAIN}:4180"
      ;;

    n8n|orchestration)
      info "Nastavuji n8n (Workflow Engine) — KOMPLETNÍ konfigurace..."

      # ── DB (role n8n_app is created in shared aisha-db init) ───
      set_coolify_env "$local_uuid" "N8N_DB_USER"                "n8n_app"
      set_coolify_env "$local_uuid" "N8N_DB_PASSWORD"            "${N8N_DB_PASSWORD}"
      set_coolify_env "$local_uuid" "POSTGRES_PASSWORD"          "${POSTGRES_PASSWORD}"

      # ── n8n core ──────────────────────────────────────────────
      set_coolify_env "$local_uuid" "N8N_ENCRYPTION_KEY"         "${N8N_ENCRYPTION_KEY}"
      set_coolify_env "$local_uuid" "N8N_BASIC_AUTH_PASSWORD"    "${N8N_BASIC_AUTH_PASSWORD}"
      set_coolify_env "$local_uuid" "N8N_OIDC_SECRET"            "${N8N_OIDC_SECRET}"
      set_coolify_env "$local_uuid" "N8N_COOKIE_SECRET"          "${N8N_COOKIE_SECRET}"
      set_coolify_env "$local_uuid" "N8N_DB_HOST"                "${N8N_DB_HOST}"
      set_coolify_env "$local_uuid" "N8N_DB_PORT"                "${N8N_DB_PORT}"
      set_coolify_env "$local_uuid" "N8N_DB_NAME"                "${N8N_DB_NAME}"

      # ── n8n workflow bootstrap (headless API-key mint, in-cluster) ───────
      # The one-shot n8n-workflow-init container claims the seeded n8n owner
      # (fresh instance) or logs in as it (redeploy) and mints a public API key
      # purely in-cluster (http://n8n:5678) to deploy WF_*. The owner password
      # is the platform secret N8N_BOOTSTRAP_OWNER_PASSWORD (generate-secrets →
      # .env.coolify), delivered by coolify-sync-envs like every compose ref;
      # no API key or Coolify token is generated or stored here. See
      # scripts/n8n-bootstrap-apikey.mjs + scripts/n8n-deploy-entrypoint.sh.
      set_coolify_env "$local_uuid" "N8N_BOOTSTRAP_OWNER_EMAIL"   "${N8N_BOOTSTRAP_OWNER_EMAIL:-n8n-owner@${N8N_DOMAIN}}"

      # ── AISHA backend/PostgREST access (gateway URL + service key) ──
      set_coolify_env "$local_uuid" "AISHA_SERVICE_KEY"                "${SERVICE_ROLE_KEY}"
      set_coolify_env "$local_uuid" "AISHA_API_URL"                    "${AISHA_API_URL}"
      set_coolify_env "$local_uuid" "AISHA_ANON_KEY"                   "${ANON_KEY}"
      set_coolify_env "$local_uuid" "AISHA_BACKEND_URL"                "${AISHA_BACKEND_URL}"
      set_coolify_env "$local_uuid" "AISHA_BACKEND_SERVICE_KEY"        "${SERVICE_ROLE_KEY}"

      # ── Self-tooling loop (WF_AISHA_TOOLING_*) — push the workflow-expected env
      #    names, each DERIVED from a canonical cold-start var (no hardcoding). The
      #    n8n/worker compose passes them through as ${VAR:-}. Anthropic + Forgejo
      #    are soft (operator BYOK): if absent the self-tooling workflows stay idle,
      #    the rest of n8n is unaffected. ──
      set_coolify_env    "$local_uuid" "AISHA_POSTGREST_URL"           "${AISHA_API_URL}"
      # PostgREST service key: the committer reuses the already-wired AISHA_SERVICE_KEY
      # (no separate plaintext secret). ANTHROPIC_API_KEY + FORGEJO_API_TOKEN below are
      # bootstrap-only — read once by the transient n8n-workflow-init to mint encrypted
      # n8n credentials; the long-running n8n/n8n-worker never receive them.
      set_coolify_env_if "$local_uuid" "N8N_WEBHOOK_URL"               "${N8N_WEBHOOK_URL:-}"
      set_coolify_env_if "$local_uuid" "ANTHROPIC_API_KEY"             "${ANTHROPIC_API_KEY:-}"
      set_coolify_env_if "$local_uuid" "ANTHROPIC_API_URL"             "${ANTHROPIC_API_URL:-}"
      set_coolify_env_if "$local_uuid" "FORGEJO_API_URL"               "${FORGEJO_API_URL:-${FORGEJO_URL:-}}"
      set_coolify_env_if "$local_uuid" "FORGEJO_OWNER"                 "${FORGEJO_OWNER:-}"
      set_coolify_env_if "$local_uuid" "FORGEJO_REPO"                  "${FORGEJO_REPO:-}"
      set_coolify_env_if "$local_uuid" "FORGEJO_API_TOKEN"             "${FORGEJO_API_TOKEN:-}"
      set_coolify_env_if "$local_uuid" "FORGEJO_DEFAULT_ASSIGNEE"      "${FORGEJO_DEFAULT_ASSIGNEE:-admin}"
      set_coolify_env "$local_uuid" "RABBITMQ_USER"                    "${RABBITMQ_USER}"
      set_coolify_env "$local_uuid" "RABBITMQ_PASS"                    "${RABBITMQ_PASS}"
      set_coolify_env "$local_uuid" "RABBITMQ_HOST"                    "${RABBITMQ_HOST}"
      set_coolify_env "$local_uuid" "RABBITMQ_PORT"                    "${RABBITMQ_PORT}"
      set_coolify_env "$local_uuid" "NETBIRD_DNS_IP"                   "${NETBIRD_DNS_IP}"
      # Rozsah peerů: edge-proxy si přes něj staví routu do mesh (via mesh-router).
      set_coolify_env "$local_uuid" "NETBIRD_PEER_CIDR"                "${NETBIRD_PEER_CIDR}"

      # ── OIDC ──────────────────────────────────────────────────
      set_coolify_env "$local_uuid" "KEYCLOAK_DOMAIN"            "${KEYCLOAK_DOMAIN}"
      set_coolify_env "$local_uuid" "N8N_DOMAIN"                 "${N8N_DOMAIN}"

      # n8n-auth (OAuth2 Proxy) needs multi-zone cookie scoping for the
      # mcp.${PUBLIC_TLD} ↔ n8n.backend.${INTERNAL_TLD} cross-zone redirects (memory:
      # feedback_oauth2_multi_zone_cookies.md).
      # Legacy cleanup: older deployments had OAUTH2_PROXY_REDIRECT_URL fixed
      # to mcp.${PUBLIC_TLD}, which breaks the new dirigent.${PUBLIC_TLD} alias and
      # forces wrong callback/cookie behavior even after compose removed it.
      delete_coolify_env "$local_uuid" "OAUTH2_PROXY_REDIRECT_URL"
      set_coolify_env "$local_uuid" "OAUTH2_COOKIE_DOMAINS"   "${OAUTH2_COOKIE_DOMAINS:?OAUTH2_COOKIE_DOMAINS required}"
      set_coolify_env "$local_uuid" "OAUTH2_WHITELIST_DOMAINS" "${OAUTH2_WHITELIST_DOMAINS:?OAUTH2_WHITELIST_DOMAINS required}"

      # n8n registers the internal n8n.backend.${INTERNAL_TLD} host AND the
      # public mcp/dirigent.${PUBLIC_TLD} aliases. DNS for the aliases points
      # at the Frontend edge, whose Caddy forwards the BROWSER Host on those
      # routes — so Backend Traefik needs Host routers for the public
      # hostnames to reach n8n-auth. This is what lets oauth2-proxy scope its
      # session cookie + redirect_uri to the PUBLIC zone (backend Traefik
      # rewrites untrusted X-Forwarded-Host, so the old header_up
      # Host=internal + XFH=public strategy delivered the internal host to
      # oauth2-proxy → cookie Domain in the internal zone → browser login
      # loop on mcp.${PUBLIC_TLD}; verified in prod 2026-07-03).
      # Must match coolify-domain-doctor.mjs aisha-orchestration contract.
      step "  Domains — n8n (internal host + public mcp/dirigent aliases)"
      set_coolify_domains "$local_uuid" \
        "n8n-auth=https://${N8N_DOMAIN}:4180,https://${MCP_DOMAIN:?MCP_DOMAIN required}:4180,https://${DIRIGENT_DOMAIN:?DIRIGENT_DOMAIN required}:4180"
      ;;

    pki)
      info "Nastavuji PKI (OpenXPKI CA + OAuth2 Proxy) — KOMPLETNÍ konfigurace..."

      # ── PKI DB ─────────────────────────────────────────────────
      set_coolify_env "$local_uuid" "PKI_DB_ROOT_PASSWORD"   "${PKI_DB_ROOT_PASSWORD}"
      set_coolify_env "$local_uuid" "PKI_DB_PASSWORD"        "${PKI_DB_PASSWORD}"

      # ── PKI Vault / OIDC ───────────────────────────────────────
      # PKI_SVAULT_KEY: symmetric vault master (datapool encryption).
      # PKI_DEFAULT_SECRET: encrypts issuer private keys (vault + per-realm
      # rootca). Both are CRITICAL — losing either invalidates the PKI.
      set_coolify_env "$local_uuid" "PKI_SVAULT_KEY"         "${PKI_SVAULT_KEY}"
      set_coolify_env "$local_uuid" "PKI_DEFAULT_SECRET"     "${PKI_DEFAULT_SECRET}"
      set_coolify_env "$local_uuid" "OPENXPKI_RPC_HMAC"      "${OPENXPKI_RPC_HMAC}"
      set_coolify_env "$local_uuid" "PKI_OIDC_SECRET"        "${PKI_OIDC_SECRET}"
      set_coolify_env "$local_uuid" "PKI_COOKIE_SECRET"      "${PKI_COOKIE_SECRET}"
      set_coolify_env_if "$local_uuid" "PKI_CLIENT_KEY_B64"  "${PKI_CLIENT_KEY_B64:-}"

      # ── OIDC / Keycloak ────────────────────────────────────────
      set_coolify_env "$local_uuid" "KEYCLOAK_DOMAIN"        "${KEYCLOAK_DOMAIN}"
      set_coolify_env "$local_uuid" "PKI_DOMAIN"             "${PKI_DOMAIN}"

      # ── PKI bootstrap creds (used by pki-bridge to authenticate ROPC
      #    cert-issuance requests via aisha-pki-bootstrap KC client).
      #    Provisioned by aisha-bootstrap-user-init.sh in Phase B; must
      #    be propagated to the aisha-pki Coolify env or pki-bridge can't
      #    issue certs (no creds → fall back to self-signed).
      set_coolify_env_if "$local_uuid" "AISHA_PKI_BOOTSTRAP_CLIENT_SECRET" "${AISHA_PKI_BOOTSTRAP_CLIENT_SECRET:-}"
      set_coolify_env_if "$local_uuid" "AISHA_PKI_BOOTSTRAP_PASSWORD"      "${AISHA_PKI_BOOTSTRAP_PASSWORD:-}"

      # ── Domains (Coolify Traefik routing) ──────────────────────
      step "  Domains — pki"
      set_coolify_domains "$local_uuid" \
        "pki-auth=https://${PKI_DOMAIN}:4180" \
        "pki-bridge=https://${PKI_BRIDGE_DOMAIN}:3040"
      ;;

    ledger)
      info "Nastavuji Ledger (Cosmos SDK Chain) — KOMPLETNÍ konfigurace..."

      set_coolify_env "$local_uuid" "CHAIN_ID"                   "${CHAIN_ID}"
      set_coolify_env "$local_uuid" "MONIKER"                    "${MONIKER}"
      set_coolify_env_if "$local_uuid" "COSMOS_SIGNER_MNEMONIC"  "${COSMOS_SIGNER_MNEMONIC:-}"
      set_coolify_env "$local_uuid" "NETBIRD_DOMAIN"             "${NETBIRD_DOMAIN}"
      set_coolify_env_if "$local_uuid" "NETBIRD_STACK_KEY_EXPERIMENTAL" "${NETBIRD_STACK_KEY_EXPERIMENTAL:-}"

      # No domains — Experimental ledger is internal-only.
      ;;

    exec)
      info "Nastavuji Exec (isolated runner) — KOMPLETNÍ konfigurace..."

      set_coolify_env "$local_uuid" "KEYCLOAK_REALM"                  "${KEYCLOAK_REALM}"
      set_coolify_env "$local_uuid" "KEYCLOAK_URL"                    "${KEYCLOAK_URL}"
      set_coolify_env "$local_uuid" "PLUGIN_SYSTEM_URL"               "${PLUGIN_SYSTEM_URL}"
      set_coolify_env "$local_uuid" "PLUGIN_BROKER_URL"               "${PLUGIN_BROKER_URL}"
      set_coolify_env "$local_uuid" "BROKER_TOKEN_SECRET"             "${BROKER_TOKEN_SECRET}"
      set_coolify_env "$local_uuid" "KATA_DEFAULT_RUNTIME"            "${KATA_DEFAULT_RUNTIME}"
      # Pověření ke správě mesh sítě (NETBIRD_MGMT_SECRET, API token) runner NEDOSTÁVÁ:
      # klíč běhu se nerazí (2026-10-06, majitel „síť zavřít“ = volba A).
      # AISHA_DB_URL runner nedostává: do DB jde přes PostgREST (compose exec ho nečte).
      set_coolify_env "$local_uuid" "POSTGREST_URL"                   "${POSTGREST_URL}"
      set_coolify_env "$local_uuid" "POSTGREST_SERVICE_TOKEN"         "${POSTGREST_SERVICE_TOKEN}"

      # No domains — Experimental exec runner is internal-only.
      ;;

    matrix|messaging)
      info "Nastavuji Matrix (Synapse + Element) — KOMPLETNÍ konfigurace..."

      # ── Synapse ────────────────────────────────────────────────
      set_coolify_env "$local_uuid" "SYNAPSE_SERVER_NAME"         "${SYNAPSE_SERVER_NAME:?SYNAPSE_SERVER_NAME required}"
      set_coolify_env "$local_uuid" "SYNAPSE_DB_PASSWORD"         "${SYNAPSE_DB_PASSWORD}"
      set_coolify_env "$local_uuid" "SYNAPSE_OIDC_CLIENT_SECRET"  "${SYNAPSE_OIDC_CLIENT_SECRET}"
      set_coolify_env "$local_uuid" "SYNAPSE_REGISTRATION_SECRET" "${MATRIX_REGISTRATION_SHARED_SECRET}"
      set_coolify_env "$local_uuid" "SYNAPSE_MACAROON_SECRET"     "${MATRIX_MACAROON_SECRET_KEY}"
      set_coolify_env "$local_uuid" "SYNAPSE_FORM_SECRET"         "${MATRIX_FORM_SECRET}"

      # ── Shared DB / Keycloak ──────────────────────────────────
      set_coolify_env "$local_uuid" "POSTGRES_PASSWORD"           "${POSTGRES_PASSWORD}"
      set_coolify_env "$local_uuid" "KEYCLOAK_DOMAIN"             "${KEYCLOAK_DOMAIN}"

      # ── LiveKit bridge ─────────────────────────────────────────
      set_coolify_env "$local_uuid" "LIVEKIT_API_KEY"             "${LIVEKIT_API_KEY}"
      set_coolify_env "$local_uuid" "LIVEKIT_API_SECRET"          "${LIVEKIT_API_SECRET}"
      set_coolify_env "$local_uuid" "LIVEKIT_DOMAIN"              "${LIVEKIT_DOMAIN}"
      set_coolify_env "$local_uuid" "MATRIX_DOMAIN"               "${MATRIX_DOMAIN}"
      set_coolify_env "$local_uuid" "ELEMENT_DOMAIN"              "${ELEMENT_DOMAIN}"
      set_coolify_env "$local_uuid" "ELEMENT_CALL_DOMAIN"         "${ELEMENT_CALL_DOMAIN}"
      set_coolify_env "$local_uuid" "MATRIX_WEBHOOK_URL"           "${MATRIX_WEBHOOK_URL}"
      set_coolify_env_if "$local_uuid" "TELEGRAM_API_ID"           "${TELEGRAM_API_ID:-}"
      set_coolify_env_if "$local_uuid" "TELEGRAM_API_HASH"         "${TELEGRAM_API_HASH:-}"
      set_coolify_env_if "$local_uuid" "TELEGRAM_BOT_TOKEN"        "${TELEGRAM_BOT_TOKEN:-}"

      matrix_bridge_profiles="${MATRIX_BRIDGE_PROFILES:-}"
      if [[ -z "$matrix_bridge_profiles" && -n "${TELEGRAM_API_ID:-}" && -n "${TELEGRAM_API_HASH:-}" ]]; then
        matrix_bridge_profiles="bridge-telegram"
      fi
      set_coolify_env "$local_uuid" "MATRIX_BRIDGE_PROFILES" "${matrix_bridge_profiles}"
      matrix_bridge_profiles="$(mesh_profile_merge "${matrix_bridge_profiles}")"
      set_coolify_env "$local_uuid" "COMPOSE_PROFILES"       "${matrix_bridge_profiles}"

      step "  Domains — matrix"
      set_coolify_domains "$local_uuid" \
        "synapse=https://${MATRIX_DOMAIN}:8008" \
        "element-web=https://${ELEMENT_DOMAIN}:80" \
        "element-call=https://${ELEMENT_CALL_DOMAIN}:8080"
      ;;

    keycloak)
      info "Nastavuji Keycloak (OIDC Identity Provider) — KOMPLETNÍ konfigurace..."

      set_coolify_env_if "$local_uuid" "KEYCLOAK_DB_PASSWORD" "${KEYCLOAK_DB_PASSWORD:-}"
      set_coolify_env_if "$local_uuid" "KEYCLOAK_ADMIN"          "${KEYCLOAK_ADMIN:-admin}"
      set_coolify_env_if "$local_uuid" "KEYCLOAK_ADMIN_PASSWORD" "${KEYCLOAK_ADMIN_PASSWORD:-}"
      set_coolify_env "$local_uuid" "KEYCLOAK_DOMAIN"            "${KEYCLOAK_DOMAIN}"

      # ── Blue/Green slot (legacy env vars, kept for back-compat) ──
      set_coolify_env "$local_uuid" "BG_ACTIVE_HOST" "${BG_ACTIVE_HOST:-${KEYCLOAK_DOMAIN}}"
      set_coolify_env "$local_uuid" "BG_SLOT"        "${BG_SLOT:-blue}"

      # Routing via docker_compose_domains (authoritative) — compose Traefik
      # labels carry ${VAR} placeholders which are correct as templates but
      # Coolify escapes every $ → $$ in label values at deploy time, making
      # ${KEYCLOAK_DOMAIN} a literal string in the running container.
      # set_coolify_domains() uses retry + force_domain_override and is the
      # only reliable path for Coolify v4. See feedback_coolify_label_dollar_escape.md.
      #
      # ONLY the internal direct host (auth.backend.${INTERNAL_TLD}) is
      # registered here. KC runs on Backend; the public auth.${PUBLIC_TLD}
      # hostname is served by edge-proxy (Frontend) which reverse-proxies to
      # this internal host. Server-to-server OIDC from sibling containers
      # (dozzle-auth, grafana-auth, svc-matrix) reaches KC via the public
      # hostname through edge-proxy, or directly via the internal host.
      step "  Domains — keycloak"
      # KEYCLOAK_DOMAIN_DIRECT = the mesh-INDEPENDENT backend host. Under
      # MESH_ENABLED=true KEYCLOAK_DOMAIN is mesh-overlaid (auth.mesh.<tld>), which
      # gave KC a Traefik router only for the mesh host → auth.backend.<tld> (edge
      # upstream) + auth.<public> (edge face) both 404 (incident 2026-07-16). Register
      # the direct backend host KC's own Traefik actually serves; = KEYCLOAK_DOMAIN
      # when mesh is off.
      set_coolify_domains "$local_uuid" \
        "keycloak=https://${KEYCLOAK_DOMAIN_DIRECT:-${KEYCLOAK_DOMAIN}}:80"
      ;;

    livekit)
      info "Nastavuji LiveKit (Voice/Video) — KOMPLETNÍ konfigurace..."

      set_coolify_env "$local_uuid" "LIVEKIT_API_KEY"    "${LIVEKIT_API_KEY}"
      set_coolify_env "$local_uuid" "LIVEKIT_API_SECRET" "${LIVEKIT_API_SECRET}"
      set_coolify_env "$local_uuid" "LIVEKIT_DOMAIN"     "${LIVEKIT_DOMAIN}"
      set_coolify_env_if "$local_uuid" "TURN_STATIC_SECRET" "${TURN_STATIC_SECRET:-}"
      set_coolify_env_if "$local_uuid" "TURN_DOMAIN"        "${TURN_DOMAIN:-}"

      step "  Domains — livekit"
      set_coolify_domains "$local_uuid" \
        "livekit=https://${LIVEKIT_DOMAIN}:7880"
      ;;

    netbird)
      info "Nastavuji NetBird (mesh VPN control plane) — KOMPLETNÍ konfigurace..."

      # ── Mesh domain + OIDC client ─────────────────────────────
      set_coolify_env "$local_uuid" "NETBIRD_DOMAIN"           "${NETBIRD_DOMAIN}"
      set_coolify_env "$local_uuid" "NETBIRD_OIDC_CLIENT_ID"   "${NETBIRD_OIDC_CLIENT_ID}"
      set_coolify_env "$local_uuid" "NETBIRD_OIDC_SECRET"      "${NETBIRD_OIDC_SECRET}"

      # ── IDP user sync (Keycloak service account) ──────────────
      set_coolify_env "$local_uuid" "NETBIRD_MGMT_SECRET"      "${NETBIRD_MGMT_SECRET}"

      # ── Relay auth (shared mgmt + relay) ──────────────────────
      set_coolify_env "$local_uuid" "NETBIRD_RELAY_SECRET"     "${NETBIRD_RELAY_SECRET}"

      # ── DataStoreEncryptionKey (must be standard base64) ─────
      set_coolify_env "$local_uuid" "NETBIRD_DATASTORE_ENC_KEY" "${NETBIRD_DATASTORE_ENC_KEY}"

      # ── PostgreSQL backend (self-contained netbird-db) ────────
      set_coolify_env "$local_uuid" "NETBIRD_DB_PASSWORD"      "${NETBIRD_DB_PASSWORD}"

      # ── TURN relay credentials ────────────────────────────────
      set_coolify_env "$local_uuid" "NETBIRD_TURN_USERNAME"    "${NETBIRD_TURN_USERNAME}"
      set_coolify_env "$local_uuid" "NETBIRD_TURN_PASSWORD"    "${NETBIRD_TURN_PASSWORD}"
      set_coolify_env "$local_uuid" "TURN_REALM"               "${TURN_REALM:?TURN_REALM required (e.g. \$TURN_DOMAIN)}"
      set_coolify_env "$local_uuid" "NETBIRD_API_URL"          "${NETBIRD_API_URL}"
      set_coolify_env "$local_uuid" "NETBIRD_AUTH_SCHEME"      "${NETBIRD_AUTH_SCHEME}"
      set_coolify_env "$local_uuid" "NETBIRD_SANDBOX_GROUP"    "${NETBIRD_SANDBOX_GROUP}"

      # ── OIDC authority (Keycloak) ─────────────────────────────
      set_coolify_env "$local_uuid" "KEYCLOAK_DOMAIN"          "${KEYCLOAK_DOMAIN}"
      # PŘÍMÁ tvář — pro `pki-init`, který běží uvnitř clusteru ZA BOOTSTRAPU.
      # Mesh tvář (KEYCLOAK_DOMAIN) tehdy ještě neexistuje a veřejnou obsluhuje
      # edge, který čeká na mesh IP z certifikátu, jejž má pki-init teprve vydat.
      # Compose ji proto vyžaduje jako `${KEYCLOAK_DOMAIN_DIRECT:?}` — a bez
      # tohohle řádku by se nedoručila a nasazení by spadlo na nesplnitelné
      # podmínce. Naměřeno 2026-08-14: živá aplikace aisha-netbird měla 39
      # proměnných a tuhle mezi nimi ne.
      set_coolify_env "$local_uuid" "KEYCLOAK_DOMAIN_DIRECT"   "${KEYCLOAK_DOMAIN_DIRECT:?KEYCLOAK_DOMAIN_DIRECT required — pki-init potřebuje přímou tvář Keycloaku (auth.backend.<internal-tld>); topologie ji emituje}"

      # ── PKI bootstrap creds (used by frontend--netbird--pki-init to issue
      #    internal-tls cert via aisha-pki-bridge ROPC flow). Without
      #    these the pki-init step falls back to a self-signed bootstrap
      #    cert and netbird-internal-tls warns "Agents will FAIL TLS
      #    verify" (visible in deployment logs). Provisioned by
      #    scripts/aisha-bootstrap-user-init.sh during Phase B; persisted
      #    to .env.coolify; deploy-init MUST propagate them onto the
      #    aisha-netbird app's Coolify env (otherwise compose default
      #    is empty string).
      set_coolify_env_if "$local_uuid" "AISHA_PKI_BOOTSTRAP_CLIENT_SECRET" "${AISHA_PKI_BOOTSTRAP_CLIENT_SECRET:-}"
      set_coolify_env_if "$local_uuid" "AISHA_PKI_BOOTSTRAP_PASSWORD"      "${AISHA_PKI_BOOTSTRAP_PASSWORD:-}"
      # ── AISHA bootstrap creds (NetBird account ownership claim by
      #    netbird-bootstrap.sh — first request creates account, owner =
      #    real KC user instead of service-account-netbird-backend so
      #    IDP user-sync resolves the owner UUID).
      set_coolify_env_if "$local_uuid" "AISHA_BOOTSTRAP_CLIENT_SECRET"     "${AISHA_BOOTSTRAP_CLIENT_SECRET:-}"
      set_coolify_env_if "$local_uuid" "AISHA_BOOTSTRAP_PASSWORD"          "${AISHA_BOOTSTRAP_PASSWORD:-}"

      # ── Domains (Coolify Traefik routing) ─────────────────────
      # aisha-netbird: the HTTP surface (dashboard, /api, /relay) routes
      # through the netbird-proxy Caddy demux — register the real domain on
      # that service (Coolify auto-gen Host router, port 80 from EXPOSE).
      # gRPC rides the same tenant-specific Host router into netbird-proxy;
      # Caddy then demultiplexes protobuf paths over h2c. A host-less router
      # would match every tenant on the shared ingress.
      # Must match coolify-domain-doctor.mjs contract.
      step "  Domains — netbird (netbird-proxy)"
      # ⛔ JEN PŘÍMÁ TVÁŘ (naměřeno 2026-09-16). Veřejné `netbird.<public-tld>`
      # posílá pfSense na uzel s edge; registrované tady dávalo router tam, kam
      # provoz nedorazí — veřejně 404 a Traefik s „TRAEFIK DEFAULT CERT" (ACME
      # výzva přistála jinde). Veřejnou tvář obsluhuje edge → přímá tvář.
      #
      # Přímá tvář je POVINNÁ (2026-08-29): bez ní nemá management dosažitelné
      # jméno pro edge ani operátorské nástroje — discovery nenajde peery, mesh
      # DNS zůstane prázdné a edge nepřeloží `<prefix>-api.mesh.…` → api 502.
      set_coolify_domains "$local_uuid" \
        "netbird-proxy=https://${NETBIRD_DOMAIN_DIRECT:?NETBIRD_DOMAIN_DIRECT chybí — derivace ji vydává pro každý profil s netbirdem}"
      ;;

    registry)
      # ── Pull-through Docker Hub cache ─────────────────────────
      # Volitelný PAT pro autentizovaný limit (200/6h místo 100/6h).
      set_coolify_env "$local_uuid" "REGISTRY_PROXY_USERNAME"  "${REGISTRY_PROXY_USERNAME:-}"
      set_coolify_env "$local_uuid" "REGISTRY_PROXY_PASSWORD"  "${REGISTRY_PROXY_PASSWORD:-}"
      set_coolify_env "$local_uuid" "REGISTRY_DOMAIN"          "${REGISTRY_DOMAIN:?REGISTRY_DOMAIN required}"

      step "  Domains — registry"
      set_coolify_domains "$local_uuid" \
        "registry-cache=https://${REGISTRY_DOMAIN}:5000"
      ;;

    llm-gateway)
      info "Nastavuji LLM Gateway — KOMPLETNÍ konfigurace..."

      set_coolify_env_if "$local_uuid" "GATEWAY_DOMAIN"            "${GATEWAY_DOMAIN:-}"
      set_coolify_env_if "$local_uuid" "ANTHROPIC_API_KEY"         "${ANTHROPIC_API_KEY:-}"
      set_coolify_env_if "$local_uuid" "OPENAI_API_KEY"            "${OPENAI_API_KEY:-}"
      set_coolify_env_if "$local_uuid" "KEYCLOAK_DOMAIN"           "${KEYCLOAK_DOMAIN:-}"

      step "  Domains — llm-gateway"
      set_coolify_domains "$local_uuid" \
        "llm-gateway=https://${GATEWAY_DOMAIN}:4000"
      ;;

    realtime)
      info "Nastavuji Realtime (WebSocket fabric)..."
      step "  Domains — realtime"
      set_coolify_domains "$local_uuid" \
        "ws-gateway=https://${LIVE_DOMAIN:?LIVE_DOMAIN required}:3002"
      ;;

    observability-stack)
      info "Nastavuji Observability Stack (Grafana + Loki + Prometheus) — KOMPLETNÍ konfigurace..."

      set_coolify_env_if "$local_uuid" "GRAFANA_DOMAIN"            "${GRAFANA_DOMAIN:-}"
      set_coolify_env_if "$local_uuid" "MINIO_ROOT_USER"           "${MINIO_ROOT_USER:-}"
      set_coolify_env_if "$local_uuid" "MINIO_ROOT_PASSWORD"       "${MINIO_ROOT_PASSWORD:-}"
      set_coolify_env_if "$local_uuid" "KEYCLOAK_DOMAIN"           "${KEYCLOAK_DOMAIN:-}"
      set_coolify_env_if "$local_uuid" "KEYCLOAK_DOMAIN_PUBLIC"    "${KEYCLOAK_DOMAIN_PUBLIC:-}"
      set_coolify_env_if "$local_uuid" "KEYCLOAK_REALM"            "${KEYCLOAK_REALM:-}"
      set_coolify_env_if "$local_uuid" "STUDIO_OIDC_SECRET"        "${STUDIO_OIDC_SECRET:-}"
      set_coolify_env_if "$local_uuid" "STUDIO_COOKIE_SECRET"      "${STUDIO_COOKIE_SECRET:-}"
      set_coolify_env_if "$local_uuid" "GRAFANA_ADMIN_PASSWORD"    "${GRAFANA_ADMIN_PASSWORD:-}"
      set_coolify_env_if "$local_uuid" "OIDC_CLIENT_PREFIX"        "${OIDC_CLIENT_PREFIX:-}"

      if [ -n "${GRAFANA_DOMAIN:-}" ]; then
        step "  Domains — observability-stack"
        set_coolify_domains "$local_uuid" \
          "grafana-auth=https://${GRAFANA_DOMAIN}:4181"
      else
        info "Grafana domain is not configured for this profile — direct route skipped"
      fi
      ;;

    domain-services)
      # ⛔ NAMĚŘENO 2026-08-27: `svc-money` má v compose `profiles: ["money"]`,
      # takže se BEZ AKTIVNÍHO PROFILU vůbec nespustí. A `COMPOSE_PROFILES`
      # compose nikde NEREFERENCUJE — spotřebuje ho sám docker compose — takže
      # ho per-app filtr `coolify-sync-envs.sh` (compose-ref ∩ SoT) NIKDY
      # nepošle. Právě proto ho edge i matrix nastavují výslovně tady;
      # domain-services byl jediný stack s profilem, který takový blok NEMĚL.
      #
      # Důsledek se hledal špatně: tunel do Money nevznikl, dodací listy neměl
      # kdo stáhnout, a v logu nebyla ani zmínka o VPN — protože není co
      # logovat, když služba neběží. Vypadalo to jako vada tunelu.
      #
      # Odvození týmž idiomem jako u matrixových můstků: výslovná deklarace
      # vyhrává, jinak profil zapne PŘÍTOMNOST pověření, která služba
      # potřebuje. Prázdno zůstane prázdnem — instance bez Money profil nechce.
      domain_services_profiles="${DOMAIN_SERVICES_PROFILES:-}"
      if [[ -z "$domain_services_profiles" && -n "${MONEY_AGENDAS:-}" && -n "${MONEY_HOST:-}" ]]; then
        domain_services_profiles="money"
      fi
      set_coolify_env "$local_uuid" "DOMAIN_SERVICES_PROFILES" "${domain_services_profiles}"
      domain_services_profiles="$(mesh_profile_merge "${domain_services_profiles}")"
      set_coolify_env "$local_uuid" "COMPOSE_PROFILES"         "${domain_services_profiles}"
      ;;

    source-broker)
      info "Nastavuji Source Broker (federace externího source-api) — KOMPLETNÍ konfigurace..."

      # Env is also delivered by coolify-sync-envs (compose-ref ∩ .env.coolify);
      # push connection + mantra explicitly too (belt-and-suspenders, and a
      # missing operator secret surfaces here). Values come from .env.coolify
      # (aisha-cold-start emits POSTGRES_URL/handshake/story id) or the operator's
      # .env-prod-backup (SOURCE_API_URL/SOURCE_PG_URL). _if skips empty values.
      set_coolify_env_if "$local_uuid" "POSTGRES_URL"               "${POSTGRES_URL:-}"
      set_coolify_env_if "$local_uuid" "POSTGREST_URL"              "${POSTGREST_URL:-}"
      set_coolify_env_if "$local_uuid" "SERVICE_ROLE_KEY"           "${SERVICE_ROLE_KEY:-}"
      set_coolify_env_if "$local_uuid" "JWT_SECRET"                 "${JWT_SECRET:-}"
      set_coolify_env_if "$local_uuid" "INTRANET_API_KEY"           "${INTRANET_API_KEY:-}"
      set_coolify_env_if "$local_uuid" "SOURCE_WEBHOOK_HMAC_SECRET" "${SOURCE_WEBHOOK_HMAC_SECRET:-}"
      set_coolify_env_if "$local_uuid" "FEDERATION_VAULT_KEY"       "${FEDERATION_VAULT_KEY:-}"
      set_coolify_env_if "$local_uuid" "SOURCE_API_URL"            "${SOURCE_API_URL:-}"
      set_coolify_env_if "$local_uuid" "SOURCE_PG_URL"             "${SOURCE_PG_URL:-}"
      set_coolify_env_if "$local_uuid" "KEYCLOAK_REALM"            "${KEYCLOAK_REALM:-}"
      set_coolify_env_if "$local_uuid" "KEYCLOAK_INTERNAL_URL"     "${KEYCLOAK_INTERNAL_URL:-}"
      set_coolify_env_if "$local_uuid" "AISHA_GATEWAY_URL"         "${AISHA_GATEWAY_URL:-}"
      set_coolify_env_if "$local_uuid" "SOURCE_ADAPTER_STORY_ID"   "${SOURCE_ADAPTER_STORY_ID:-}"
      set_coolify_env_if "$local_uuid" "SOURCE_AUTH_HANDSHAKE_OUT" "${SOURCE_AUTH_HANDSHAKE_OUT:-}"
      set_coolify_env_if "$local_uuid" "SOURCE_AUTH_HANDSHAKE_IN"  "${SOURCE_AUTH_HANDSHAKE_IN:-}"

      # Drop lane nemá žádnou env ani hostitelskou cestu: od 04387f3d6 je drop
      # svazek `ingest-out` UVNITŘ stacku local-ingest (engine píše, sidecar
      # ingest-drop-push čte) a mezi stroji ho veze bucket. Doslovná
      # /srv/aisha/drop/local-ingest (a `drop-init`, který ji jen chmodoval) byla
      # pozůstatek, který sdílela každá instance na stroji — odstraněno 2026-09-23.
      info "  drop lane = svazek ingest-out uvnitř stacku, mezi stroji bucket (bez hostitelské cesty)"

      step "  Domains — source-broker"
      set_coolify_domains "$local_uuid" \
        "source-broker=https://${BROKER_DOMAIN}:8090"
      ;;
  esac

  ok "Stack '${stack}' — env vars hotovo"
done

# ══════════════════════════════════════════════════════════════════════════════
# BUILDTIME REGISTRY CREDS — push VERDACCIO_URL / VERDACCIO_TOKEN to EVERY app
# ══════════════════════════════════════════════════════════════════════════════
# 18 service Dockerfiles (svc-matrix, svc-openclaw, svc-agent-runner, …) declare
#   ARG VERDACCIO_URL=""
#   RUN printf '@aisha:registry=%s\n…' "${VERDACCIO_URL:?VERDACCIO_URL required…}" …
# so `npm install` can fetch @aisha/* from the private registry at BUILD time.
# Their compose build.args pass `${VERDACCIO_URL:-}` (empty default), so unless
# the value is in the app's Coolify env, `docker build` gets "" and the `:?`
# hard-require ABORTS the build (exit 2) — the aisha-messaging svc-matrix
# failure on Giah. The per-stack loop above set functional/runtime env but
# never these two; the NORMALIZE step below only flips the is_buildtime bit and
# explicitly assumes the VALUES are already pushed (they weren't). Push them
# here, marked buildtime (4th arg = "true"), to EVERY selected stack: harmless
# on apps that don't build @aisha/* deps, and robust the moment a new service
# adds one. VERDACCIO_TOKEN may be empty for public-only installs (→ _if skips).
if [ -z "${VERDACCIO_URL:-}" ]; then
  warn "VERDACCIO_URL is empty — every @aisha/*-consuming image BUILD will fail (\${VERDACCIO_URL:?}). Set it in the operator env / .env.coolify before deploying buildable stacks."
fi
step "Buildtime registry creds (VERDACCIO_URL / VERDACCIO_TOKEN) — all apps"
for stack in $SELECTED_STACKS; do
  uuid=$(get_stack_uuid "$stack")
  [ -z "$uuid" ] && continue
  set_coolify_env_if "$uuid" "VERDACCIO_URL"   "${VERDACCIO_URL:-}"   "true"
  set_coolify_env_if "$uuid" "VERDACCIO_TOKEN" "${VERDACCIO_TOKEN:-}" "true"
done

# ══════════════════════════════════════════════════════════════════════════════
# NORMALIZE BUILDTIME ENV FLAGS
# ══════════════════════════════════════════════════════════════════════════════

if [ "$NORMALIZE_BUILDTIME" = "1" ]; then
  step "Buildtime env flags"

  buildtime_failed_apps=""

  for stack in $SELECTED_STACKS; do
    uuid=$(get_stack_uuid "$stack")
    [ -z "$uuid" ] && continue
    app_name="$(stack_app_name "$stack")"
    info "Normalizuji ${app_name} (${uuid})"
    # Buildtime metadata refresh is COSMETIC for already-deployed apps:
    # env VALUES are already in place (set via prior bulk PATCH in the
    # per-stack loop above). Only the is_buildtime metadata bit may
    # need flipping. A transient Coolify API hiccup (timeout, 5xx) here
    # must NOT abort cold-start — the next sync run will retry. Wrap
    # in `|| ...` to capture failure without errexit-aborting.
    if ! coolify_normalize_buildtime_envs "${COOLIFY_URL}/api/v1" "$COOLIFY_API_TOKEN" "$uuid" "$app_name" "$DRY_RUN"; then
      warn "  buildtime normalize failed for ${app_name} — will be retried on next deploy-init run"
      buildtime_failed_apps="${buildtime_failed_apps:+${buildtime_failed_apps} }${app_name}"
    fi
  done
  if [ -n "$buildtime_failed_apps" ]; then
    warn "Buildtime metadata normalization failed for: ${buildtime_failed_apps}"
    warn "  These are cosmetic failures — env values were synced; only is_buildtime bit may be stale."
    warn "  Diagnose: bash scripts/coolify-deploy-init.sh --skip-domains (interactive)"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# SET BUILD SERVER (--set-build-server flag)
# ══════════════════════════════════════════════════════════════════════════════

if [ "$SET_BUILD_SERVER" = "1" ]; then
  step "use_build_server — Setting all apps to build on Build"

  for stack in $ALL_STACKS; do
    uuid=$(get_stack_uuid "$stack")
    if [ -z "$uuid" ]; then
      continue
    fi

    label=$(stack_label "$stack")

    if [ "$DRY_RUN" = "1" ]; then
      info "[DRY RUN] ${label}: use_build_server=true"
    else
      result=$(curl -s -X PATCH "${COOLIFY_URL}/api/v1/applications/${uuid}" \
        -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"settings": {"use_build_server": true}}' 2>/dev/null || echo '{"error": true}')

      if echo "$result" | jq -e '.uuid' &>/dev/null 2>&1; then
        ok "  ${label} — use_build_server=true"
      else
        # Coolify v4 Compose-based apps don't support build_server setting—
        # the API returns "Validation failed". This is expected and harmless;
        # compose stacks always build on their assigned server.
        # `|| echo unknown`: under `set -euo pipefail`, a non-JSON PATCH body
        # (Coolify 500 HTML / empty 200 with curl exit 0 → the `|| echo '{...}'`
        # above never fires) makes jq exit non-zero; pipefail propagates it into
        # this assignment and set -e then ABORTS THE WHOLE SCRIPT SILENTLY — the
        # 2>/dev/null hides jq's error, so there is no diagnostic. use_build_server
        # is a best-effort optimization (see note above); one app's odd response
        # must degrade to a warn, never take down the cold-start before the waves.
        msg=$(echo "$result" | jq -r '.message // "unknown"' 2>/dev/null || echo "unknown")
        if [ "$msg" = "Validation failed." ] || [ "$msg" = "Validation failed" ]; then
          info "  ${label} — use_build_server: N/A (compose app, skipped)"
        else
          warn "  ${label} — use_build_server failed: $msg"
        fi
      fi
    fi
  done
fi

# ══════════════════════════════════════════════════════════════════════════════
# WEBHOOK SETUP (pouze pro Web stack — CI/CD z Forgejo)
# ══════════════════════════════════════════════════════════════════════════════

# ⛔ ADRESA WEBHOOKU JE MUTACE ODLOŽENÁ NA CIZÍ RUKU (2026-10-04): kdo ji zavolá,
# aplikaci nasadí — bez ohledu na to, kdo ji složil. Vydává ji proto jediný domov
# mutace (lib/coolify-mutace.mjs, akce `webhook`), který se před tím zeptá na
# držení: DRŽENÉ aplikaci se webhook NEZAKLÁDÁ ani nevrací (ani ten, který nabízí
# Coolify sám), a secret v repu se pro ni nenastavuje.
WEBHOOK_URL=""
WEBHOOK_SESTAVENY=""
WEBHOOK_DRZENO=0
if [ -n "$UUID_WEB" ]; then
  _wh_rc=0
  WEBHOOK_SESTAVENY=$(export COOLIFY_URL
    coolify_mutace webhook "$(stack_app_name web)" "$UUID_WEB" --kdo coolify-deploy-init \
      --prefix "$(require_instance_prefix)" --env-soubor "$DEPLOY_ENV_SOUBOR") || _wh_rc=$?
  if [ "$_wh_rc" -eq "$COOLIFY_MUTACE_DRZENO" ]; then
    WEBHOOK_DRZENO=1
    warn "${WEBHOOK_SESTAVENY}. Webhook nasazení se NEZAKLÁDÁ ani nevrací."
  elif [ "$_wh_rc" -ne 0 ]; then
    err "Adresu webhooku nasazení nejde vydat (coolify-mutace kód ${_wh_rc}, důvod výš) — končím dřív, než ji kdokoli dostane."
    exit 1
  fi
  unset _wh_rc
fi
if [ -n "$UUID_WEB" ] && [ "$WEBHOOK_DRZENO" = "0" ]; then
  step "Webhook — Web CI/CD pipeline"

  APP_DETAILS=$(coolify_api GET "/applications/${UUID_WEB}" 2>/dev/null || echo '{}')

  WEBHOOK_URL=$(echo "$APP_DETAILS" | jq -r '.webhook_url // .settings.webhook_url // empty' 2>/dev/null || true)

  if [ -z "$WEBHOOK_URL" ]; then
    WEBHOOK_URL="$WEBHOOK_SESTAVENY"
    info "Webhook URL sestaven z UUID: ${WEBHOOK_URL}"
  else
    ok "Webhook URL z API: ${WEBHOOK_URL}"
  fi

  # Test webhook reachability
  info "Testuji webhook dostupnost..."
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 \
    -X GET "${COOLIFY_URL}/api/v1/applications/${UUID_WEB}" \
    -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
    -H "Accept: application/json" 2>/dev/null || true)

  if [ "$HTTP_CODE" -ge 200 ] 2>/dev/null && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
    ok "Coolify Web app dostupná (HTTP ${HTTP_CODE})"
  else
    warn "Coolify Web app vrátila HTTP ${HTTP_CODE} — zkontroluj UUID"
  fi

  # Set Forgejo secret
  if [ -n "$WEBHOOK_URL" ]; then
    step "Forgejo secret — COOLIFY_WEBHOOK_URL"

    if [ "$DRY_RUN" = "1" ]; then
      info "[DRY RUN] would set Forgejo secret COOLIFY_WEBHOOK_URL (value redacted)"
    else
      info "Nastavuji secret v Forgejo repo: ${FORGEJO_OWNER}/${FORGEJO_REPO}"

      SECRET_PAYLOAD=$(jq -n --arg data "$WEBHOOK_URL" '{ data: $data }')

      SECRET_RESULT=$(forgejo_api PUT \
        "/repos/${FORGEJO_OWNER}/${FORGEJO_REPO}/actions/secrets/COOLIFY_WEBHOOK_URL" \
        "$SECRET_PAYLOAD" 2>/dev/null || echo '{"error": true}')

      MSG=$(echo "$SECRET_RESULT" | jq -r '.message // empty' 2>/dev/null || true)
      if [ -z "$MSG" ] || [ "$MSG" = "null" ]; then
        ok "COOLIFY_WEBHOOK_URL secret nastaven v Forgejo"
      else
        err "Chyba při nastavení Forgejo secret: ${MSG}"
        info "Nastav manuálně: ${FORGEJO_URL}/${FORGEJO_OWNER}/${FORGEJO_REPO}/settings/actions/secrets"
      fi
    fi
  fi

  # Set Forgejo COOLIFY_TOKEN secret (auth for Coolify webhook)
  if [ -n "$COOLIFY_API_TOKEN" ]; then
    step "Forgejo secret — COOLIFY_TOKEN"

    if [ "$DRY_RUN" = "1" ]; then
      info "[DRY RUN] would set Forgejo secret COOLIFY_TOKEN (value redacted)"
    else
      info "Nastavuji COOLIFY_TOKEN secret v Forgejo repo: ${FORGEJO_OWNER}/${FORGEJO_REPO}"

      TOKEN_PAYLOAD=$(jq -n --arg data "$COOLIFY_API_TOKEN" '{ data: $data }')

      TOKEN_RESULT=$(forgejo_api PUT \
        "/repos/${FORGEJO_OWNER}/${FORGEJO_REPO}/actions/secrets/COOLIFY_TOKEN" \
        "$TOKEN_PAYLOAD" 2>/dev/null || echo '{"error": true}')

      TOKEN_MSG=$(echo "$TOKEN_RESULT" | jq -r '.message // empty' 2>/dev/null || true)
      if [ -z "$TOKEN_MSG" ] || [ "$TOKEN_MSG" = "null" ]; then
        ok "COOLIFY_TOKEN secret nastaven v Forgejo"
      else
        err "Chyba při nastavení COOLIFY_TOKEN Forgejo secret: ${TOKEN_MSG}"
        info "Nastav manuálně: ${FORGEJO_URL}/${FORGEJO_OWNER}/${FORGEJO_REPO}/settings/actions/secrets"
      fi
    fi
  fi
else
  if echo "$SELECTED_STACKS" | grep -qw "web"; then
    warn "Webhook URL není znám — web stack nemá UUID"
    info "Nastav COOLIFY_WEBHOOK_URL manuálně: ${FORGEJO_URL}/${FORGEJO_OWNER}/${FORGEJO_REPO}/settings/actions/secrets"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# SOUHRN
# ══════════════════════════════════════════════════════════════════════════════
step "Souhrn"

echo ""
echo "┌─────────────────────────────────────────────────────────────────────┐"
echo "│               EVYMO Multi-Stack Deploy Init — Výsledek             │"
echo "├─────────────────────────────────────────────────────────────────────┤"
printf "│  Coolify:  %-56s │\n" "${COOLIFY_URL}"
printf "│  Forgejo:  %-56s │\n" "${FORGEJO_URL}/${FORGEJO_OWNER}/${FORGEJO_REPO}"
echo "├─────────────────────────────────────────────────────────────────────┤"

for stack in $ALL_STACKS; do
  uuid=$(get_stack_uuid "$stack")
  label=$(stack_label "$stack")
  if [ -n "$uuid" ]; then
    printf "│  %-12s ✅ %-52s │\n" "${stack}:" "${uuid}"
  elif echo "$SELECTED_STACKS" | grep -qw "$stack"; then
    printf "│  %-12s ⚠️  %-51s │\n" "${stack}:" "NENASTAVENO"
  else
    printf "│  %-12s —  %-52s │\n" "${stack}:" "přeskočeno"
  fi
done

echo "├─────────────────────────────────────────────────────────────────────┤"
if [ -n "$WEBHOOK_URL" ]; then
  printf "│  Webhook:  %-56s │\n" "configured (value redacted)"
else
  echo "│  Webhook:  ⚠️  NENASTAVENO                                         │"
fi
echo "├─────────────────────────────────────────────────────────────────────┤"
echo "│  Compose soubory:                                                   │"
for stack in $ALL_STACKS; do
  printf "│    %-10s → %-52s │\n" "${stack}" "$(stack_compose "$stack")"
done
echo "└─────────────────────────────────────────────────────────────────────┘"

if [ -n "$DI_DRZENE" ]; then
  echo ""
  warn "DRŽENO — stacky, které tenhle běh NENASTAVIL (deklarace v overlayi instance): ${DI_DRZENE}"
fi

echo ""
echo "Další kroky:"

missing_stacks=""
for stack in $SELECTED_STACKS; do
  uuid=$(get_stack_uuid "$stack")
  if [ -z "$uuid" ]; then
    echo "  → Vytvoř '$(stack_label "$stack")' v Coolify (compose: $(stack_compose "$stack"))"
    missing_stacks="$missing_stacks $stack"
  fi
done

if [ -n "$UUID_WEB" ]; then
  echo "  → Push na main → Forgejo CI → Coolify auto-deploy (Web)"
fi
if [ -n "$UUID_CORE" ]; then
  echo "  → Coolify UI: Deploy/Redeploy Core stack"
fi
if [ -n "$UUID_LANGFUSE" ]; then
  echo "  → Coolify UI: Deploy/Redeploy Langfuse stack"
fi
if [ -n "$UUID_ADMIN" ]; then
  echo "  → Coolify UI: Deploy/Redeploy Admin stack"
fi

if [ -n "$missing_stacks" ]; then
  echo ""
  info "Po vytvoření chybějících stacků spusť znovu:"
  info "  bash scripts/coolify-deploy-init.sh --stack $(echo "$missing_stacks" | xargs | tr ' ' ',')"
fi

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  warn "DRY RUN — nic nebylo skutečně změněno"
fi

echo ""
if [ "${#DI_NEDOKONCENO[@]}" -gt 0 ]; then
  err "NEDOKONČENO: stacky z manifestu bez aplikace v Coolify (env nenastaven): ${DI_NEDOKONCENO[*]}"
  # Kód 3 = ostatní stacky nastavené; volající smí pokračovat, ale ví to.
  exit 3
fi
ok "Hotovo!"
