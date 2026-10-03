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
#   1. operator env  — .env-prod-backup (TLDs, OAUTH2_*, overrides), if present
#   2. resolver      — scripts/lib/derive-domains.mjs --shell (all *_DOMAIN)
#   3. domains.env   — composite refs (KEYCLOAK_URL=https://${KEYCLOAK_DOMAIN})
#                      expand against the now-populated env
#
# Fail-loud: if the resolver cannot run (node missing, profile broken), the
# caller exits non-zero — a health check that cannot determine the expected
# surface must not pretend to be green.
#
# Expects: PROJECT_ROOT set by the caller. Honors AISHA_PROFILE (default
# cloud-multi inside the resolver) and MESH_ENABLED.
# =============================================================================

if [[ -z "${PROJECT_ROOT:-}" ]]; then
  echo "FATAL: resolve-domains-env.sh requires PROJECT_ROOT to be set" >&2
  exit 2
fi

# 1) Operator env foundation (same file cold-start treats as authoritative).
if [[ -f "$PROJECT_ROOT/.env-prod-backup" ]]; then
  # GUARD: .env-prod-backup may hold unquoted multi-word secrets (COSMOS_SIGNER_MNEMONIC,
  # a BIP39 phrase) that word-split under `set -e` and abort the CALLER that sources this
  # lib. Disable -e/-u for the source, then restore the caller's prior flags exactly.
  _aisha_save="$-"; set +eu; set -a
  # shellcheck source=/dev/null
  . "$PROJECT_ROOT/.env-prod-backup" 2>/dev/null || true
  set +a; case "$_aisha_save" in *e*) set -e;; esac; case "$_aisha_save" in *u*) set -u;; esac; unset _aisha_save
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

# 3) domains.env — composite values expand against the populated *_DOMAIN env.
if [[ -f "$PROJECT_ROOT/config/domains.env" ]]; then
  # GUARD (same rationale as the .env-prod-backup source above): survive any unquoted
  # multi-word value without aborting the sourcing caller; restore prior flags.
  _aisha_save="$-"; set +eu; set -a
  # shellcheck source=/dev/null
  . "$PROJECT_ROOT/config/domains.env" 2>/dev/null || true
  set +a; case "$_aisha_save" in *e*) set -e;; esac; case "$_aisha_save" in *u*) set -u;; esac; unset _aisha_save
fi
