# =============================================================================
# resolve-domains-env.sh — compose the SAME domain env foundation cold-start uses
# =============================================================================
# Source this from verification scripts (stack-health.sh, smoke-routing.sh)
# BEFORE requiring any *_DOMAIN variable.
#
# Why: config/domains.env is template-only (iter 15 — every value is an empty
# `${X:-}` form), so scripts that only source it hard-fail on a fresh shell
# even against a perfectly healthy deployment. The runbook's canonical
# verification recipe must be standalone-runnable; the topology resolver is
# the SoT (the exact pattern scripts/aisha-cold-start.sh uses at its
# "Resolving topology" step):
#
#   1. operator env  — the backup of THIS run's environment (TLDs, OAUTH2_*,
#                      overrides), if present: $ENV_PROD_BACKUP when the caller's
#                      environment names one, else $PROJECT_ROOT/.env-prod-backup
#   2. resolver      — scripts/lib/derive-domains.mjs --shell (all *_DOMAIN)
#   3. domains.env   — composite refs (KEYCLOAK_URL=https://${KEYCLOAK_DOMAIN})
#                      expand against the now-populated env
#
# Fail-loud: if the resolver cannot run (node missing, profile broken), the
# caller exits non-zero — a health check that cannot determine the expected
# surface must not pretend to be green.
#
# Expects: PROJECT_ROOT set by the caller. Honors ENV_PROD_BACKUP (which operator
# backup to read), AISHA_PROFILE (default cloud-multi inside the resolver) and
# MESH_ENABLED.
# =============================================================================

if [[ -z "${PROJECT_ROOT:-}" ]]; then
  echo "FATAL: resolve-domains-env.sh requires PROJECT_ROOT to be set" >&2
  exit 2
fi

# 1) Operator env foundation (same file cold-start treats as authoritative).
#
# ⛔ KTERÝ SOUBOR: záloha PROSTŘEDÍ TOHOTO BĚHU — `ENV_PROD_BACKUP`, je-li v prostředí,
# jinak `.env-prod-backup` v kořeni stromu. Totéž pravidlo má cold-start (načítá
# `$ENV_PROD_BACKUP`) i doktor; cold-start proměnnou dětem exportuje.
#
# NAMĚŘENO 2026-10-04 (recenze pořadí kroků): tady stálo napevno `.env-prod-backup`
# z kořene. V produkčním běhu je to týž soubor, který načetl cold-start. V NE-produkčním
# (záloha prostředí v ENV_PROD_BACKUP, v kořeni sdíleného stromu leží produkční) se tu
# ale načetla PRODUKČNÍ záloha a se `set -a` přepsala hodnoty zděděné od cold-startu:
# story-init pak pracoval s jiným projektem Coolify, jinou adresou Forgeja i jinou
# větví (GIT_BRANCH) než krok 2b2, který běh před wipem ověřoval. Díra v izolaci
# prostředí, ne jen v pořadí. Bez ENV_PROD_BACKUP (samostatné spuštění) se nic nemění.
#
# Výraz stojí na řádku se `source` SCHVÁLNĚ celý (ne přes pomocnou proměnnou): brána
# env-file-source-guard hledá jméno souboru na tom řádku a hlídá, že je pod `set +e`.
if [[ -f "${ENV_PROD_BACKUP:-$PROJECT_ROOT/.env-prod-backup}" ]]; then
  # GUARD: .env-prod-backup may hold unquoted multi-word secrets (COSMOS_SIGNER_MNEMONIC,
  # a BIP39 phrase) that word-split under `set -e` and abort the CALLER that sources this
  # lib. Disable -e/-u for the source, then restore the caller's prior flags exactly.
  _aisha_save="$-"; set +eu; set -a
  # shellcheck source=/dev/null
  . "${ENV_PROD_BACKUP:-$PROJECT_ROOT/.env-prod-backup}" 2>/dev/null || true
  set +a; case "$_aisha_save" in *e*) set -e;; esac; case "$_aisha_save" in *u*) set -u;; esac; unset _aisha_save
elif [[ -n "${ENV_PROD_BACKUP:-}" && "$ENV_PROD_BACKUP" != "/dev/null" ]]; then
  # Výslovně jmenovaná záloha, která není: NEČTE se místo ní záloha z kořene (to by byl
  # přesně ten přepis výš) — a nemlčí se o tom, že prostředí obsluhy načtené není.
  echo "WARN: resolve-domains-env.sh: ENV_PROD_BACKUP=${ENV_PROD_BACKUP} neexistuje — prostředí obsluhy nenačteno (záloha v kořeni stromu se místo ní nečte)" >&2
fi

# 2) Topology resolver — the domain SoT. No fallback on failure (fail-loud).
if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: node not found on PATH — the topology resolver (scripts/lib/derive-domains.mjs) is required to determine the expected domain surface" >&2
  exit 2
fi
_AISHA_TOPOLOGY_ENV="$(mktemp -t aisha-topology.XXXXXX)"
if ! node "$PROJECT_ROOT/scripts/lib/derive-domains.mjs" --shell > "$_AISHA_TOPOLOGY_ENV"; then
  rm -f "$_AISHA_TOPOLOGY_ENV"
  echo "FATAL: topology resolver failed — cannot determine the expected domain surface (set PUBLIC_TLD/INTERNAL_TLD/MESH_TLD or fix config/profiles)" >&2
  exit 2
fi
set -a
# shellcheck source=/dev/null
. "$_AISHA_TOPOLOGY_ENV"
set +a
rm -f "$_AISHA_TOPOLOGY_ENV"

# 2b) Akcelerační vrstva (GPU uzel) — ACCEL_* z deklarace uzlu v datech instance. Jako topologie
# PO záloze obsluhy: odvozená hodnota přebije zastaralou ze zálohy (story-init se podle ní ptá
# brány provisioningu). Parser, ne `source`. Vadná deklarace = fail-loud (exit 2).
# shellcheck source=accel-vrstva-env.sh
. "$PROJECT_ROOT/scripts/lib/accel-vrstva-env.sh"
if ! nacti_env_vrstvy_accel "$PROJECT_ROOT"; then
  echo "FATAL: deklaraci GPU uzlu (accel/uzel.json v datech instance) nejde vyložit — lane vrstvy nevím" >&2
  exit 2
fi

# 3) domains.env — composite values expand against the populated *_DOMAIN env.
if [[ -f "$PROJECT_ROOT/config/domains.env" ]]; then
  # GUARD (same rationale as the .env-prod-backup source above): survive any unquoted
  # multi-word value without aborting the sourcing caller; restore prior flags.
  _aisha_save="$-"; set +eu; set -a
  # shellcheck source=/dev/null
  . "$PROJECT_ROOT/config/domains.env" 2>/dev/null || true
  set +a; case "$_aisha_save" in *e*) set -e;; esac; case "$_aisha_save" in *u*) set -u;; esac; unset _aisha_save
fi
