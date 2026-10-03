#!/usr/bin/env bash
# ==============================================================================
# coolify-story-init.sh — Multi-server Coolify application provisioner
# ==============================================================================
#
# Vytvoří Coolify aplikace pro story rozloženou přes více serverů.
# Čte placement z manifest souboru (YAML-like) nebo CLI argumentů.
#
# Prerekvizity:
#   - jq nainstalován
#   - COOLIFY_API_TOKEN env var (nebo --token)
#   - Forgejo repo existuje a má compose soubory
#
# Použití:
#   # Z manifest souboru:
#   bash scripts/coolify-story-init.sh --manifest coolify-story.manifest
#
#   # Nebo explicitně:
#   bash scripts/coolify-story-init.sh \
#     --story acme \
#     --repo your-org/your-app \
#     --app frontend:frontend:docker-compose.coolify-acme.yml \
#     --app backend:backend:docker-compose.coolify-acme-backend.yml \
#     --app ai:experimental:docker-compose.coolify-acme-ai.yml
#
#   # Dry run:
#   DRY_RUN=1 bash scripts/coolify-story-init.sh --manifest ...
#
# Výstup:
#   - Coolify aplikace vytvořeny a nakonfigurovány
#   - UUID vypsány pro uložení do Forgejo secrets
#   - servers.json aktualizován (pokud --update-registry)
#
# Viz: docs/deploy/MULTI_SERVER_COOLIFY.md
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()   { echo -e "${BLUE}ℹ${NC}  $*"; }
ok()     { echo -e "${GREEN}✅${NC} $*"; }
warn()   { echo -e "${YELLOW}⚠️${NC}  $*"; }
err()    { echo -e "${RED}❌${NC} $*" >&2; }
step()   { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

# ── Inputs ────────────────────────────────────────────────────────────────────
# Source canonical config files BEFORE reading env vars. Project invariant:
# NO hardcoded URLs in scripts — values come from config/domains.env or env files.
# See scripts/lib/env.mjs (Node equivalent) for the full rationale.
REPO_ROOT_GUESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# ONE env foundation for the whole toolchain: lib/resolve-domains-env.sh, the same
# composition aisha-cold-start.sh performs at its "Resolving topology" step and that
# stack-health.sh / smoke-routing.sh already source —
#   1. .env-prod-backup (operator)  2. derive-domains.mjs --shell (topology SoT)
#   3. config/domains.env (composite refs expand against the populated env)
#
# This script used to source only (1) and (3), so it decided WITHOUT the resolver.
# Two consequences, both measured 2026-08-08 on a fork installation:
#   • provision gates (services.json `provision_when_env`) were evaluated against a
#     partial env — EXTRANET_ENABLED sat in .env.coolify (a GENERATED artifact, never
#     an input) and in domains.env as the platform default `false`, so the extranet app
#     was silently never created and deploy-init later reported it "not found in Coolify";
#   • nothing derived (SERVICE_ALIAS_PREFIX, *_DOMAIN, placements) was in scope at all.
# The lib carries the same set +e +u guard for .env-prod-backup's unquoted BIP39
# COSMOS_SIGNER_MNEMONIC that used to live here (incident 2026-07-17), and restores the
# caller's flags exactly — so the guard is not lost, just shared.
PROJECT_ROOT="${PROJECT_ROOT:-$REPO_ROOT_GUESS}"
# shellcheck source=/dev/null
. "$REPO_ROOT_GUESS/scripts/lib/resolve-domains-env.sh"

COOLIFY_URL="${COOLIFY_URL:-}"
COOLIFY_TOKEN="${COOLIFY_API_TOKEN:-${COOLIFY_TOKEN:-}}"
# FORGEJO_URL: prefer explicit env override, else derive from FORGEJO_DOMAIN
# (canonical: config/domains.env). Fail fast if neither is set — no fallback.
if [ -z "${FORGEJO_URL:-}" ]; then
  if [ -z "${FORGEJO_DOMAIN:-}" ]; then
    echo "ERROR: neither FORGEJO_URL nor FORGEJO_DOMAIN is set." >&2
    echo "  Add FORGEJO_DOMAIN=... to config/domains.env or export FORGEJO_URL=..." >&2
    exit 1
  fi
  FORGEJO_URL="https://${FORGEJO_DOMAIN}"
fi
FORGEJO_TOKEN="${FORGEJO_API_TOKEN:-${FORGEJO_TOKEN:-}}"
PROJECT_UUID="${COOLIFY_PROJECT_UUID:-}"
ENVIRONMENT="${COOLIFY_ENVIRONMENT:-}"
GIT_BRANCH="${GIT_BRANCH:-main}"
DRY_RUN="${DRY_RUN:-0}"

# Git auth strategy:
#   We embed FORGEJO_TOKEN directly into git_repository URL (see line ~170:
#   "https://aisha:${FORGEJO_TOKEN}@..."). Coolify v4 clones via that URL,
#   so we do NOT need to attach a registered private_key_uuid here. Keeping
#   the file lean — token-in-URL is the single source of truth for git auth.
UPDATE_REGISTRY=0

STORY_NAME=""
REPO_PATH=""
MANIFEST_FILE=""
declare -a APPS=()

# ── Server UUID lookup ────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVERS_JSON="${PROJECT_ROOT}/coolify/servers.json"

resolve_server_uuid() {
  local name="$1"
  if [ -f "$SERVERS_JSON" ] && command -v jq &>/dev/null; then
    local uuid
    uuid=$(jq -r ".servers.${name}.coolify_uuid // empty" "$SERVERS_JSON" 2>/dev/null)
    if [ -n "$uuid" ] && [[ ! "$uuid" == *'${'* ]]; then
      echo "$uuid"
      return
    fi
  fi
  # Fallback: env var
  local var="COOLIFY_SERVER_UUID_$(echo "$name" | tr '[:lower:]' '[:upper:]')"
  echo "${!var:-}"
}

# ── Opt-in provisioning gate (derived from the catalog, not hand-written) ─────
# Single source of truth: config/services.json `provision_when_env`
#   string → one condition          array → any-of (service with several lanes)
# Returns 0 (= skip this role) only when the service DECLARES a gate and none of
# the declared vars is set. A role with no declaration is never skipped.
#
# This replaced a stack of hand-written `if [ "$role" = ... ]` blocks. Those were
# copies of the catalog and drifted from it in both directions: svc-source-broker
# grew a second, federation-independent lane (li-driver → li_*) on 2026-07-15
# while its bash gate still tested only SOURCE_API_URL, so the only writer into
# li_* could never be provisioned and the stack came up silently short — no
# error, just an absent app (found 2026-07-20). Meanwhile `model` declared a gate
# the bash never honoured, and `webdispecink` had a gate the catalog never knew.
# Deriving means a new lane — or a fifth opt-in service — is covered the day it
# declares its gate, exactly how _unprovisioned_services() in
# scripts/lib/coolify-app-vars.sh already derives the mirror-image question.
SERVICES_JSON="${PROJECT_ROOT}/config/services.json"
GATE_VARS_LAST=""

provision_gate_skips() {
  local role="$1" vystup rc=0
  GATE_VARS_LAST=""
  # „Zapnuto?" rozhoduje jeden domov (lib/provision-gate.mjs) — tatáž odpověď
  # jako v resolveru a v mapě aplikací. Hodnota `false`/`0`/`no`/`off` je
  # vypínač; dřív ji tohle místo bralo za zapnutou lane (každá neprázdná).
  vystup=$(node "${PROJECT_ROOT}/scripts/lib/provision-gate.mjs" --zapnuto "$role") || rc=$?
  case "$rc" in
    0) return 1 ;;                            # bez podmínky, nebo lane zapnutá → založit
    1) GATE_VARS_LAST="$vystup"; return 0 ;;  # deklarovaná podmínka, lane vypnutá → přeskočit
    *) echo "provision_gate_skips: brána služby '$role' nejde vyhodnotit — nezakládám naslepo" >&2
       exit 1 ;;
  esac
}

resolve_server_ip() {
  local name="$1"
  local var="${name^^}_IP"
  echo "${!var:-}"
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --story|-s)       STORY_NAME="$2"; shift 2 ;;
    --repo|-r)        REPO_PATH="$2"; shift 2 ;;
    --app|-a)         APPS+=("$2"); shift 2 ;;
    --manifest|-m)    MANIFEST_FILE="$2"; shift 2 ;;
    --token|-t)       COOLIFY_TOKEN="$2"; shift 2 ;;
    --project)        PROJECT_UUID="$2"; shift 2 ;;
    --branch)         GIT_BRANCH="$2"; shift 2 ;;
    --update-registry) UPDATE_REGISTRY=1; shift ;;
    --dry-run|-n)     DRY_RUN=1; shift ;;
    --help|-h)
      echo "Usage: $0 --story NAME --repo owner/repo --app role:server:compose [--app ...] [options]"
      echo ""
      echo "  --story NAME         Story/project name (e.g. acme)"
      echo "  --repo owner/repo    Forgejo repo path"
      echo "  --app SPEC           App spec: role:server:compose_path (repeatable)"
      echo "  --manifest FILE      Read apps from manifest file instead of --app"
      echo "  --token TOKEN        Coolify API token (or COOLIFY_API_TOKEN env)"
      echo "  --project UUID       Coolify project UUID (or COOLIFY_PROJECT_UUID env)"
      echo "  --branch BRANCH      Git branch (default: main)"
      echo "  --update-registry    Update coolify/servers.json with new stacks"
      echo "  --dry-run            Show what would be done without executing"
      echo ""
      echo "App spec format: role:server:docker-compose-path"
      echo "  Example: frontend:frontend:docker-compose.coolify-acme.yml"
      echo "  Server names: frontend, backend, experimental (must exist in servers.json)"
      exit 0 ;;
    *) err "Unknown argument: $1"; exit 1 ;;
  esac
done

# An explicit --story must WIN over the manifest's story: field. This lets a fork
# name its Coolify apps <prefix>-* (cold-start passes --story "${APP_NAME_PREFIX}")
# while still reading the app LIST from a shared/generic manifest — without it the
# manifest's story: clobbers --story and every such fork collides on one namespace.
STORY_NAME_FROM_CLI="$STORY_NAME"

# ── Parse manifest if provided ────────────────────────────────────────────────
if [ -n "$MANIFEST_FILE" ]; then
  if [ ! -f "$MANIFEST_FILE" ]; then
    err "Manifest file not found: $MANIFEST_FILE"
    exit 1
  fi
  info "Reading manifest: $MANIFEST_FILE"
  while IFS= read -r line; do
    line=$(echo "$line" | sed 's/#.*//' | xargs)
    [ -z "$line" ] && continue
    case "$line" in
      story:*)  [ -z "$STORY_NAME_FROM_CLI" ] && { STORY_NAME="${line#story:}" ; STORY_NAME=$(echo "$STORY_NAME" | xargs); } ;;
      repo:*)   REPO_PATH="${line#repo:}" ; REPO_PATH=$(echo "$REPO_PATH" | xargs) ;;
      branch:*) GIT_BRANCH="${line#branch:}" ; GIT_BRANCH=$(echo "$GIT_BRANCH" | xargs) ;;
      app:*)    APPS+=("${line#app:}") ;;
    esac
  done < "$MANIFEST_FILE"
fi

# ── Validate ──────────────────────────────────────────────────────────────────
[ -z "$STORY_NAME" ] && { err "Missing --story name"; exit 1; }

# ── Instance boundary ─────────────────────────────────────────────────────────
# STORY_NAME becomes the Coolify app-name prefix (<story>-<role>), so a story that
# is not THIS instance creates a foreign tenant's apps here. Both ways in are
# covered because this checks the RESOLVED value: `--story <prefix>` over a shared
# manifest still passes (that is the supported fork idiom above), while a manifest
# whose story: is another instance's does not.
#
# Measured 2026-08-08: coolify-drift-check.mjs printed
#   "Action: bash scripts/coolify-story-init.sh --manifest coolify/manifests/aisha.manifest"
# while running against a fork instance. Following it would have created
# 27 aisha-* apps in this project. The instance identity is resolved dynamically by
# lib/coolify-instance-scope.mjs — the same boundary the .mjs tools use, never a
# literal repeated here.
_instance_prefix="$(node "${SCRIPT_DIR:-$(dirname "$0")}/lib/coolify-instance-scope.mjs" --prefix 2>/dev/null || true)"
if [ -n "$_instance_prefix" ]; then
  if [ "$STORY_NAME" != "$_instance_prefix" ]; then
    err "story '${STORY_NAME}' does not match this instance '${_instance_prefix}' — refusing."
    err "  Applying it would create ${STORY_NAME}-* apps inside ${_instance_prefix}."
    err "  Use coolify/manifests/${_instance_prefix}.manifest, or pass --story ${_instance_prefix}."
    exit 1
  fi
  ok "Instance boundary: story '${STORY_NAME}' matches declared instance"
else
  warn "No APP_NAME_PREFIX declared (env or .env.coolify) — instance boundary NOT enforced for story '${STORY_NAME}'"
fi
[ -z "$REPO_PATH" ]  && { err "Missing --repo path"; exit 1; }
[ ${#APPS[@]} -eq 0 ] && { err "No --app specs provided"; exit 1; }
[ -z "$COOLIFY_TOKEN" ] && { err "Missing COOLIFY_API_TOKEN or --token"; exit 1; }
[ -z "$COOLIFY_URL" ] && { err "Missing COOLIFY_URL (explicit Coolify base URL required)"; exit 1; }
[ -z "$PROJECT_UUID" ] && { err "Missing COOLIFY_PROJECT_UUID or --project"; exit 1; }
[ -z "$ENVIRONMENT" ] && { err "Missing COOLIFY_ENVIRONMENT"; exit 1; }
case "$COOLIFY_URL" in
  http://*|https://*) ;;
  *) err "COOLIFY_URL must be an absolute http(s) URL, got: $COOLIFY_URL"; exit 1 ;;
esac

if ! command -v jq &>/dev/null; then
  err "jq is required: brew install jq"
  exit 1
fi

GIT_URL="${FORGEJO_URL}/${REPO_PATH}.git"

# Embed forgejo credentials in URL for private repo access (Coolify can't read)
# the host-side ~/.git-credentials, so creds must be in the URL itself.
if [ -n "$FORGEJO_TOKEN" ]; then
  # Strip scheme, prepend creds, re-add scheme
  GIT_URL_NOSCHEME="${GIT_URL#https://}"
  GIT_URL="https://aisha:${FORGEJO_TOKEN}@${GIT_URL_NOSCHEME}"
fi

# Token-free twin for anything human- or log-facing. GIT_URL now carries the
# credentials and belongs ONLY in the Coolify API payload; every echo/warn/info
# uses this one instead. Without it the dry-run branch printed the raw token to
# the terminal — and into the CI job log whenever this script runs in a pipeline
# (found 2026-07-20). Same idiom as scripts/instance-rollout.sh and
# scripts/deploy/instance-data-hook.sh: strip the userinfo between :// and @.
GIT_URL_SAFE=$(printf '%s' "$GIT_URL" | sed -E 's|(://)[^@/]+@|\1***@|')

step "Story: ${STORY_NAME}"
info "Repo: ${FORGEJO_URL}/${REPO_PATH}.git (branch: ${GIT_BRANCH}, creds embedded: $([ -n "$FORGEJO_TOKEN" ] && echo yes || echo no))"
info "Apps: ${#APPS[@]}"
[ "$DRY_RUN" = "1" ] && warn "DRY RUN — nothing will be created"

# ── Coolify API helpers ───────────────────────────────────────────────────────
# 3-retry loop with backoff for slow/loaded frontend API. Retries on curl exit
# codes 28/6/7/56/18/52 (timeout/network/incomplete-body) + HTTP 429 rate limit.
# Vrátí HTTP kód GETu, nic jiného. `coolify_api` vrací TĚLO a kód zahazuje,
# takže volající nedokáže odlišit 404 od 500, prázdné odpovědi nebo chyby jq —
# a u otázky "existuje ta aplikace?" je ten rozdíl vším: 404 znamená zakládej,
# cokoli jiného znamená NEVÍM. Prázdný výstup = transport vůbec nedoběhl.
coolify_api_status() {
  local endpoint="$1" code
  code=$(curl -sS --max-time 60 --connect-timeout 10 -o /dev/null -w '%{http_code}' \
    -X GET \
    -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
    -H "Content-Type: application/json" \
    "${COOLIFY_URL}/api/v1${endpoint}" 2>/dev/null) || code=""
  printf '%s' "$code"
}

coolify_api() {
  local method="$1" endpoint="$2"
  shift 2
  local attempt rc=0 out="" http_code body_file
  body_file=$(mktemp)
  for attempt in 1 2 3 4 5; do
    http_code=$(curl -sS --max-time 120 --connect-timeout 10 -w '%{http_code}' -o "$body_file" \
      -X "$method" \
      -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
      -H "Content-Type: application/json" \
      "${COOLIFY_URL}/api/v1${endpoint}" \
      "$@" 2>/dev/null)
    rc=$?
    out=$(cat "$body_file" 2>/dev/null)
    if [ "$rc" = "0" ] && [ "$http_code" != "429" ]; then
      printf '%s' "$out"
      rm -f "$body_file"
      return 0
    fi
    if [ "$http_code" = "429" ]; then
      if [ "$attempt" -lt "5" ]; then
        local delay=$((2 ** attempt))
        warn "  coolify_api $method $endpoint — HTTP 429 rate limit (attempt $attempt/5), retry in ${delay}s..."
        sleep "$delay"
        continue
      fi
    fi
    case "$rc" in
      28|6|7|56|18|52)
        if [ "$attempt" -lt "5" ]; then
          warn "  coolify_api $method $endpoint — curl exit $rc (attempt $attempt/5), retry in $((attempt * 2))s..."
          sleep "$((attempt * 2))"
          continue
        fi
        ;;
    esac
    err "coolify_api $method $endpoint failed (curl exit $rc, http $http_code)"
    printf '%s' "$out"
    rm -f "$body_file"
    return "$rc"
  done
  rm -f "$body_file"
  return "$rc"
}

# ── Project-scoped application list ───────────────────────────────────────────
# Echoes a JSON ARRAY of THIS project's applications. Prefers the
# project-environment endpoint `GET /projects/{uuid}/{env}` (returns only this
# project's apps → ~32 s) over the GLOBAL `GET /applications`, whose body grows
# past curl's --max-time once the full stack exists (120 s timeouts mid-body,
# curl 28/18 — incident 2026-06-03). Falls back to the global list only if the
# project/env identity is unknown. Non-array output is left to the caller's
# `jq type=="array"` guard.
coolify_list_apps() {
  local raw=""
  if [ -n "${PROJECT_UUID:-}" ] && [ -n "${ENVIRONMENT:-}" ]; then
    raw=$(coolify_api GET "/projects/${PROJECT_UUID}/${ENVIRONMENT}" 2>/dev/null \
      | tr -d '\000-\037' | jq -c '.applications // empty' 2>/dev/null)
    if [ -n "$raw" ] && echo "$raw" | jq -e 'type=="array"' >/dev/null 2>&1; then
      printf '%s' "$raw"
      return 0
    fi
  fi
  coolify_api GET "/applications" 2>/dev/null | tr -d '\000-\037'
}

# ── Reconcile app config (idempotent, soft-fail) ──────────────────────────────
# PATCH git settings + compose location + docker_compose_raw seed. Called BOTH
# after a fresh create AND when "already exists" — so a re-run heals partial
# state from a prior aborted cold-start (Coolify v4 POST can return UUID with
# corrupted git_repository under load; the original code's PATCH without
# soft-fail then died via `set -euo pipefail` on the next API stall, leaving
# the app stuck mid-config with no recovery path on re-run).
#
# All PATCH calls soft-fail (warn instead of abort). Drift on git_repository
# or empty docker_compose_raw is recorded in FAILURES so the operator sees
# the broken app in the summary (vs. discovering it at deploy time).
#
# Memory: feedback_coolify_api_unified_retry.md — every Coolify API call needs
# retry + soft-fail because v4 has 20-40s API slowness windows during cold-start.
reconcile_app_config() {
  local uuid="$1" role="$2" compose_path="$3"
  # $4 = 1, když aplikaci vytvořil TENHLE běh. Rozhoduje jen o TÓNU hlášky
  # u prázdného docker_compose_raw (viz níže), ne o verdiktu: u čerstvé
  # aplikace je prázdno normální (fronta `LoadComposeFile` teprve běží),
  # u starší je to informace, že domény zatím nastavit nepůjde.
  # Ani jedno není FAILURE — čeká se až bariérou v coolify-deploy-init.sh.
  local just_created="${4:-0}"
  local local_compose="${PROJECT_ROOT}/${compose_path}"

  # 1. Git settings + compose location PATCH (soft-fail)
  if coolify_api PATCH "/applications/${uuid}" -d "$(jq -n \
      --arg git "$GIT_URL" \
      --arg branch "$GIT_BRANCH" \
      --arg compose "/${compose_path}" \
      '{
        git_repository: $git,
        git_branch: $branch,
        docker_compose_location: $compose
      }')" > /dev/null; then
    ok "  Reconciled git + compose path"
  else
    warn "  Git PATCH failed for ${role} (${uuid}) — will retry on next cold-start"
  fi

  # 2. docker_compose_raw — jen ODEČET, PATCH ho doručit neumí.
  #
  #    PATCH /applications/{uuid} s `docker_compose_raw` vrací 422 „This field
  #    is not allowed" — v update-cestě Coolify to pole v allowedFields nemá.
  #    (Dřívější seed přes PATCH vypadal úspěšně jen proto, že coolify_api bere
  #    curl-exit-0 jako úspěch bez ohledu na HTTP status, takže se 422 zahodila.)
  #    Doručuje ho proto CREATE payload výše.
  #
  #    Plnič EXISTUJE, ale je ASYNCHRONNÍ: create-cesta dispatchuje řazenou
  #    úlohu `LoadComposeFile` (ApplicationsController: `LoadComposeFile::
  #    dispatch($application)` pro build_pack=dockercompose). Čekalo se tu na
  #    ni 6× 5 s.
  #
  #    ⛔ NAMĚŘENO 2026-08-17, proč těch 30 s nestačí: cold-start sám tu frontu
  #    ucpe. Aplikace vznikly 06:21–06:58 UTC, docker_compose_raw jim dorazil
  #    až 07:46–07:48 — tedy zhruba o HODINU později, a to v sérii po ~6 s,
  #    jak se fronta protrhla. (Táž fronta stála i v incidentu s pamětí
  #    Coolify, viz [[project_coolify_pamet_fronta]].) Mezitím doběhl krok 4
  #    a všech 16 stacků s doménami dostalo 422.
  #
  #    Obejít frontu seedem v create payloadu NEJDE (ověřeno, viz komentář
  #    u create_payload níže). Čeká se proto BARIÉROU až tam, kde na compose
  #    skutečně záleží — před nastavením domén v coolify-deploy-init.sh.
  #    Tady jen ODEČET, aby operátor viděl stav; blokovat se tu nemá.
  #
  #    Prázdno tu tedy NENÍ „ještě chvíli počkej", ale konkrétní předpověď:
  #    krok 4 cold-startu na téhle aplikaci domény nastavit NEDOKÁŽE.
  if [ -f "$local_compose" ]; then
    local poll_attempt=0
    local raw_chars=0
    while [ $poll_attempt -lt 6 ]; do
      poll_attempt=$((poll_attempt + 1))
      raw_chars=$(coolify_api GET "/applications/${uuid}" 2>/dev/null \
        | jq -r '.docker_compose_raw // "" | length' 2>/dev/null \
        || echo "0")
      [ "${raw_chars:-0}" != "0" ] && break
      sleep 5
    done
    if [ "${raw_chars:-0}" != "0" ]; then
      info "  docker_compose_raw populated by Coolify ($raw_chars chars, attempt $poll_attempt)"
    else
      warn "  docker_compose_raw je PRÁZDNÝ → domény na téhle aplikaci nastavit nepůjde"
      warn "  (doplní ji fronta Coolify nebo první nasazení; čeká se bariérou v kroku 4)"
    fi
  else
    warn "  Lokální compose nenalezen: $local_compose"
  fi

  # 3. Verify desired state — poll-with-backoff for git_repository
  #    propagation (Coolify v4 has 5-15s cache race after PATCH).
  #    Iter 22e: compose-raw-empty downgraded to transient (deploy populates).
  #    Iter 22g: git-config-drift now polls until populated or timeout (was
  #    fail-on-first-read, which raced Coolify's PATCH→GET propagation lag).
  local verify v_git v_compose v_rawlen
  local poll_git=0
  while [ $poll_git -lt 6 ]; do
    poll_git=$((poll_git + 1))
    verify=$(coolify_api GET "/applications/${uuid}" 2>/dev/null \
      | jq -r '"\(.git_repository // "")|\(.docker_compose_location // "")|\(.docker_compose_raw // "" | length)"' 2>/dev/null \
      || echo "||0")
    IFS='|' read -r v_git v_compose v_rawlen <<< "$verify"
    [[ "$v_git" == https://* ]] && break
    [ $poll_git -lt 6 ] && sleep 3
  done
  if [[ "$v_git" != https://* ]]; then
    warn "  ⚠️  Drift on ${role}: git_repository=${v_git:0:60} (expected https://...) after $poll_git polls"
    FAILURES+=("${role}:git-config-drift")
  fi
  if [ "${v_rawlen:-0}" = "0" ]; then
    # ⛔ TOHLE NENÍ VADA — a jednou už se za vadu omylem prohlásilo.
    #
    # Compose plní ASYNCHRONNÍ úloha `LoadComposeFile`, kterou create teprve
    # dispatchoval. Prázdno hned po create je proto NORMÁLNÍ výchozí stav,
    # ne selhání doručení. (Krátce tu stál tvrdý verdikt postavený na domněnce,
    # že jde raw naseedovat v create payloadu; seed se měřením ukázal jako
    # neúčinný a byl odstraněn, verdikt tu ale omylem zůstal — a označil za
    # vadu všech 31 čerstvě založených aplikací, čímž shodil celý --wipe.)
    #
    # Kdo na compose skutečně čeká, je krok 4: bariéra `cekej_na_compose`
    # v coolify-deploy-init.sh. Tady se jen zaznamená stav.
    if [ "$just_created" = "1" ]; then
      info "  ${role}: compose zatím nenačten — čeká ve frontě (bariéra kroku 4 si na něj počká)"
    else
      warn "  ⚠️  ${role}: docker_compose_raw prázdný → dokud nedorazí, domény nastavit nepůjde"
    fi
  fi
}

# ── Create applications ──────────────────────────────────────────────────────
RESULTS=()
FAILURES=()

for app_spec in "${APPS[@]}"; do
  app_spec=$(echo "$app_spec" | xargs)
  # Format: role:server:compose_path[:tag1=val1[:tag2=val2...]]
  # Tags suffix supports `bluegreen=on` flag (Phase 1 implementace WIP — pair
  # creation zatím manual; tento parser ho jen rozpozná pro audit/logování).
  IFS=':' read -r role server compose_path tags_raw <<< "$app_spec"

  [ -z "$role" ] || [ -z "$server" ] || [ -z "$compose_path" ] && {
    err "Invalid app spec: $app_spec (expected role:server:compose_path[:tags])"
    FAILURES+=("${role:-?}:invalid-spec")
    continue
  }

  # Opt-in services: skip when the catalog declares a gate and no lane is armed.
  # The condition itself lives in config/services.json (provision_when_env) —
  # see provision_gate_skips() above for why it is derived here instead of
  # written out. With no app created, deploy-init's discovery finds an empty
  # UUID and skips it at deploy time too (the optional-stack contract).
  if provision_gate_skips "$role"; then
    info "  skipping ${STORY_NAME}-${role}: no lane enabled (${GATE_VARS_LAST} unset)"
    continue
  fi

  # Parse tags: comma-separated tag=value pairs (or bare flag)
  HAS_BLUEGREEN=0
  if [[ -n "$tags_raw" ]]; then
    IFS=',' read -ra tag_pairs <<< "$tags_raw"
    for pair in "${tag_pairs[@]}"; do
      case "$pair" in
        bluegreen=on) HAS_BLUEGREEN=1 ;;
        bluegreen=*) ;;
        *) info "  unknown tag for $role: $pair (ignored)" ;;
      esac
    done
  fi
  if [[ "$HAS_BLUEGREEN" == "1" ]]; then
    warn "  $role has bluegreen=on — Phase 1 stub: vytváří se zatím SINGLE app, ne pair"
    warn "  Manual B/G pair setup: create $role-blue + $role-green via Coolify UI"
    warn "  Tracker: docs/deploy/BLUE_GREEN_DESIGN.md (implementational checklist)"
  fi

  step "Creating: ${STORY_NAME}-${role} on ${server}"

  server_uuid=$(resolve_server_uuid "$server")
  [ -z "$server_uuid" ] && {
    err "Cannot resolve UUID for server: $server"
    err "Set COOLIFY_SERVER_UUID_$(echo "$server" | tr '[:lower:]' '[:upper:]') or update servers.json"
    FAILURES+=("${role}:no-server-uuid")
    continue
  }

  APP_NAME="${STORY_NAME}-${role}"
  info "Server: ${server} (${server_uuid})"
  info "Compose: ${compose_path}"

  if [ "$DRY_RUN" = "1" ]; then
    warn "[DRY RUN] Would create application: ${APP_NAME}"
    warn "  server_uuid: ${server_uuid}"
    warn "  compose: ${compose_path}"
    warn "  git: ${GIT_URL_SAFE}@${GIT_BRANCH}"
    RESULTS+=("${role}|${server}|DRY_RUN_UUID|${compose_path}")
    continue
  fi

  # Idempotency: skip if app with this name already exists.
  # Retry up to 6x with exponential-ish backoff on transient Coolify API
  # timeout — under heavy load (cold-start creating 13 apps), the
  # /applications GET can return non-array for stretches of ~10s. v12
  # hit a 3s gap creating ledger; bumped retry to 6 attempts (total
  # ~30s of polling) with backoff sequence 2s,3s,5s,8s,12s.
  apps_json=""
  for retry in 1 2 3 4 5 6; do
    apps_json=$(coolify_list_apps 2>/dev/null || echo '')
    if [ -n "$apps_json" ] && echo "$apps_json" | jq -e 'type=="array"' > /dev/null 2>&1; then
      break
    fi
    if [ "$retry" -lt 6 ]; then
      # Backoff: retry → wait. 2,3,5,8,12 = ~30s total elapsed.
      case "$retry" in
        1) sleep_s=2 ;;
        2) sleep_s=3 ;;
        3) sleep_s=5 ;;
        4) sleep_s=8 ;;
        5) sleep_s=12 ;;
        *) sleep_s=2 ;;
      esac
      warn "  /applications GET failed (attempt ${retry}/6) — retry in ${sleep_s}s"
      sleep "$sleep_s"
    fi
  done
  if [ -z "$apps_json" ] || ! echo "$apps_json" | jq -e 'type=="array"' > /dev/null 2>&1; then
    # ⛔ Tady stálo `apps_json="[]"` + blind-create, opřené o předpoklad, že
    # "Coolify odmítne, když jméno už existuje". 2026-08-22 se ten předpoklad
    # VYVRÁTIL: v projektu vznikly DVĚ aplikace jménem `<fork>-ledger` a Coolify
    # neřeklo nic. Prázdný seznam přitom NENÍ "nic neexistuje", je to
    # "nezjistil jsem to" — a přiřadit té nejistotě význam "zakládej" znamená
    # při každém výpadku API postavit duplikát ke KAŽDÉ živé aplikaci.
    err "Seznam aplikací se nepodařilo načíst ani po 6 pokusech (Coolify API)."
    err "  Nezakládám naslepo: prázdný seznam neznamená, že aplikace neexistují,"
    err "  a duplikáty téhož jména se perou o aliasy i jména kontejnerů."
    err "  Zkus znovu, až API odpoví."
    exit 1
  fi
  existing_uuid=$(echo "$apps_json" | jq -r --arg n "$APP_NAME" \
    '[.[] | select(.name == $n)] | first | .uuid // empty')
  if [ -n "$existing_uuid" ]; then
    # Coolify v4 race: the global /applications list can return stale
    # entries for ~30s after a wipe. Verify the app ACTUALLY exists by
    # hitting /applications/<uuid> (which is reliable per the wipe-phase
    # polling). If 404, treat as "needs create" despite the stale list.
    verify_code="$(coolify_api_status "/applications/${existing_uuid}")"
    if [ "$verify_code" = "200" ]; then
      ok "Already exists: ${APP_NAME} → ${existing_uuid} (verified per-UUID — reconciling config)"
      # Always reconcile config on re-run — heals partial state from a
      # prior aborted run (e.g., POST returned UUID but follow-up PATCH
      # was killed by set -euo pipefail on transient API stall, leaving
      # git_repository corrupt and docker_compose_raw NULL). Without this,
      # the second cold-start would skip the broken app entirely and the
      # operator would discover the breakage only at deploy time.
      reconcile_app_config "$existing_uuid" "$role" "$compose_path" 0
      RESULTS+=("${role}|${server}|${existing_uuid}|${compose_path}")
      continue
    elif [ "$verify_code" = "404" ]; then
      warn "  ${APP_NAME}: aplikace ${existing_uuid} v Coolify UŽ NENÍ (HTTP 404) — zakládám znovu"
    else
      # ⛔ NAMĚŘENO 2026-08-22: tahle větev vyrobila DRUHOU aplikaci `<fork>-ledger`.
      # Původní přitom celou dobu běžela (running:healthy od 08-17) — GET jen
      # přechodně selhal a `2>/dev/null | jq // empty || echo ""` z toho udělal
      # prázdno, které se četlo jako "neexistuje". Sonda, která neumí odpovědět
      # "NEVÍM", tu zakládá konkurenta pro živou aplikaci: dvě appky téhož jména
      # se perou o aliasy i jména kontejnerů a doktor pak zastaví cold-start.
      err "  ${APP_NAME}: existenci ${existing_uuid} NELZE ověřit (HTTP ${verify_code:-<bez odpovědi>})."
      err "    404 by znamenalo 'zakládej'; tohle znamená 'nevím'. Nezakládám —"
      err "    duplikát téhož jména je dražší než zastavení. Zkus znovu, až API odpoví."
      exit 1
    fi
  fi

  # Create application — retry on transient API failures (Coolify under
  # cold-start load occasionally returns truncated/empty responses).
  # Without retry, a single transient hiccup on one of 13 sequential
  # creates aborts the entire cold-start.
  # ⛔ NEPOSÍLAT SEM `docker_compose_raw` — ověřeno živě 2026-08-17, NEUPLATNÍ SE.
  #
  # Pole je sice v allowedFields create-cesty, takže se zdá, že ho lze naseedovat
  # a ušetřit čekání na frontu. Živý pokus to vyvrátil: create s ním vrátil uuid,
  # ale `docker_compose_raw` byl HNED POTÉ null — a za 8 s se objevila verze
  # normalizovaná z gitu (1323 znaků proti 1532 bajtům poslaného souboru).
  # Poslaná hodnota se tedy zahodí; plničem je vždycky asynchronní úloha
  # `LoadComposeFile`, kterou create dispatchuje.
  #
  # Ušetřit čekání proto NELZE. Řeší se BARIÉROU před nastavením domén —
  # scripts/lib/coolify-our-apps.sh::coolify_apps_without_compose_raw
  # + čekání v coolify-deploy-init.sh. Kdo sem seed vrátí, jen si vyrobí
  # dojem, že závislost na frontě zmizela.
  create_payload=$(jq -n \
    --arg name "$APP_NAME" \
    --arg project "$PROJECT_UUID" \
    --arg env "$ENVIRONMENT" \
    --arg server "$server_uuid" \
    --arg git "$GIT_URL" \
    --arg branch "$GIT_BRANCH" \
    --arg compose "$compose_path" \
    '{
      project_uuid: $project,
      environment_name: $env,
      server_uuid: $server,
      type: "docker-compose",
      name: $name,
      git_repository: $git,
      git_branch: $branch,
      docker_compose_location: ("/" + $compose),
      build_pack: "dockercompose",
      is_static: false,
      instant_deploy: false
    }')

  uuid=""
  for create_attempt in 1 2 3; do
    # NOTE: `|| true` is REQUIRED. Under `set -e`, a plain `var=$(cmd)`
    # assignment terminates the script when cmd exits non-zero. coolify_api
    # returns non-zero after exhausting its internal retries (e.g. a POST
    # timeout once the /applications body grows to ~1 MB during cold-start).
    # Without the guard, set -e kills story-init mid-loop BEFORE the
    # retry-recheck below can run — leaving the 3-attempt loop as dead code
    # and aborting the whole cold-start on a single transient API hiccup
    # (incident 2026-06-03: openclaw, app 14/16).
    response=$(coolify_api POST "/applications/public" -d "$create_payload" 2>/dev/null) || true
    uuid=$(echo "$response" | jq -r '.uuid // empty' 2>/dev/null || echo '')
    if [ -n "$uuid" ]; then
      break
    fi
    # Check if app was actually created server-side (idempotency: maybe
    # request succeeded but response was truncated — peek at /applications)
    sleep $((create_attempt * 2))
    apps_recheck=$(coolify_api GET /applications 2>/dev/null) || true
    if echo "$apps_recheck" | jq -e 'type=="array"' >/dev/null 2>&1; then
      uuid=$(echo "$apps_recheck" | jq -r --arg n "$APP_NAME" \
        '[.[] | select(.name == $n)] | first | .uuid // empty')
      if [ -n "$uuid" ]; then
        ok "  Created on retry-recheck: ${APP_NAME} → ${uuid} (response was truncated but server has it)"
        break
      fi
    else
      # Přeověření je JEDINÉ, co tu brání duplikátu: POST mohl projít a odpověď
      # se uťala. Když selže i ono, nevíme, jestli aplikace vznikla — a další
      # POST by z toho "nevím" udělal druhou appku téhož jména. Radši zastavit.
      err "  ${APP_NAME}: POST neodpověděl čitelně A přeověření seznamu taky selhalo."
      err "    Nevíme, jestli aplikace vznikla; další pokus by mohl založit duplikát."
      err "    Zkontroluj Coolify a spusť znovu, až API odpoví."
      exit 1
    fi
    if [ "$create_attempt" -lt 3 ]; then
      warn "  Create attempt ${create_attempt}/3 returned unparseable response — retrying in $((create_attempt * 3))s..."
      sleep $((create_attempt * 3))
    fi
  done

  if [ -z "$uuid" ]; then
    err "Failed to create ${APP_NAME} after 3 attempts: $(echo "$response" | jq -r '.message // .error // "unknown error (curl/jq)"' 2>/dev/null || echo 'unparseable response')"
    FAILURES+=("${role}:create-failed")
    continue
  fi

  ok "Created: ${APP_NAME} → ${uuid}"

  # Reconcile git + compose config (idempotent, soft-fails on transient API
  # errors instead of aborting via set -euo pipefail — see helper definition).
  reconcile_app_config "$uuid" "$role" "$compose_path" 1

  RESULTS+=("${role}|${server}|${uuid}|${compose_path}")
done

# ── Summary ───────────────────────────────────────────────────────────────────
step "Summary"
echo ""
printf "%-15s %-10s %-30s %s\n" "ROLE" "SERVER" "UUID" "COMPOSE"
printf "%-15s %-10s %-30s %s\n" "----" "------" "----" "-------"
for result in "${RESULTS[@]}"; do
  IFS='|' read -r role server uuid compose <<< "$result"
  printf "%-15s %-10s %-30s %s\n" "$role" "$server" "$uuid" "$compose"
done

echo ""
info "Next steps:"
echo "  1. Set env vars:  scripts/coolify-story-envs.sh --story ${STORY_NAME} --uuid UUID"
echo "  2. Set Forgejo secrets (COOLIFY_UUID_*) for CI/CD"
echo "  3. Deploy:        curl -X POST \${COOLIFY_URL}/api/v1/applications/UUID/restart"
echo "  4. Update:        coolify/servers.json + scripts/check-infra.mjs"

# ── Forgejo secrets hint ──────────────────────────────────────────────────────
if [ -n "$FORGEJO_TOKEN" ]; then
  echo ""
  step "Forgejo Secrets (auto-set)"
  for result in "${RESULTS[@]}"; do
    IFS='|' read -r role server uuid compose <<< "$result"
    secret_name="COOLIFY_UUID_$(echo "${STORY_NAME}_${role}" | tr '[:lower:]' '[:upper:]' | tr '-' '_')"

    if [ "$DRY_RUN" = "1" ]; then
      warn "[DRY RUN] Would set Forgejo secret: ${secret_name}=${uuid}"
      continue
    fi

    curl -sS --max-time 10 \
      -X PUT \
      -H "Authorization: token ${FORGEJO_TOKEN}" \
      -H "Content-Type: application/json" \
      "${FORGEJO_URL}/api/v1/repos/${REPO_PATH}/actions/secrets/${secret_name}" \
      -d "{\"data\": \"${uuid}\"}" > /dev/null 2>&1 \
      && ok "Forgejo secret: ${secret_name}" \
      || warn "Could not set Forgejo secret: ${secret_name}"
  done
fi

# ── Update registry ───────────────────────────────────────────────────────────
if [ "$UPDATE_REGISTRY" = "1" ] && [ "$DRY_RUN" = "0" ] && [ -f "$SERVERS_JSON" ]; then
  step "Updating servers.json"
  for result in "${RESULTS[@]}"; do
    IFS='|' read -r role server uuid compose <<< "$result"
    stack_name="${STORY_NAME}-${role}"
    existing=$(jq -r ".servers.${server}.stacks | index(\"${stack_name}\") // empty" "$SERVERS_JSON" 2>/dev/null)
    if [ -z "$existing" ]; then
      jq ".servers.${server}.stacks += [\"${stack_name}\"]" "$SERVERS_JSON" > "${SERVERS_JSON}.tmp" \
        && mv "${SERVERS_JSON}.tmp" "$SERVERS_JSON" \
        && ok "Added ${stack_name} to ${server} in servers.json"
    else
      info "${stack_name} already in ${server}'s stacks"
    fi
  done
fi

echo ""
if [ "${#FAILURES[@]}" -gt "0" ]; then
  err "Story '${STORY_NAME}' had ${#FAILURES[@]} failure(s):"
  for f in "${FAILURES[@]}"; do
    err "  - $f"
  done
  err "Created ${#RESULTS[@]} of ${#APPS[@]} apps. Re-run after fixing API/network."
  exit 1
fi
ok "Done! Story '${STORY_NAME}' provisioned: ${#RESULTS[@]}/${#APPS[@]} apps."
