#!/usr/bin/env bash
# =============================================================================
# aisha-cold-start-env.sh — Env-aware wrapper kolem aisha-cold-start.sh
# =============================================================================
# Resolvuje AISHA_ENV → správné Coolify URL, server UUIDs, env backup file,
# domains overlay, AISHA_STORY/AISHA_PROFILE. Pak deleguje na
# `aisha-cold-start.sh` se správnými COOLIFY_* env vars exportovanými.
#
# Supported env naming:
#   production | prod         → COOLIFY_PROD_*
#   staging    | stg          → COOLIFY_STAGING_*
#   <story>-{staging,prod}    → COOLIFY_<STORY>_<ENV>_*
#                               (story-prefixed envs for forks; e.g.
#                                AISHA_ENV=acme-staging reads
#                                COOLIFY_ACME_STAGING_*)
#
# Story name (drives manifest path coolify/manifests/${STORY}.manifest +
# Coolify app naming convention) resolution priority:
#   1. COOLIFY_<ENV>_STORY in coolify-environments.env (explicit per-env)
#   2. AISHA_STORY env var (caller-provided)
#   3. Derived from env prefix ("acme-staging" → "acme")
#   4. Default "aisha" — for bare production|staging
#
# Use cases:
#   AISHA_ENV=staging        bash scripts/aisha-cold-start-env.sh
#   AISHA_ENV=production     bash scripts/aisha-cold-start-env.sh
#   AISHA_ENV=acme-staging bash scripts/aisha-cold-start-env.sh
#   AISHA_ENV=production     bash scripts/aisha-cold-start-env.sh --wipe
#                              (requires typing 'PRODUCTION' to confirm)
#
# Source of truth: config/coolify-environments.env
#
# Plus všechny --skip-* flagy z aisha-cold-start.sh fungují normálně.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export AISHA_LOG_COMPONENT="cold-start-env"
# shellcheck source=lib/log.sh
. "$SCRIPT_DIR/lib/log.sh"
# Jeden domov odpovědi „produkce? prefix? env soubor?" (PR2 izolace) — táž tabulka
# jako cold-start, doktor a discovery.
# shellcheck source=lib/prostredi-behu.sh
. "$SCRIPT_DIR/lib/prostredi-behu.sh"

# Source environment config
ENVS_FILE="$REPO_ROOT/config/coolify-environments.env"
if [[ ! -f "$ENVS_FILE" ]]; then
  log_error "missing environments file" path "$ENVS_FILE"
  exit 1
fi
set -a; . "$ENVS_FILE"; set +a

# Resolve target env. AISHA_ENV is required so destructive operations never
# infer a destination cluster implicitly.
if [[ -z "${AISHA_ENV:-}" ]]; then
  log_error "AISHA_ENV is required" \
    hint "set AISHA_ENV=production, staging, or <story>-{staging,prod}"
  exit 1
fi
TARGET_ENV="$AISHA_ENV"

# Bash doesn't support the indirect ${COOLIFY_PROD_${key}} pattern directly,
# so use prefix-resolution helper.
#
# Story-aware envs: any env name matching "<story>-{staging,prod}" maps to
# prefix "COOLIFY_<STORY>_<ENV>_" with hyphens converted to underscores and
# uppercased. E.g. AISHA_ENV=acme-staging → COOLIFY_ACME_STAGING_*.
# Backward compat: bare "production"/"staging" resolve to legacy
# COOLIFY_PROD_ / COOLIFY_STAGING_ prefixes.
get_env_var() {
  local key="$1"; local env="$2"
  local prefix
  # Story-prefixed env: acme-staging → COOLIFY_ACME_STAGING_ (pb_prefix).
  if ! prefix="$(pb_prefix "$env")"; then
    log_error "unknown env" env "$env"; exit 1
  fi
  local var="${prefix}${key}"
  echo "${!var:-}"
}

# story_from_env "acme-staging" → "acme" ; "production" → "aisha"
# Used to set AISHA_STORY for downstream cold-start.sh manifest selection.
story_from_env() {
  local env="$1"
  case "$env" in
    production|prod|staging|stg) echo "aisha" ;;
    *) echo "${env%%-*}" ;;
  esac
}

# Validate env is one of allowed (story-prefixed envs must have config in env
# file — checked below via COOLIFY_*_URL existence).
case "$TARGET_ENV" in
  production|prod|staging|stg)
    ;;
  *-staging|*-stg|*-prod|*-production)
    # Shape only. This branch used to also require COOLIFY_<STORY>_<ENV>_URL in
    # config/coolify-environments.env and its hint sent operators straight there —
    # which FORCED an instance's identity into an UPSTREAM-tracked SoT shared by
    # every fork. That is the one place it must never be committed; it belongs in
    # the gitignored ENV_BACKUP overlay, which this script already reads (the
    # legacy-naming fallback below).
    #
    # The presence check is not lost: the identity resolves from either source and
    # is validated below ("missing Coolify URL for env"), whose hint names BOTH.
    # Checking here only meant checking the wrong one, too early to see the other.
    ;;
  *)
    log_error "invalid AISHA_ENV" env "$TARGET_ENV" \
      valid "production, staging, or <story>-{staging,prod}"
    exit 1
    ;;
esac

log_info "resolving environment" env "$TARGET_ENV"

# Resolve all relevant vars
COOLIFY_URL=$(get_env_var "URL" "$TARGET_ENV")
COOLIFY_PROJECT_UUID=$(get_env_var "PROJECT_UUID" "$TARGET_ENV")
COOLIFY_SERVER_UUID_FRONTEND=$(get_env_var "SERVER_UUID_FRONTEND" "$TARGET_ENV")
COOLIFY_SERVER_UUID_BACKEND=$(get_env_var "SERVER_UUID_BACKEND" "$TARGET_ENV")
COOLIFY_SERVER_UUID_EXPERIMENTAL=$(get_env_var "SERVER_UUID_EXPERIMENTAL" "$TARGET_ENV")
COOLIFY_SERVER_UUID_BUILD=$(get_env_var "SERVER_UUID_BUILD" "$TARGET_ENV")
ENV_BACKUP=$(get_env_var "ENV_BACKUP" "$TARGET_ENV")
DOMAINS_FILE=$(get_env_var "DOMAINS_FILE" "$TARGET_ENV")

# ── Story-slot pointer derivation ─────────────────────────────────────────────
# A story slot (<story>-{staging,prod}) needs NO entry in coolify-environments.env.
# That file is an UPSTREAM-tracked SoT shared by every fork: an instance's identity
# (URL / project + server UUIDs / environment) must never be committed into it —
# it belongs in the gitignored ENV_BACKUP overlay, which the legacy-naming fallback
# below already reads. But that fallback could never fire for an undeclared slot,
# because finding the overlay required a tracked COOLIFY_<SLOT>_ENV_BACKUP line —
# so declaring a story forced instance data into the shared file (path "b" of the
# header). Derive the two POINTERS instead and the whole slot stays out of git.
#
# Only pointers are derived, never identity. Built-in slots (production → the
# non-uniform .env-prod-backup, staging) declare theirs literally, so a non-empty
# value always wins and this cannot retarget them.
if [[ -z "$ENV_BACKUP" ]]; then
  ENV_BACKUP=".env-${TARGET_ENV}-backup"
  log_info "derived env backup (slot undeclared — instance data stays out of the shared SoT)" \
    file "$ENV_BACKUP"
fi
if [[ -z "$DOMAINS_FILE" && -f "$REPO_ROOT/config/domains-${TARGET_ENV}.env" ]]; then
  DOMAINS_FILE="config/domains-${TARGET_ENV}.env"
  log_info "derived domains overlay" file "$DOMAINS_FILE"
fi
# Coolify environment name inside the project (e.g. "production", "development",
# "staging"). Forks with multi-env projects (legacy + new AISHA stack side by
# side) MUST set this — otherwise cold-start defaults to "production" and may
# wipe legacy production apps. When unset, cold-start.sh keeps its existing
# default ("production").
COOLIFY_PROJECT_ENVIRONMENT=$(get_env_var "ENVIRONMENT" "$TARGET_ENV")

# ── Legacy-naming fallback ────────────────────────────────────────────────────
# config/coolify-environments.env is a template SoT: its COOLIFY_<ENV>_* keys are
# `${COOLIFY_<ENV>_*:-}` and resolve to empty unless the operator exported the
# env-PREFIXED names. Operators whose .env-prod-backup predates that scheme instead
# carry the BARE keys (COOLIFY_URL, COOLIFY_PROJECT_UUID, COOLIFY_SERVER_UUID_*,
# COOLIFY_ENVIRONMENT) — which is exactly what the direct aisha-cold-start.sh reads.
# So when a prefixed lookup is empty, read the legacy key from the resolved backup.
# This makes the env-aware wrapper accept the SAME backup files as the direct script
# instead of forcing a rename to the prefixed scheme.
_env_backup_path="$REPO_ROOT/$ENV_BACKUP"
if [[ -f "$_env_backup_path" ]]; then
  read_backup_key() {
    grep -E "^(export[[:space:]]+)?$1=" "$_env_backup_path" 2>/dev/null | head -1 \
      | sed -E "s/^(export[[:space:]]+)?$1=//; s/^[\"']//; s/[\"']\$//"
  }
  [[ -z "$COOLIFY_URL" ]]                      && COOLIFY_URL=$(read_backup_key COOLIFY_URL)
  [[ -z "$COOLIFY_PROJECT_UUID" ]]             && COOLIFY_PROJECT_UUID=$(read_backup_key COOLIFY_PROJECT_UUID)
  [[ -z "$COOLIFY_SERVER_UUID_FRONTEND" ]]     && COOLIFY_SERVER_UUID_FRONTEND=$(read_backup_key COOLIFY_SERVER_UUID_FRONTEND)
  [[ -z "$COOLIFY_SERVER_UUID_BACKEND" ]]      && COOLIFY_SERVER_UUID_BACKEND=$(read_backup_key COOLIFY_SERVER_UUID_BACKEND)
  [[ -z "$COOLIFY_SERVER_UUID_EXPERIMENTAL" ]] && COOLIFY_SERVER_UUID_EXPERIMENTAL=$(read_backup_key COOLIFY_SERVER_UUID_EXPERIMENTAL)
  [[ -z "$COOLIFY_SERVER_UUID_BUILD" ]]        && COOLIFY_SERVER_UUID_BUILD=$(read_backup_key COOLIFY_SERVER_UUID_BUILD)
  [[ -z "$COOLIFY_PROJECT_ENVIRONMENT" ]]      && COOLIFY_PROJECT_ENVIRONMENT=$(read_backup_key COOLIFY_ENVIRONMENT)
fi
# ── Env-backup file: required, but auto-bootstrap from Coolify if missing ───
# Když gitignorovaný ENV_BACKUP na disku ještě není — typicky první běh nad
# čerstvým klonem, nebo když ho někdo smazal — dá se obnovit přečtením hodnot,
# které už leží na záložkách Environment u aplikací v Coolify (tytéž hodnoty,
# co tam nechal minulý cold-start). Tím je cold-start autonomní: žádný ruční
# „rescue“ postup, žádný ručně sestavený počáteční soubor.
#
# Bootstrap potřebuje COOLIFY_API_TOKEN v prostředí volajícího (z souboru,
# který teprve vytváříme, ho přečíst nejde). Token se předává PROSTŘEDÍM,
# nikdy argumentem — argv je v `ps` čitelné každému uživateli na stroji:
#
#   COOLIFY_API_TOKEN=… AISHA_ENV=<env> \
#     bash scripts/aisha-cold-start-env.sh --skip-create --skip-deploy
#
# Pomocník zapíše ENV_BACKUP s právy 0600 (gitignorováno, čte jen vlastník)
# a zachová všechny vytěžené hodnoty. Další běhy cold-startu (bez --wipe)
# je pak drží stabilní přes preserve_or_gen() — dogenerují jen chybějící klíče.
if [[ ! -f "$REPO_ROOT/$ENV_BACKUP" ]]; then
  if [[ -n "${COOLIFY_API_TOKEN:-}" ]]; then
    log_info "env backup missing — bootstrapping from existing Coolify state" \
      path "$ENV_BACKUP" url "$COOLIFY_URL" project "$COOLIFY_PROJECT_UUID"
    if ! COOLIFY_API_TOKEN="$COOLIFY_API_TOKEN" \
       node "$REPO_ROOT/scripts/lib/bootstrap-env-from-coolify.mjs" \
        --coolify-url="$COOLIFY_URL" \
        --project-uuid="$COOLIFY_PROJECT_UUID" \
        --output="$REPO_ROOT/$ENV_BACKUP"; then
      log_error "bootstrap failed" path "$ENV_BACKUP" \
        hint "ensure COOLIFY_API_TOKEN has read access to the project's apps"
      exit 1
    fi
    log_info "bootstrap complete — env backup created" path "$ENV_BACKUP"
  else
    log_error "missing env backup file" path "$ENV_BACKUP" env "$TARGET_ENV" \
      hint "set COOLIFY_API_TOKEN in your shell to auto-bootstrap from Coolify"
    exit 1
  fi
fi
if [[ -z "$COOLIFY_URL" ]]; then
  log_error "missing Coolify URL for env" env "$TARGET_ENV" \
    hint "set COOLIFY_<ENV>_URL in config/coolify-environments.env, or the legacy COOLIFY_URL in $ENV_BACKUP"
  exit 1
fi
if [[ -z "$COOLIFY_PROJECT_UUID" ]]; then
  log_error "missing Coolify project UUID" env "$TARGET_ENV" \
    hint "set COOLIFY_<ENV>_PROJECT_UUID in config, or the legacy COOLIFY_PROJECT_UUID in $ENV_BACKUP"
  exit 1
fi
# Per-slot server UUIDs are NOT hard-required: the direct aisha-cold-start.sh
# auto-discovers them from Coolify (Iter 19 — name-match per slot, or single-server
# fan-out). Only warn when they are absent so the wrapper accepts legacy/minimal
# backups and defers slot resolution to discovery, matching the direct-script path.
for slot_key in COOLIFY_SERVER_UUID_FRONTEND COOLIFY_SERVER_UUID_BACKEND COOLIFY_SERVER_UUID_EXPERIMENTAL; do
  if [[ -z "${!slot_key:-}" ]]; then
    log_warn "Coolify slot UUID unset — will auto-discover" key "$slot_key" env "$TARGET_ENV"
  fi
done

# Resolve story name. Priority:
#   1) COOLIFY_<ENV>_STORY in env file (explicit per-env override — needed
#      when env name doesn't match story name, e.g. AISHA_ENV=acme-staging
#      with STORY=acme for the manifest filename + app naming prefix)
#   2) caller-provided AISHA_STORY env var
#   3) derived from env prefix ("acme-staging" → "acme")
#   4) default "aisha" — used when env is the bare "production"/"staging"
#      pair from the upstream evymo-ai-orchestrator setup.
TARGET_STORY=""
EXPLICIT_STORY="$(get_env_var STORY "$TARGET_ENV")"
if [[ -n "$EXPLICIT_STORY" ]]; then
  TARGET_STORY="$EXPLICIT_STORY"
elif [[ -n "${AISHA_STORY:-}" ]]; then
  TARGET_STORY="$AISHA_STORY"
else
  TARGET_STORY="$(story_from_env "$TARGET_ENV")"
fi

# Resolve topology profile (drives derive-domains.mjs output). Priority:
#   1) COOLIFY_<ENV>_PROFILE in env file (explicit per-env override)
#   2) caller-provided AISHA_PROFILE env var (kept if already set)
#   3) auto-detection: if config/profiles/<TARGET_ENV>.json exists, use it
#      (convention: env name matches profile id, e.g. AISHA_ENV=acme-staging
#      → AISHA_PROFILE=acme-staging if profile file exists)
#   3b) auto-detection by STORY: if config/profiles/<TARGET_STORY>.json exists.
#      A fork instance names its env <story>-<stage> (<fork>-staging) but ships ONE
#      profile per story (config/profiles/riq.json) — the same convention
#      story_from_env() already uses above. Without this step the story profile
#      was silently ignored and the run fell through to 'cloud-multi' (4), which
#      resolves FOREIGN TLDs/oauth2 domains and makes the instance profile dead
#      config. Cost us a live incident 2026-07-16: cold-start ran as cloud-multi,
#      ignored config/profiles/riq.json and regenerated 16 secrets (incl.
#      COLUMN_ENCRYPTION_KEY) against a running stack.
#   4) fallback: leave AISHA_PROFILE unset → aisha-cold-start.sh defaults to
#      'cloud-multi' (existing behavior; backward compatible).
TARGET_PROFILE=""
EXPLICIT_PROFILE="$(get_env_var PROFILE "$TARGET_ENV")"
if [[ -n "$EXPLICIT_PROFILE" ]]; then
  TARGET_PROFILE="$EXPLICIT_PROFILE"
elif [[ -n "${AISHA_PROFILE:-}" ]]; then
  TARGET_PROFILE="$AISHA_PROFILE"
elif [[ -f "$REPO_ROOT/config/profiles/${TARGET_ENV}.json" ]]; then
  TARGET_PROFILE="$TARGET_ENV"
elif [[ -n "$TARGET_STORY" && -f "$REPO_ROOT/config/profiles/${TARGET_STORY}.json" ]]; then
  TARGET_PROFILE="$TARGET_STORY"
fi

# Production safety: require explicit ack for destructive operations
WIPE_REQUESTED=0
for arg in "$@"; do
  if [[ "$arg" == "--wipe" ]]; then WIPE_REQUESTED=1; fi
done

if [[ "$TARGET_ENV" == "production" || "$TARGET_ENV" == "prod" ]] && [[ "$WIPE_REQUESTED" -eq 1 ]]; then
  log_warn "PRODUCTION wipe requested" env "$TARGET_ENV" coolify "$COOLIFY_URL"
  echo ""
  echo "  ⚠️  This will DELETE all AISHA apps in PRODUCTION Coolify."
  echo "  Type 'PRODUCTION' to confirm:"
  read -r confirm
  if [[ "$confirm" != "PRODUCTION" ]]; then
    log_error "production wipe NOT confirmed — aborting"
    exit 1
  fi
fi

log_info "delegating to aisha-cold-start" \
  env "$TARGET_ENV" \
  story "$TARGET_STORY" \
  profile "${TARGET_PROFILE:-<default>}" \
  manifest "coolify/manifests/${TARGET_STORY}.manifest" \
  coolify "$COOLIFY_URL" \
  env_backup "$ENV_BACKUP" \
  args "$*"

# Export vars expected by cold-start.sh
export COOLIFY_URL
export COOLIFY_BASE_URL="$COOLIFY_URL"
export COOLIFY_PROJECT_UUID
# PIN PROJEKTU pro izolaci prostředí (incident 2026-09-24): cold-start si ho
# přečte dřív, než načte jakýkoli soubor, a ne-produkční běh zastaví, kdyby ho
# discovery nebo záloha přepsaly. Produkční UUID, jak ho zná operátor, jde vedle,
# aby ne-produkční pin nemohl ukazovat na produkci.
export AISHA_WRAPPER_PROJECT_UUID="$COOLIFY_PROJECT_UUID"
export AISHA_WRAPPER_PROD_PROJECT_UUID="$(get_env_var PROJECT_UUID production)"
export COOLIFY_SERVER_UUID_FRONTEND
export COOLIFY_SERVER_UUID_BACKEND
export COOLIFY_SERVER_UUID_EXPERIMENTAL
export COOLIFY_SERVER_UUID_BUILD
export ENV_PROD_BACKUP="$REPO_ROOT/$ENV_BACKUP"  # cold-start.sh reads this var
export AISHA_ENV="$TARGET_ENV"
export AISHA_STORY="$TARGET_STORY"
# Only export AISHA_PROFILE if we resolved one — otherwise cold-start.sh
# applies its existing default (cloud-multi), preserving backward compat
# for bare production|staging envs which don't ship dedicated profile files.
if [[ -n "$TARGET_PROFILE" ]]; then
  export AISHA_PROFILE="$TARGET_PROFILE"
fi
# Coolify environment scope (project-internal). Only set if env file specifies
# it; cold-start.sh keeps its existing default ("production") otherwise.
if [[ -n "$COOLIFY_PROJECT_ENVIRONMENT" ]]; then
  export COOLIFY_ENVIRONMENT="$COOLIFY_PROJECT_ENVIRONMENT"
else
  export COOLIFY_ENVIRONMENT="$TARGET_ENV"
fi
# DOMAINS_FILE may include story-specific overlay (config/domains-${STORY}.env);
# cold-start.sh sources both base file and story overlay.
export DOMAINS_FILE

# Story-prefixed exports — resolve_target_env() in aisha-cold-start.sh re-derives
# COOLIFY_<SLOT>_* for story slots and HARD-requires <SLOT>_URL. For slots whose
# identity lives only in the gitignored ENV_BACKUP overlay (bare keys), nothing
# ever exports the prefixed names — the inner check then dies on an empty
# COOLIFY_<SLOT>_URL even though this wrapper already resolved everything.
# Export them so the inner re-resolution is truly idempotent.
# Jméno slotu doslova z AISHA_ENV (ne pb_prefix): pro holé `production` by pb_prefix
# dal COOLIFY_PROD_ a změnil export produkčního běhu — PR2 produkci nemění.
_slot_prefix="COOLIFY_$(echo "$TARGET_ENV" | tr 'a-z-' 'A-Z_')_"
export "${_slot_prefix}URL=$COOLIFY_URL"
export "${_slot_prefix}PROJECT_UUID=$COOLIFY_PROJECT_UUID"
export "${_slot_prefix}SERVER_UUID_FRONTEND=$COOLIFY_SERVER_UUID_FRONTEND"
export "${_slot_prefix}SERVER_UUID_BACKEND=$COOLIFY_SERVER_UUID_BACKEND"
export "${_slot_prefix}SERVER_UUID_EXPERIMENTAL=$COOLIFY_SERVER_UUID_EXPERIMENTAL"
export "${_slot_prefix}SERVER_UUID_BUILD=$COOLIFY_SERVER_UUID_BUILD"
export "${_slot_prefix}ENV_BACKUP=$ENV_BACKUP"

# Forward all CLI args to cold-start.sh
exec bash "$SCRIPT_DIR/aisha-cold-start.sh" "$@"
