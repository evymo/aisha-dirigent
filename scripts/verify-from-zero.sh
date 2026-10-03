#!/usr/bin/env bash
# ==============================================================================
# verify-from-zero.sh — canonical "does the CURRENT repo work, from scratch?" gate
# ==============================================================================
#
# The ONLY authoritative "it works" signal for the local stack: nothing is trusted
# from an existing/dirty DB. Wiping the local DB is EXPECTED and fine — the whole
# point is to prove the current source-of-truth regenerates a working system from
# zero (DB + TS types + seed + boot + tests).
#
# Each step is an existing, individually-runnable tool (this only orchestrates):
#
#   0. env doctor (--omni-mode)        — required env vars / modes present (preflight)
#   1. db:init:generate                — regenerate baseline.sql from aisha/db/sql/ SoT
#   2. FORCE_BASELINE_RESET migrate    — DROP public + re-apply baseline + heals
#                                        (halfvec-clean: bare opclass/type + baseline
#                                         owns search_path → no manual DROP recipe)
#   3. db:seed:local                   — apply the committed seed.compiled.sql (demo
#                                        profile; compiled from seed/ sources via
#                                        `npm run db:seed:compile` in CI/setup — NOT
#                                        recompiled here, so the working tree stays clean
#                                        and the canonical committed seed is what's tested)
#   4. db:types:gen:local              — regenerate TS types from the fresh schema
#                                        (web + mobile dual-emit)
#   5. omni-local-verify.sh            — seed omni PAT + boot svc-ai-chat + run the
#                                        acceptance + pgTAP + e2e triad
#
# Existing-DB note (NOT exercised here, documented for operators): deployed DBs are
# NEVER wiped — migrate.mjs adopts the baseline (NULL checksum), replays only
# non-absorbed deltas, and re-runs aisha/db/heals.sql every invocation; functions
# overlay via CREATE OR REPLACE. `npm run db:convergence:verify` proves a fresh
# baseline-built DB is schema-equivalent to a migrated one. This script is the
# FRESH-DB half of that contract.
#
# Usage:
#   bash scripts/verify-from-zero.sh                 # full from-zero (regen→reset→seed→types→triad)
#   bash scripts/verify-from-zero.sh --skip-triad    # stop after DB+types are rebuilt (no boot)
#   bash scripts/verify-from-zero.sh --no-env-doctor # skip step 0 preflight
#   AISHA_LOCAL_DB_URL=… bash scripts/verify-from-zero.sh   # override DB target
#
# Requires: Node 22 (.nvmrc), Docker Desktop (local stack on :54322), host psql.
# ==============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

G="\033[0;32m"; R="\033[0;31m"; Y="\033[1;33m"; D="\033[0;90m"; NC="\033[0m"
step() { echo -e "${Y}━━━ $* ━━━${NC}"; }
die()  { echo -e "${R}✗ $*${NC}"; exit 1; }

SKIP_TRIAD=0; RUN_ENV_DOCTOR=1
for a in "$@"; do
  case "$a" in
    --skip-triad)    SKIP_TRIAD=1 ;;
    --no-env-doctor) RUN_ENV_DOCTOR=0 ;;
    *) echo "unknown arg: $a"; exit 2 ;;
  esac
done

# ── Node 22 + Docker on PATH (off-PATH on this host) ────────────────────────
for d in /Applications/Docker.app/Contents/Resources/bin /usr/local/bin /opt/homebrew/bin; do
  [ -x "$d/docker" ] && case ":$PATH:" in *":$d:"*) ;; *) export PATH="$d:$PATH";; esac
done
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 && nvm use 22 >/dev/null 2>&1 || true

# ── DB target: build AISHA_LOCAL_DB_URL from .env.local.dev unless overridden ─
# seed.mjs/migrate.mjs/gen-types.mjs all read AISHA_LOCAL_DB_URL (default 57422);
# the local-warmup stack is on LOCAL_DB_PORT (54322) with POSTGRES_PASSWORD.
if [ -z "${AISHA_LOCAL_DB_URL:-}" ]; then
  ENVF="$ROOT/.env.local.dev"
  [ -f "$ENVF" ] || die ".env.local.dev not found — set AISHA_LOCAL_DB_URL explicitly"
  PW="$(grep -E '^POSTGRES_PASSWORD=' "$ENVF" | head -1 | sed 's/^[^=]*=//' | tr -d '"'"'"'')"
  PORT="$(grep -E '^LOCAL_DB_PORT=' "$ENVF" | head -1 | sed 's/^[^=]*=//' | tr -d '"'"'"' ' || true)"
  PORT="${PORT:-54322}"
  [ -n "$PW" ] || die "POSTGRES_PASSWORD missing in .env.local.dev"
  export AISHA_LOCAL_DB_URL="postgresql://postgres:${PW}@127.0.0.1:${PORT}/postgres"
fi
SAFE_URL="$(echo "$AISHA_LOCAL_DB_URL" | sed -E 's#(://[^:]+:)[^@]+@#\1***@#')"
echo -e "${D}node $(node -v 2>/dev/null) · DB → ${SAFE_URL}${NC}"

# ── 0. Env doctor (preflight) ───────────────────────────────────────────────
if [ "$RUN_ENV_DOCTOR" = "1" ]; then
  step "[0/5] env doctor (--omni-mode, dry-run preflight)"
  node scripts/aisha-env-doctor.mjs --omni-mode --dry-run --local 2>&1 | tail -20 || \
    echo -e "${D}env doctor reported issues (non-fatal preflight) — see above${NC}"
fi

# ── 1. Regenerate baseline from SoT (never hand-edited) ─────────────────────
step "[1/5] regenerate baseline ← aisha/db/sql/ (db:init:generate)"
npm run db:init:generate 2>&1 | tail -3 || die "baseline regen failed"

# ── 2. Fresh DB: DROP public + baseline + heals (halfvec-clean reset) ───────
step "[2/5] FORCE_BASELINE_RESET — fresh DB from baseline + heals"
AISHA_DB_FORCE_BASELINE_RESET=1 npm run db:migrate:local 2>&1 | tail -6 || die "baseline reset failed"

# ── 3. Seed the committed (canonical) seed.compiled.sql ─────────────────────
# Applies the committed seed.compiled.sql AS-IS — it is NOT recompiled here, because
# compile-seed.mjs is profile-dependent (committed = demo) and would rewrite that
# tracked file to whatever AISHA_SEED_PROFILE resolves to, dirtying the working tree.
# Seed-source compilation is validated separately by `npm run db:seed:compile`.
step "[3/5] seed (db:seed:local — committed seed.compiled.sql)"
npm run db:seed:local 2>&1 | tail -3 || die "seed failed"

# ── 4. Regenerate TS types from the fresh schema ────────────────────────────
step "[4/5] regenerate TS types (db:types:gen:local — web + mobile)"
npm run db:types:gen:local 2>&1 | tail -4 || die "types regen failed"

# ── 5. Boot + verify triad (PAT seed + acceptance + pgTAP + e2e) ────────────
if [ "$SKIP_TRIAD" = "1" ]; then
  echo -e "${G}DB + types rebuilt from zero (--skip-triad: stopping before boot).${NC}"
  exit 0
fi
step "[5/5] omni triad (omni-local-verify.sh — PAT seed + boot + acceptance/pgTAP/e2e)"
bash scripts/test/omni-local-verify.sh || die "omni triad failed"

echo -e "${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${G}✓ from-zero verification complete — current repo regenerates a working stack.${NC}"
