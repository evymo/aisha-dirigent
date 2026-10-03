#!/usr/bin/env bash
# =============================================================================
# verify-cold-start-apply.sh — faithful cold-start migration apply gate
# =============================================================================
# Proves the generated baseline + every non-baked delta apply cleanly, in the
# exact order the production runner uses, against a real PostgreSQL with the
# platform substrate — then asserts the audience-module invariants.
#
# This is the systemic guard for the failure class that static tests cannot
# see: a migration that `DROP ... CASCADE`s a view/table whose dependents are
# only dereferenced by a LATER migration. Such a gap is invisible until the
# whole chain is applied in order under `psql ON_ERROR_STOP=1` — which is
# exactly what scripts/db/migrate.mjs (the real runner, invoked below) does.
#
# Usage:
#   AISHA_DB_URL=postgres://user:pw@host:5432/db bash scripts/db/verify-cold-start-apply.sh
#
# Requirements (all present in CI ubuntu-latest after setup):
#   - psql (postgresql-client)
#   - node (to run the real migrate.mjs runner)
#   - a postgres reachable via AISHA_DB_URL, with the connecting role a
#     SUPERUSER (substrate creates roles/schemas/extensions), and the server
#     started with shared_preload_libraries including pgaudit + pg_stat_statements
#     (the platform postgresql.conf does this; see infra/postgres/).
#
# Exits non-zero (loudly) on the FIRST apply error or any missing invariant.
# There is no skip path: an empty/no-op run fails the table-count assertion.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUBSTRATE="$ROOT/infra/postgres/000_init_roles_schemas.sql"

: "${AISHA_DB_URL:?AISHA_DB_URL must be set (postgres connection string)}"
PSQL=(psql "$AISHA_DB_URL" -v ON_ERROR_STOP=1 -tA)

echo "── 1/5  apply platform substrate (idempotent) ──────────────────────────"
# Roles/schemas/extensions/auth+storage stubs the baseline assumes exist.
# Idempotent (CREATE ... IF NOT EXISTS / OR REPLACE / guarded DO blocks).
psql "$AISHA_DB_URL" -v ON_ERROR_STOP=1 -q -f "$SUBSTRATE" >/dev/null
echo "   substrate applied"

echo "── 2/5  apply baseline + all non-baked deltas (real runner) ────────────"
# Use the PRODUCTION runner so we test the actual code path, not a copy.
# migrate.mjs applies baseline, marks baseline-baked migrations, then runs the
# remaining deltas in lexicographic order, each with psql ON_ERROR_STOP=1,
# and process.exit(1)s on the first failure.
( cd "$ROOT" && node scripts/db/migrate.mjs )

echo "── 3/5  schema sanity ──────────────────────────────────────────────────"
tbls=$("${PSQL[@]}" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
echo "   public base tables: $tbls"
if [ "${tbls:-0}" -lt 200 ]; then
  echo "❌ expected >=200 public base tables (baseline did not apply); got $tbls"; exit 1
fi

echo "── 4/5  audience-module invariants ─────────────────────────────────────"
fail=0
require_view() {
  local v="$1"
  local got
  got=$("${PSQL[@]}" -c "SELECT to_regclass('public.$1');")
  if [ -z "$got" ]; then echo "   ❌ MISSING view/relation: $1"; fail=1; else echo "   ✓ $1"; fi
}
# The full audience admin view set — the 4 marked (*) are the ones a buggy
# DROP ... CASCADE in 20260524100000 previously orphaned; they must survive.
require_view audience_actor_aggregate_latest_v
require_view audience_actor_tier_v               # (*)
require_view audience_actor_overlay_v
require_view audience_admin_contact_directory_v  # (*)
require_view audience_admin_cohort_overview_v    # (*)
require_view audience_admin_tier_funnel_v        # (*)
require_view audience_admin_actor_detail_v       # (*)
require_view audience_admin_campaign_performance_v
require_view audience_admin_signal_feed_v
require_view audience_admin_followup_queue_v
require_view audience_admin_communication_log_v
# Lovable compat layer (references the views above — fails to create if any orphaned).
require_view audience_admin_teachers_v
require_view audience_admin_accounts_v
require_view audience_admin_activities_v

require_function() {
  local f="$1"
  local got
  got=$("${PSQL[@]}" -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$1';")
  if [ "${got:-0}" -lt 1 ]; then echo "   ❌ MISSING fn: $1"; fail=1; else echo "   ✓ $1"; fi
}

# Universal source-federation provisioning RPC must exist and be de-tenant'd.
require_function audience_provision_federated_member

# Twin-pulse carrier + verbs. The beat is the one stroke of the pulse with no
# other home (subject ≠ addressee), so a cold start that silently lacks it would
# leave every follow-up without its ledger entry.
require_view story_pulse_beats
require_function create_pulse_beat_audited
require_function close_pulse_beat_audited
require_function append_subject_entry_service
require_function get_subject_timeline
require_function audience_admin_complete_followup
require_function grant_story_role_audited
require_function revoke_story_role_audited

# Grant-leak invariant (SEC-F4b): the platform's OWN audience_audit_grants() must
# report ZERO CRITICAL violations against the ASSEMBLED baseline. This is the guard
# the static audience-tests gate cannot give — that gate applies only the bare
# 2026052*.sql migrations, never the baseline's fix_missing_table_grants.sql blanket
# loop. A blanket `GRANT SELECT ... TO anon` that re-leaks an audience operator
# relation (invariant I3) is invisible to static checks but fails loudly here,
# because this runs against the real catalog after the full baseline applies.
crit=$("${PSQL[@]}" -c "SELECT count(*) FROM public.audience_audit_grants() WHERE severity='CRITICAL';")
if [ "${crit:-1}" -ne 0 ]; then
  echo "   ❌ audience_audit_grants() reports ${crit} CRITICAL grant violation(s) on the applied baseline:"
  psql "$AISHA_DB_URL" -v ON_ERROR_STOP=1 -c "SELECT * FROM public.audience_audit_grants() WHERE severity='CRITICAL';" || true
  fail=1
else
  echo "   ✓ audience_audit_grants(): 0 CRITICAL grant violations (anon least-privilege holds)"
fi

# De-tenant invariant: NOTHING instance-specific may exist in the applied schema.
# The platform names no instance — pass the identifier to grep for via
# VERIFY_TENANT_LEAK_IDENT (e.g. an instance codename); skipped when unset.
if [ -n "${VERIFY_TENANT_LEAK_IDENT:-}" ]; then
  leak=$("${PSQL[@]}" -c "
    SELECT
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname ~* '${VERIFY_TENANT_LEAK_IDENT}')
    + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.prokind<>'a'
           AND (p.proname ~* '${VERIFY_TENANT_LEAK_IDENT}' OR pg_get_functiondef(p.oid) ~* '${VERIFY_TENANT_LEAK_IDENT}'))
    + (SELECT count(*) FROM pg_views WHERE schemaname='public'
         AND (viewname ~* '${VERIFY_TENANT_LEAK_IDENT}' OR definition ~* '${VERIFY_TENANT_LEAK_IDENT}'));")
  if [ "${leak:-1}" -ne 0 ]; then echo "   ❌ ${VERIFY_TENANT_LEAK_IDENT}-specific identifiers leaked into schema: $leak"; fail=1; else echo "   ✓ zero ${VERIFY_TENANT_LEAK_IDENT} identifiers in applied schema"; fi
fi

echo "── 5/5  DB-security invariants (definer + RLS self-reference + FK-relationship gaps) ─"
# Both DB_SECURITY_INVARIANTS.md invariants, catalog-checked against the APPLIED
# cold-start schema (access.mjs --static, in CI, only lints sql/functions/ — these
# read the real catalog, which knows the post-REVOKE grant state and the deparsed RLS
# expressions that migration text cannot reconstruct). Each is identity-allowlisted;
# fail on any NEW violation. AISHA_DB_URL is exported above, so the checkers inherit it.
#
#  (a) check-definer-rpc-security  — SECURITY DEFINER fns exposed PUBLIC/anon, no-auth,
#      not-trigger, NOT in sql/functions/ (access.mjs's migration blind spot).
#  (b) check-rls-self-reference    — RLS policies querying their own table (42P17 risk).
#  (c) check-fk-relationship-gaps  — `*_id` columns with no FK constraint that a precision
#      signal (FK-elsewhere / <stem> table exists) says should be a relationship (the
#      "DB architect" lens; identity-keyed snapshot guards against NEW unenforced vazby).
if ( cd "$ROOT" && node scripts/db/check-definer-rpc-security.mjs ); then
  echo "   ✓ definer: no unreviewed migration-defined RPC footguns"
else
  echo "   ❌ definer: migration-defined RPC footgun detected (see above)"; fail=1
fi
if ( cd "$ROOT" && node scripts/db/check-rls-self-reference.mjs ); then
  echo "   ✓ RLS: no unreviewed self-references"
else
  echo "   ❌ RLS: self-reference detected (see above)"; fail=1
fi
if ( cd "$ROOT" && node scripts/db/check-fk-relationship-gaps.mjs ); then
  echo "   ✓ FK-gaps: no unreviewed unenforced relationships"
else
  echo "   ❌ FK-gaps: new unenforced relationship detected (see above)"; fail=1
fi
#  (d) audience_audit_grants  — the audience grant-invariant engine (I1-I6): no
#      PUBLIC/anon EXECUTE on audience fns, broker-only writes unreachable by
#      `authenticated`, no under-grant to service_role/broker. Run against the
#      APPLIED catalog (the function lives in the baseline). This is the always-on
#      home for the grant audit: audience-tests.yml's postgres:16 job globbed
#      `2026052*` migrations that were baseline-absorbed to archive/, so its
#      auditor became a silent no-op. FAIL LOUD if the function is missing —
#      a silently-absent grant auditor is the exact dead-gate class this replaces.
audit_viol=$(psql "$AISHA_DB_URL" -tAc \
  "SELECT count(*) FROM public.audience_audit_grants() WHERE severity IN ('CRITICAL','HIGH')" 2>/dev/null)
if [ -z "$audit_viol" ]; then
  echo "   ❌ audience-grants: audience_audit_grants() did not run (missing from catalog) — the gate must never be silently green"; fail=1
elif [ "$audit_viol" -gt 0 ]; then
  echo "   ❌ audience-grants: $audit_viol CRITICAL/HIGH grant violation(s):"
  psql "$AISHA_DB_URL" -c \
    "SELECT severity, invariant, object_name, problem FROM public.audience_audit_grants() WHERE severity IN ('CRITICAL','HIGH')" \
    2>/dev/null | sed 's/^/      /'
  fail=1
else
  echo "   ✓ audience-grants: no PUBLIC/anon EXECUTE; broker-only writes least-privilege (audience_audit_grants)"
fi

echo "── schema-contract tests (pgTAP) ───────────────────────────────────────"
# In-DB assertions over the applied schema (structure + enforced relationships).
# Each test file CREATE EXTENSIONs pgtap inside a rolled-back txn, so nothing
# persists in the asserted schema. Requires postgresql-17-pgtap in the image.
if ( cd "$ROOT" && node scripts/db/run-schema-tests.mjs ); then
  echo "   ✓ pgTAP: schema-contract assertions hold"
else
  echo "   ❌ pgTAP: schema-contract assertion failed (see above)"; fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "❌ cold-start apply gate FAILED — see missing invariants above"; exit 1
fi
echo "✅ cold-start apply gate PASSED — baseline + all deltas apply clean; audience invariants hold; DB-security counts within baseline"
