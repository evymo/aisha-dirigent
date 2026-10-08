#!/usr/bin/env bash
# =============================================================================
# verify-upgrade-apply.sh — UPGRADE-PATH gate (existing-DB reconcile)
# =============================================================================
# The blind spot that let fe939cf1 break prod twice: CI's cold-start gate only
# ever migrates + seeds a FRESH database. On a fresh DB the baseline CREATE TABLE
# adds the new column (claude_hook_bindings.config), so the seed finds it and
# passes. But the baseline is NEVER re-applied to an EXISTING DB (it is recorded
# with a NULL checksum so drift detection skips it; only the destructive
# AISHA_DB_FORCE_BASELINE_RESET re-runs it, and registry deltas are blocked by
# the baseline-only invariant). So a schema change folded into the baseline +
# referenced by the seed never reaches DBs created before the fold → prod
# redeploys failed at db:seed: `column "config" ... does not exist`.
#
# This gate reproduces that EXACT condition and proves the fix end-to-end:
#   1. build a probe DB via the REAL runner (substrate → migrate.mjs)
#   2. REGRESS it to the pre-fold state — drop the surface heals.sql reconciles
#      (claude_hook_bindings.config, agent_runs.inputs, the agent-activity /
#      ai-spend tables). This is what an existing pre-fold prod DB looks like.
#   3. re-run the REAL runner (migrate.mjs → no-pending path → heals.sql) — the
#      exact code path a prod redeploy takes — and assert the surface is back.
#   4. apply the REAL seed (aisha/db/seed.compiled.sql) — the exact step that
#      failed in prod — and assert it succeeds.
#
# Without heals.sql (or with an incomplete one) step 4 fails on the missing
# column, RED here instead of in production.
#
# Usage (CI coldstart-db-gate, real Postgres):
#   AISHA_DB_URL=postgres://postgres:ci@localhost:5432/postgres \
#     bash scripts/db/verify-upgrade-apply.sh
#
# AISHA_DB_URL must be an ADMIN connection (to the maintenance `postgres` db) on
# the cluster; this script creates + drives a throwaway `aisha_upgrade_probe` DB
# on the SAME cluster (reuses the coldstart container — no extra container).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUBSTRATE="$ROOT/infra/postgres/000_init_roles_schemas.sql"
SEED="$ROOT/aisha/db/seed.compiled.sql"
VERIFY_PUBLIC="$ROOT/scripts/db/verify-schema-public-create.sql"
VERIFY_PUBLIC_ACL="$ROOT/scripts/db/verify-schema-public-acl.sql"

: "${AISHA_DB_URL:?AISHA_DB_URL must be set (admin connection to the postgres db)}"
ADMIN_URL="$AISHA_DB_URL"
PROBE_DB="aisha_upgrade_probe"
PROBE_URL="${ADMIN_URL%/*}/$PROBE_DB"
RESET_DB="aisha_reset_probe"
RESET_URL="${ADMIN_URL%/*}/$RESET_DB"

scalar() { psql "$PROBE_URL" -v ON_ERROR_STOP=1 -tA -c "$1"; }
# Čtecí kontrola schématu public — PŘESNĚ tak, jak ji pouští živé ověření: v transakci
# jen pro čtení. Tady běží vedle zkoušky chováním a musí se s ní shodnout; čtecí
# kontrola, která by byla zelená tam, kde chování ukáže díru, by nad produkcí lhala.
verify_public_acl() { PGOPTIONS="-c default_transaction_read_only=on" psql "$1" -v ON_ERROR_STOP=1 -q -f "$VERIFY_PUBLIC_ACL"; }

cleanup() {
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS $PROBE_DB WITH (FORCE);" >/dev/null 2>&1 || true
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS $RESET_DB WITH (FORCE);" >/dev/null 2>&1 || true
  psql "$ADMIN_URL" -q -c "DROP ROLE IF EXISTS aisha_probe_udelovatel;" \
    -c "DROP ROLE IF EXISTS aisha_probe_vlastnik;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "── 1/6  fresh probe DB + substrate ─────────────────────────────────────"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $PROBE_DB WITH (FORCE);"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $PROBE_DB;"
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q -f "$SUBSTRATE" >/dev/null
# Značka běhu jako na produkci. Vstupní skript migrace (write_running_marker
# v scripts/docker-migrate-entrypoint.sh) ji v public zakládá PŘED migrací; na
# čisté databázi kvůli ní migrate.mjs vidí „tabulky bez baseline“ a schéma public
# RESETUJE. Studený start tedy vede přes reset VŽDY — bez značky by sonda tu
# cestu nikdy neprošla a vadu v SQL resetu by ukázala až skutečná instance.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q -c "CREATE TABLE public.migration_log_dump (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), status TEXT, exit_code INT, output TEXT);"
echo "   probe DB created, substrate applied, run marker present (as on a real cold start)"

echo "── 1b   reset schématu public: vytvářet smí jen vyjmenovaná role ───────"
# SQL resetu SAMOTNÉ, na vlastní zahazované databázi téhož clusteru (role jsou
# společné celému clusteru, založil je substrát výš). Sonda níž ho neukáže: v kroku
# 2 po resetu hned běží heals a práva dorovnají, takže vada v resetu by za nimi
# zmizela. Stojí PŘED krokem 2 — levná kontrola má selhat dřív než drahá.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $RESET_DB WITH (FORCE);"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP ROLE IF EXISTS aisha_probe_udelovatel;" -c "DROP ROLE IF EXISTS aisha_probe_vlastnik;"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $RESET_DB;"
( cd "$ROOT" && node -e 'import("./scripts/db/lib/reset-public-schema.mjs").then((m) => process.stdout.write(m.RESET_PUBLIC_SCHEMA_SQL))' ) \
  | psql "$RESET_URL" -v ON_ERROR_STOP=1 -q -f - >/dev/null
psql "$RESET_URL" -v ON_ERROR_STOP=1 -q -f "$VERIFY_PUBLIC"
verify_public_acl "$RESET_URL"
echo "   ✓ po resetu vytváří ve schématu public jen vyjmenovaná role; role API mají USAGE (chováním i čtením)"

echo "── 1c   heal schématu public migraci NEZASTAVÍ ─────────────────────────"
# Zastavená migrace je nenasazené jádro — heal proto zbylé právo jen OHLÁSÍ a
# doběhne; natvrdo ho hlídá kontrola (tady v kroku 5 a po nasazení). Stav, který
# heal sám nespraví: CREATE pro PUBLIC udělila jiná role a heal pouští role, která
# se jí stát nesmí (ne-superuživatelský vlastník schématu). SET SESSION
# AUTHORIZATION dává relaci přesně takovou přihlášenou roli — SET ROLE uvnitř
# healu se řídí jí, ne tím, kdo se původně připojil.
psql "$RESET_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE aisha_probe_udelovatel NOLOGIN;
CREATE ROLE aisha_probe_vlastnik NOLOGIN;
GRANT CREATE ON SCHEMA public TO aisha_probe_udelovatel WITH GRANT OPTION;
SET ROLE aisha_probe_udelovatel;
GRANT CREATE ON SCHEMA public TO PUBLIC;
RESET ROLE;
ALTER SCHEMA public OWNER TO aisha_probe_vlastnik;
SQL
heal_out=$( { echo "SET SESSION AUTHORIZATION aisha_probe_vlastnik;"; cat "$ROOT/aisha/db/sql/grants/schema_public_create.sql"; } \
  | psql "$RESET_URL" -v ON_ERROR_STOP=1 -q -f - 2>&1 ) && heal_rc=0 || heal_rc=$?
if [ "$heal_rc" -ne 0 ]; then
  echo "❌ heal schématu public migraci ZASTAVIL (rc=$heal_rc) nad právem, které odvolat nemůže — má ho ohlásit a doběhnout:"
  echo "$heal_out"; exit 1
fi
case "$heal_out" in
  *WARNING*aisha_probe_udelovatel*) ;;
  *) echo "❌ heal doběhl, ale zbylé právo NEOHLÁSIL varováním s udělovatelem:"; echo "$heal_out"; exit 1 ;;
esac
verify_out=$(psql "$RESET_URL" -v ON_ERROR_STOP=1 -q -f "$VERIFY_PUBLIC" 2>&1) && verify_rc=0 || verify_rc=$?
case "$verify_rc:$verify_out" in
  0:*) echo "❌ kontrola schématu public PROŠLA nad právem, které heal odvolat nemohl — zbylou díru by nezastavilo nic"; exit 1 ;;
  *"PUBLIC má ve schématu public právo CREATE"*) ;;
  *) echo "❌ kontrola schématu public selhala z jiného důvodu než kvůli zbylému právu (rc=$verify_rc): $verify_out"; exit 1 ;;
esac
acl_out=$(verify_public_acl "$RESET_URL" 2>&1) && acl_rc=0 || acl_rc=$?
case "$acl_rc:$acl_out" in
  0:*) echo "❌ čtecí kontrola schématu public PROŠLA tam, kde zkouška chováním ukázala díru — živé ověření by ji nevidělo"; exit 1 ;;
  *"PUBLIC má ve schématu public právo CREATE"*) ;;
  *) echo "❌ čtecí kontrola schématu public selhala z jiného důvodu než kvůli díře (rc=$acl_rc): $acl_out"; exit 1 ;;
esac
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $RESET_DB WITH (FORCE);"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP ROLE IF EXISTS aisha_probe_udelovatel;" -c "DROP ROLE IF EXISTS aisha_probe_vlastnik;"
echo "   ✓ heal nad právem, které odvolat nemůže, DOBĚHL a ohlásil udělovatele; kontrola zbylé právo vidí"

echo "── 2/6  build full schema via the REAL runner (baseline + heals) ───────"
( cd "$ROOT" && AISHA_DB_URL="$PROBE_URL" node scripts/db/migrate.mjs )
# Kontrolní vzorek cesty: značka je pryč → reset schématu opravdu proběhl.
if [ -n "$(scalar "SELECT to_regclass('public.migration_log_dump');")" ]; then
  echo "❌ setup error: značka běhu přežila migraci — reset schématu public neproběhl, sonda nejde cestou studeného startu"; exit 1
fi

echo "── 3/6  REGRESS to the pre-fold existing-DB state ──────────────────────"
# Regress to what an EXISTING pre-fold prod DB actually looks like: the agent-
# activity surface absent, AND the 61 generational tables present-but-OLDER
# (missing later-added columns) — the real failure class. Two regression shapes
# below: COLUMN-DRIFT (tables stripped of attribute columns) + FULLY-MISSING
# (whole-dropped tables + 9 enums). Keep in lockstep with aisha/db/heals.sql.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
ALTER TABLE public.claude_hook_bindings DROP COLUMN IF EXISTS config;
ALTER TABLE public.agent_runs            DROP COLUMN IF EXISTS inputs;
DROP TABLE IF EXISTS public.agent_phase_catalog  CASCADE;
DROP TABLE IF EXISTS public.agent_live_sessions  CASCADE;
DROP TABLE IF EXISTS public.ai_cost_class_catalog CASCADE;
DROP TABLE IF EXISTS public.ai_spend_policies    CASCADE;
-- #422 pre-request hook (the 409 fix) — absent on a pre-fold existing DB
DROP FUNCTION IF EXISTS public.aisha_pre_request() CASCADE;

-- ── pre-Brick2 shape: NO ai_model_registry at all ───────────────────────────
-- The registry heal block creates it; the Brick2-guard (knowledge_embeddings FK
-- columns + backfill) must therefore run AFTER that block — with the guard placed
-- BEFORE it, this regress aborts the whole heals run (the incident class heals'
-- own comment mis-claimed away: "established earlier in heals").
DROP TABLE IF EXISTS public.ai_model_registry CASCADE;

-- ── pre-Brick3..6 shape: RAG locale/tier axis absent ────────────────────────
-- locale ships INLINE in the baseline CREATE TABLE for chunks/embeddings (no
-- ALTER in the table SoT), so no heal ever delivered it; the narrow unique
-- arbiters and narrow RPC overloads are what a pre-brick DB actually carries.
ALTER TABLE public.knowledge_items      DROP COLUMN IF EXISTS locale CASCADE;
ALTER TABLE public.knowledge_items      DROP COLUMN IF EXISTS minimum_tier CASCADE;
ALTER TABLE public.knowledge_items      DROP COLUMN IF EXISTS source_concept_id CASCADE;
ALTER TABLE public.knowledge_chunks     DROP COLUMN IF EXISTS locale CASCADE;
ALTER TABLE public.knowledge_embeddings DROP COLUMN IF EXISTS locale CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_knowledge_item_id_chunk_index_key
  ON public.knowledge_chunks USING btree (knowledge_item_id, chunk_index);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_embeddings_chunk_id_key
  ON public.knowledge_embeddings USING btree (chunk_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_items_source_unique
  ON public.knowledge_items USING btree (source_type, source_id)
  WHERE (source_type = 'guild_db'::text);
-- narrow pre-Brick4 RPC overloads (stubs — the SHAPE is what PostgREST resolves
-- against; heals must drop every historical overload and re-apply the canonical
-- SoT, or locale-passing callers get PGRST202 / subset callers PGRST203)
DROP FUNCTION IF EXISTS public.insert_knowledge_chunk(integer, text, uuid, text, text, integer, text) CASCADE;
CREATE FUNCTION public.insert_knowledge_chunk(p_chunk_index integer, p_chunk_text text, p_knowledge_item_id uuid, p_section_title text DEFAULT NULL, p_source_field text DEFAULT 'body', p_token_count integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
DROP FUNCTION IF EXISTS public.insert_knowledge_embedding(uuid, text, uuid, text, text, text) CASCADE;
CREATE FUNCTION public.insert_knowledge_embedding(p_chunk_id uuid, p_embedding text, p_knowledge_item_id uuid, p_model text DEFAULT 'stub', p_model_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
DROP FUNCTION IF EXISTS public.clear_knowledge_item_chunks(uuid, text) CASCADE;
CREATE FUNCTION public.clear_knowledge_item_chunks(p_item_id uuid)
RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
DROP FUNCTION IF EXISTS public.upsert_story_knowledge_item_audited(uuid, uuid, text, text, text, text, text, text[], text, text, text) CASCADE;
CREATE FUNCTION public.upsert_story_knowledge_item_audited(p_story_id uuid, p_id uuid DEFAULT NULL, p_title text DEFAULT NULL, p_body_markdown text DEFAULT NULL, p_item_type text DEFAULT 'engineering_doc', p_summary text DEFAULT NULL, p_category text DEFAULT NULL, p_ai_context_tags text[] DEFAULT '{}'::text[], p_ai_instructions text DEFAULT NULL, p_visibility text DEFAULT 'public')
RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
-- pre-Brick6 search surface: UNGATED v2 (no minimum_tier in the WHERE) + tier
-- helpers absent (audience_compute_actor_tier + the 2-arg meets_tier are Brick6)
DO $drop_search$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('mcp_search_knowledge_v2', 'mcp_search_knowledge_v3')
  LOOP EXECUTE format('DROP FUNCTION %s CASCADE', r.sig); END LOOP;
END $drop_search$;
CREATE FUNCTION public.mcp_search_knowledge_v2(p_query_embedding vector DEFAULT NULL, p_query_text text DEFAULT NULL, p_item_types text[] DEFAULT '{}', p_category text DEFAULT NULL, p_expertise_slug text DEFAULT NULL, p_context_tags text[] DEFAULT '{}', p_include_ai_instructions boolean DEFAULT true, p_limit integer DEFAULT 20, p_similarity_threshold double precision DEFAULT 0.3)
RETURNS TABLE(knowledge_item_id uuid) LANGUAGE sql AS 'SELECT NULL::uuid WHERE false';
DROP FUNCTION IF EXISTS public.audience_compute_actor_tier(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.audience_user_meets_tier_requirement(text, uuid) CASCADE;
-- pre-Brick4 mirror trigger: old body + old narrow arbiter stay in the DB unless
-- heals re-applies them (the seed inserts expert_rules on EVERY migrate)
CREATE OR REPLACE FUNCTION public.sync_expert_rule_to_knowledge_item()
RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';

-- ── COLUMN-DRIFT: the REAL prod condition ──────────────────────────────────
-- Prod was NOT missing whole tables — it HAD most of the 61 generational tables
-- but in an OLDER form, missing columns added to the SoT later. CREATE TABLE IF
-- NOT EXISTS skips an existing (older) table, so the new column never lands and
-- a later same-file statement that names it aborts the migrate (observed:
-- COMMENT ON COLUMN plugin_catalog.agent_spec → column does not exist). Simulate
-- that by stripping the ATTRIBUTE columns (every column NOT in the primary key
-- and NOT in a UNIQUE constraint) from the generational tables that are NOT
-- whole-dropped below. Key columns are kept on purpose: they are ORIGINAL (a
-- plausible older table always has them) and dropping them CASCADEs away the
-- UNIQUE/PK the no-op CREATE TABLE can't restore, which would break the seed's
-- ON CONFLICT — a test artifact, never a prod condition. The backfill-aware
-- heals reconcile must restore EVERY stripped column (asserted in 5/6). DROP …
-- CASCADE so an FK/generated-column dependency never blocks the drop.
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS display_name CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS backend_kind CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS endpoint_url CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS health_url CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS auth_kind CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS auth_env_var CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS supports_chat CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS supports_tool_use CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS supports_vision CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS supports_batch CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS supports_streaming CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS is_enabled CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS last_health_status CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS last_health_checked_at CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS last_health_detail CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS consecutive_failure_count CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS cost_class CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS scoped_to_instance_id CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS notes CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.ai_provider_registry DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.ai_risk_policies DROP COLUMN IF EXISTS auto_allow_at_or_below CASCADE;
ALTER TABLE public.ai_risk_policies DROP COLUMN IF EXISTS ask_above CASCADE;
ALTER TABLE public.ai_risk_policies DROP COLUMN IF EXISTS deny_above CASCADE;
ALTER TABLE public.ai_risk_policies DROP COLUMN IF EXISTS is_active CASCADE;
ALTER TABLE public.ai_risk_policies DROP COLUMN IF EXISTS created_by CASCADE;
ALTER TABLE public.ai_risk_policies DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.ai_risk_policies DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS submitted_at CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS completed_at CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS last_polled_at CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS request_count CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS succeeded_count CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS errored_count CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS estimated_cost CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS actual_cost CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS result_url CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS related_run_id CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS agent_slug CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS story_id CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS created_by CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.ai_batch_jobs DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS runtime_kind CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS display_name CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS is_enabled CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS adapter_health CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS adapter_health_checked_at CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS consecutive_failure_count CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS can_write CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS needs_network CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS supports_tools CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS side_effect_class CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS autonomy_class CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS notes CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.ai_runtime_registry DROP COLUMN IF EXISTS is_in_process_executor CASCADE;
-- IF EXISTS on the TABLE too — the pre-Brick2 regress above whole-drops the registry
ALTER TABLE IF EXISTS public.ai_model_registry DROP COLUMN IF EXISTS provider_registry_id CASCADE;
ALTER TABLE IF EXISTS public.ai_model_registry DROP COLUMN IF EXISTS slot_affinity CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS category CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS owasp_category CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS semgrep_pattern CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS semgrep_paths CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS semgrep_message CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS languages CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS severity CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS version CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS proposed_by CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS approved_by CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS rationale CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.aisha_static_defense_rules DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS trust_score_snapshot CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS trust_score_delta CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS total_runs_window CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS failed_runs_window CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS open_findings_count CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS new_failures_count CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS newly_fixed_count CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS drift_alerts_count CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS summary CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS proposed_actions CASCADE;
ALTER TABLE public.aitg_aisha_reflections DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS display_name CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS description CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS mode CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS schedule_cron CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS schedule_interval_minutes CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS parameters CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS workflow_id CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS last_run_at CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS last_run_status CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS last_run_details CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS updated_by CASCADE;
ALTER TABLE public.aitg_automation_settings DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.aitg_test_catalog DROP COLUMN IF EXISTS layer CASCADE;
ALTER TABLE public.aitg_test_catalog DROP COLUMN IF EXISTS title CASCADE;
ALTER TABLE public.aitg_test_catalog DROP COLUMN IF EXISTS objective CASCADE;
ALTER TABLE public.aitg_test_catalog DROP COLUMN IF EXISTS remediation_ref CASCADE;
ALTER TABLE public.aitg_test_catalog DROP COLUMN IF EXISTS lifecycle_phases CASCADE;
ALTER TABLE public.aitg_test_catalog DROP COLUMN IF EXISTS severity_weight CASCADE;
ALTER TABLE public.aitg_test_catalog DROP COLUMN IF EXISTS enabled CASCADE;
ALTER TABLE public.aitg_test_catalog DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS test_id CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS window_label CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS current_pass_rate CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS previous_pass_rate CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS delta CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS severity CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS acknowledged_at CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS acknowledged_by CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS resolved_at CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS details CASCADE;
ALTER TABLE public.aitg_drift_alerts DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.aitg_payloads DROP COLUMN IF EXISTS test_id CASCADE;
ALTER TABLE public.aitg_payloads DROP COLUMN IF EXISTS payload CASCADE;
ALTER TABLE public.aitg_payloads DROP COLUMN IF EXISTS expected_block CASCADE;
ALTER TABLE public.aitg_payloads DROP COLUMN IF EXISTS tags CASCADE;
ALTER TABLE public.aitg_payloads DROP COLUMN IF EXISTS source CASCADE;
ALTER TABLE public.aitg_payloads DROP COLUMN IF EXISTS active CASCADE;
ALTER TABLE public.aitg_payloads DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS test_id CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS payload CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS expected_block CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS tags CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS justification CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS proposed_by CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS reviewed_by CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS reviewed_at CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS promoted_payload_id CASCADE;
ALTER TABLE public.aitg_payload_proposals DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.aitg_runs DROP COLUMN IF EXISTS test_id CASCADE;
ALTER TABLE public.aitg_runs DROP COLUMN IF EXISTS build_sha CASCADE;
ALTER TABLE public.aitg_runs DROP COLUMN IF EXISTS triggered_by CASCADE;
ALTER TABLE public.aitg_runs DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.aitg_runs DROP COLUMN IF EXISTS severity CASCADE;
ALTER TABLE public.aitg_runs DROP COLUMN IF EXISTS evidence_uri CASCADE;
ALTER TABLE public.aitg_runs DROP COLUMN IF EXISTS ai_run_id CASCADE;
ALTER TABLE public.aitg_runs DROP COLUMN IF EXISTS details CASCADE;
ALTER TABLE public.aitg_runs DROP COLUMN IF EXISTS started_at CASCADE;
ALTER TABLE public.aitg_runs DROP COLUMN IF EXISTS finished_at CASCADE;
ALTER TABLE public.aitg_findings DROP COLUMN IF EXISTS run_id CASCADE;
ALTER TABLE public.aitg_findings DROP COLUMN IF EXISTS payload_id CASCADE;
ALTER TABLE public.aitg_findings DROP COLUMN IF EXISTS severity CASCADE;
ALTER TABLE public.aitg_findings DROP COLUMN IF EXISTS observed CASCADE;
ALTER TABLE public.aitg_findings DROP COLUMN IF EXISTS classifier_score CASCADE;
ALTER TABLE public.aitg_findings DROP COLUMN IF EXISTS remediation CASCADE;
ALTER TABLE public.aitg_findings DROP COLUMN IF EXISTS fixed_at CASCADE;
ALTER TABLE public.aitg_waivers DROP COLUMN IF EXISTS test_id CASCADE;
ALTER TABLE public.aitg_waivers DROP COLUMN IF EXISTS scope CASCADE;
ALTER TABLE public.aitg_waivers DROP COLUMN IF EXISTS justification CASCADE;
ALTER TABLE public.aitg_waivers DROP COLUMN IF EXISTS approved_by CASCADE;
ALTER TABLE public.aitg_waivers DROP COLUMN IF EXISTS expires_at CASCADE;
ALTER TABLE public.aitg_waivers DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS last_sync_started_at CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS last_sync_finished_at CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS last_success_at CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS last_error_at CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS last_error_message CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS consecutive_failures CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS total_syncs CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS total_failures CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS last_recent_active_count CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS last_upserted_count CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.audience_broker_sync_state DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.ai_run_critic_iterations DROP COLUMN IF EXISTS faithfulness_estimate CASCADE;
ALTER TABLE public.ai_run_critic_iterations DROP COLUMN IF EXISTS context_recall_estimate CASCADE;
ALTER TABLE public.ai_run_critic_iterations DROP COLUMN IF EXISTS retrieved_chunk_ids CASCADE;
ALTER TABLE public.ai_run_critic_iterations DROP COLUMN IF EXISTS retrieval_strategy CASCADE;
ALTER TABLE public.ai_run_critic_iterations DROP COLUMN IF EXISTS decision CASCADE;
ALTER TABLE public.ai_run_critic_iterations DROP COLUMN IF EXISTS judge_model CASCADE;
ALTER TABLE public.ai_run_critic_iterations DROP COLUMN IF EXISTS judge_provider_slug CASCADE;
ALTER TABLE public.ai_run_critic_iterations DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.ai_run_critic_iterations DROP COLUMN IF EXISTS audit_journal_id CASCADE;
ALTER TABLE public.ai_run_critic_iterations DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.flowboard_graphs DROP COLUMN IF EXISTS slug CASCADE;
ALTER TABLE public.flowboard_graphs DROP COLUMN IF EXISTS name CASCADE;
ALTER TABLE public.flowboard_graphs DROP COLUMN IF EXISTS graph CASCADE;
ALTER TABLE public.flowboard_graphs DROP COLUMN IF EXISTS version CASCADE;
ALTER TABLE public.flowboard_graphs DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.flowboard_graphs DROP COLUMN IF EXISTS engine_pin CASCADE;
ALTER TABLE public.flowboard_graphs DROP COLUMN IF EXISTS created_by CASCADE;
ALTER TABLE public.flowboard_graphs DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.flowboard_graphs DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.intranet_chat_channels DROP COLUMN IF EXISTS display_name CASCADE;
ALTER TABLE public.intranet_chat_channels DROP COLUMN IF EXISTS channel_type CASCADE;
ALTER TABLE public.intranet_chat_channels DROP COLUMN IF EXISTS description CASCADE;
ALTER TABLE public.intranet_chat_channels DROP COLUMN IF EXISTS is_default CASCADE;
ALTER TABLE public.intranet_chat_channels DROP COLUMN IF EXISTS is_archived CASCADE;
ALTER TABLE public.intranet_chat_channels DROP COLUMN IF EXISTS created_by CASCADE;
ALTER TABLE public.intranet_chat_channels DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.intranet_chat_channels DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.intranet_chat_members DROP COLUMN IF EXISTS role CASCADE;
ALTER TABLE public.intranet_chat_members DROP COLUMN IF EXISTS joined_at CASCADE;
ALTER TABLE public.intranet_chat_messages DROP COLUMN IF EXISTS channel_id CASCADE;
ALTER TABLE public.intranet_chat_messages DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.intranet_chat_messages DROP COLUMN IF EXISTS content CASCADE;
ALTER TABLE public.intranet_chat_messages DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.intranet_chat_messages DROP COLUMN IF EXISTS is_edited CASCADE;
ALTER TABLE public.intranet_chat_messages DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.intranet_chat_messages DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.lead_submissions DROP COLUMN IF EXISTS source CASCADE;
ALTER TABLE public.lead_submissions DROP COLUMN IF EXISTS name CASCADE;
ALTER TABLE public.lead_submissions DROP COLUMN IF EXISTS contact CASCADE;
ALTER TABLE public.lead_submissions DROP COLUMN IF EXISTS subject CASCADE;
ALTER TABLE public.lead_submissions DROP COLUMN IF EXISTS message CASCADE;
ALTER TABLE public.lead_submissions DROP COLUMN IF EXISTS locale CASCADE;
ALTER TABLE public.lead_submissions DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.lead_submissions DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.lead_submissions DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.lead_submissions DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.llm_tier_defaults DROP COLUMN IF EXISTS daily_token_limit CASCADE;
ALTER TABLE public.llm_tier_defaults DROP COLUMN IF EXISTS daily_cost_limit CASCADE;
ALTER TABLE public.llm_tier_defaults DROP COLUMN IF EXISTS description CASCADE;
ALTER TABLE public.llm_tier_defaults DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.llm_tier_defaults DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.llm_quota DROP COLUMN IF EXISTS tier CASCADE;
ALTER TABLE public.llm_quota DROP COLUMN IF EXISTS daily_token_limit CASCADE;
ALTER TABLE public.llm_quota DROP COLUMN IF EXISTS daily_cost_limit CASCADE;
ALTER TABLE public.llm_quota DROP COLUMN IF EXISTS consumed_tokens_today CASCADE;
ALTER TABLE public.llm_quota DROP COLUMN IF EXISTS consumed_cost_today CASCADE;
ALTER TABLE public.llm_quota DROP COLUMN IF EXISTS last_reset_at CASCADE;
ALTER TABLE public.llm_quota DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.llm_quota DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS display_name CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS description CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS transport CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS endpoint_url CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS stdio_command CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS auth_kind CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS auth_env_var CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS capability_tags CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS exposes_llm CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS last_tested_at CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS last_test_result CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS test_failure_count CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS source CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS registered_by CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.mcp_server_registry DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS channel CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS recipient CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS template CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS payload CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS attempt_count CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS max_attempts CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS next_retry_at CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS sent_at CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS error CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS agent_slug CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS related_run_id CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS story_id CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS created_by CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.openclaw_notifications DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.branding_hostname_mapping DROP COLUMN IF EXISTS branding_profile_id CASCADE;
ALTER TABLE public.branding_hostname_mapping DROP COLUMN IF EXISTS brand_variant CASCADE;
ALTER TABLE public.branding_hostname_mapping DROP COLUMN IF EXISTS primary_route CASCADE;
ALTER TABLE public.branding_hostname_mapping DROP COLUMN IF EXISTS secondary_route CASCADE;
ALTER TABLE public.branding_hostname_mapping DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.branding_hostname_mapping DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.personality_signals DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.personality_signals DROP COLUMN IF EXISTS signal_type CASCADE;
ALTER TABLE public.personality_signals DROP COLUMN IF EXISTS value CASCADE;
ALTER TABLE public.personality_signals DROP COLUMN IF EXISTS weight CASCADE;
ALTER TABLE public.personality_signals DROP COLUMN IF EXISTS conversation_id CASCADE;
ALTER TABLE public.personality_signals DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS name CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS description CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS author CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS kind CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS trust_tier CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS capabilities CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS config_schema CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS sandbox_policy CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS lifecycle CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS agent_spec CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS author_partner_id CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.plugin_catalog DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.plugin_audit_events DROP COLUMN IF EXISTS plugin_id CASCADE;
ALTER TABLE public.plugin_audit_events DROP COLUMN IF EXISTS actor_id CASCADE;
ALTER TABLE public.plugin_audit_events DROP COLUMN IF EXISTS action CASCADE;
ALTER TABLE public.plugin_audit_events DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.plugin_audit_events DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.plugin_health_events DROP COLUMN IF EXISTS plugin_id CASCADE;
ALTER TABLE public.plugin_health_events DROP COLUMN IF EXISTS tenant_id CASCADE;
ALTER TABLE public.plugin_health_events DROP COLUMN IF EXISTS event_kind CASCADE;
ALTER TABLE public.plugin_health_events DROP COLUMN IF EXISTS latency_ms CASCADE;
ALTER TABLE public.plugin_health_events DROP COLUMN IF EXISTS error_text CASCADE;
ALTER TABLE public.plugin_health_events DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.plugin_health_events DROP COLUMN IF EXISTS recorded_at CASCADE;
ALTER TABLE public.plugin_kv DROP COLUMN IF EXISTS value CASCADE;
ALTER TABLE public.plugin_kv DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.plugin_kv DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.plugin_schedules DROP COLUMN IF EXISTS cron_expr CASCADE;
ALTER TABLE public.plugin_schedules DROP COLUMN IF EXISTS enabled CASCADE;
ALTER TABLE public.plugin_schedules DROP COLUMN IF EXISTS last_run_at CASCADE;
ALTER TABLE public.plugin_schedules DROP COLUMN IF EXISTS next_run_at CASCADE;
ALTER TABLE public.plugin_schedules DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.plugin_schedules DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.plugin_tenant_overrides DROP COLUMN IF EXISTS enabled CASCADE;
ALTER TABLE public.plugin_tenant_overrides DROP COLUMN IF EXISTS config_override CASCADE;
ALTER TABLE public.plugin_tenant_overrides DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.plugin_tenant_overrides DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.plugin_versions DROP COLUMN IF EXISTS artifact_sha256 CASCADE;
ALTER TABLE public.plugin_versions DROP COLUMN IF EXISTS artifact_url CASCADE;
ALTER TABLE public.plugin_versions DROP COLUMN IF EXISTS changelog CASCADE;
ALTER TABLE public.plugin_versions DROP COLUMN IF EXISTS resolved_deps CASCADE;
ALTER TABLE public.plugin_versions DROP COLUMN IF EXISTS submitted_by CASCADE;
ALTER TABLE public.plugin_versions DROP COLUMN IF EXISTS reviewed_by CASCADE;
ALTER TABLE public.plugin_versions DROP COLUMN IF EXISTS reviewed_at CASCADE;
ALTER TABLE public.plugin_versions DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.rag_eval_baselines DROP COLUMN IF EXISTS n_runs CASCADE;
ALTER TABLE public.rag_eval_baselines DROP COLUMN IF EXISTS faithfulness_avg CASCADE;
ALTER TABLE public.rag_eval_baselines DROP COLUMN IF EXISTS answer_relevancy_avg CASCADE;
ALTER TABLE public.rag_eval_baselines DROP COLUMN IF EXISTS context_precision_avg CASCADE;
ALTER TABLE public.rag_eval_baselines DROP COLUMN IF EXISTS context_recall_avg CASCADE;
ALTER TABLE public.rag_eval_baselines DROP COLUMN IF EXISTS composite_avg CASCADE;
ALTER TABLE public.rag_eval_baselines DROP COLUMN IF EXISTS faithfulness_p50 CASCADE;
ALTER TABLE public.rag_eval_baselines DROP COLUMN IF EXISTS faithfulness_p90 CASCADE;
ALTER TABLE public.rag_eval_baselines DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.signal_tag_rules DROP COLUMN IF EXISTS event_type_pattern CASCADE;
ALTER TABLE public.signal_tag_rules DROP COLUMN IF EXISTS source_pattern CASCADE;
ALTER TABLE public.signal_tag_rules DROP COLUMN IF EXISTS tags CASCADE;
ALTER TABLE public.signal_tag_rules DROP COLUMN IF EXISTS priority CASCADE;
ALTER TABLE public.signal_tag_rules DROP COLUMN IF EXISTS is_active CASCADE;
ALTER TABLE public.signal_tag_rules DROP COLUMN IF EXISTS description CASCADE;
ALTER TABLE public.signal_tag_rules DROP COLUMN IF EXISTS created_by CASCADE;
ALTER TABLE public.signal_tag_rules DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.signal_tag_rules DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.story_goal_state DROP COLUMN IF EXISTS acceptance_criteria CASCADE;
ALTER TABLE public.story_goal_state DROP COLUMN IF EXISTS last_evaluated_at CASCADE;
ALTER TABLE public.story_goal_state DROP COLUMN IF EXISTS loop_iterations CASCADE;
ALTER TABLE public.story_goal_state DROP COLUMN IF EXISTS loop_max CASCADE;
ALTER TABLE public.story_goal_state DROP COLUMN IF EXISTS fingerprint CASCADE;
ALTER TABLE public.story_goal_state DROP COLUMN IF EXISTS last_evaluator_output CASCADE;
ALTER TABLE public.story_goal_state DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.story_goal_state DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.graph_nodes DROP COLUMN IF EXISTS entity_label CASCADE;
ALTER TABLE public.graph_nodes DROP COLUMN IF EXISTS source_table CASCADE;
ALTER TABLE public.graph_nodes DROP COLUMN IF EXISTS source_id CASCADE;
ALTER TABLE public.graph_nodes DROP COLUMN IF EXISTS embedding CASCADE;
ALTER TABLE public.graph_nodes DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.graph_nodes DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.graph_nodes DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.graph_edges DROP COLUMN IF EXISTS confidence CASCADE;
ALTER TABLE public.graph_edges DROP COLUMN IF EXISTS source_audit_journal_id CASCADE;
ALTER TABLE public.graph_edges DROP COLUMN IF EXISTS source_ai_run_id CASCADE;
ALTER TABLE public.graph_edges DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.graph_edges DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.knowledge_multimodal_pages DROP COLUMN IF EXISTS page_image_uri CASCADE;
ALTER TABLE public.knowledge_multimodal_pages DROP COLUMN IF EXISTS page_image_sha256 CASCADE;
ALTER TABLE public.knowledge_multimodal_pages DROP COLUMN IF EXISTS page_text CASCADE;
ALTER TABLE public.knowledge_multimodal_pages DROP COLUMN IF EXISTS embedding_v2 CASCADE;
ALTER TABLE public.knowledge_multimodal_pages DROP COLUMN IF EXISTS embedding_model CASCADE;
ALTER TABLE public.knowledge_multimodal_pages DROP COLUMN IF EXISTS embedding_version CASCADE;
ALTER TABLE public.knowledge_multimodal_pages DROP COLUMN IF EXISTS embedding_generated_at CASCADE;
ALTER TABLE public.knowledge_multimodal_pages DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.knowledge_multimodal_pages DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.knowledge_multimodal_pages DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS agent_slug CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS knowledge_item_id CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS binding_type CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS priority CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS version CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS is_active CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS story_id CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS notes CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.agent_knowledge_bindings DROP COLUMN IF EXISTS created_by CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS trigger_kind CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS target_env CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS target_base_url CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS suite CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS deploy_ref CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS total CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS passed CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS failed CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS skipped CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS duration_ms CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS report_storage_path CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS trace_json_path CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS error_message CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS requested_by CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS approval_required CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS approved_by CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS approved_at CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS started_at CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS finished_at CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS app_name CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS active_slot CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS story_id CASCADE;
ALTER TABLE public.playwright_runs DROP COLUMN IF EXISTS triggered_rollback_id CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS question CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS ground_truth_answer CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS expected_chunk_slugs CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS context_profile_slug CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS expertise_area_slug CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS story_id CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS difficulty CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS language CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS tags CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS notes CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS created_by CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.rag_eval_golden DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS golden_id CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS batch_id CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS embedding_model CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS embedding_model_version CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS llm_model CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS judge_model CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS context_profile_slug CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS retrieved_chunk_ids CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS retrieved_chunk_count CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS generated_answer CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS faithfulness_score CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS answer_relevancy_score CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS context_precision_score CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS context_recall_score CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS composite_score CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS latency_ms CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS cost CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS ai_run_id CASCADE;
ALTER TABLE public.rag_eval_runs DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.sla_tracking DROP COLUMN IF EXISTS story_id CASCADE;
ALTER TABLE public.sla_tracking DROP COLUMN IF EXISTS matrix_room_id CASCADE;
ALTER TABLE public.sla_tracking DROP COLUMN IF EXISTS first_message_at CASCADE;
ALTER TABLE public.sla_tracking DROP COLUMN IF EXISTS first_response_at CASCADE;
ALTER TABLE public.sla_tracking DROP COLUMN IF EXISTS response_time_ms CASCADE;
ALTER TABLE public.sla_tracking DROP COLUMN IF EXISTS sla_breached CASCADE;
ALTER TABLE public.sla_tracking DROP COLUMN IF EXISTS escalated_at CASCADE;
ALTER TABLE public.sla_tracking DROP COLUMN IF EXISTS escalated_to CASCADE;
ALTER TABLE public.sla_tracking DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.sla_tracking DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.story_matrix_rooms DROP COLUMN IF EXISTS matrix_room_id CASCADE;
ALTER TABLE public.story_matrix_rooms DROP COLUMN IF EXISTS is_active CASCADE;
ALTER TABLE public.story_matrix_rooms DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.story_matrix_rooms DROP COLUMN IF EXISTS bridge_type CASCADE;
ALTER TABLE public.story_matrix_rooms DROP COLUMN IF EXISTS display_name CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS app_accesses_30d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS app_accesses_90d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS last_active_at CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS events_created_30d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS events_created_90d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS posts_created_30d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS audience_size CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS audience_growth_30d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS unique_attendees_30d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS total_attendance_30d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS emails_opened_90d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS emails_sent_90d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS email_open_rate_90d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS email_click_rate_90d CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS source_slug CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS computed_at CASCADE;
ALTER TABLE public.user_engagement_metrics DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.voice_rooms DROP COLUMN IF EXISTS name CASCADE;
ALTER TABLE public.voice_rooms DROP COLUMN IF EXISTS room_type CASCADE;
ALTER TABLE public.voice_rooms DROP COLUMN IF EXISTS story_id CASCADE;
ALTER TABLE public.voice_rooms DROP COLUMN IF EXISTS max_participants CASCADE;
ALTER TABLE public.voice_rooms DROP COLUMN IF EXISTS is_active CASCADE;
ALTER TABLE public.voice_rooms DROP COLUMN IF EXISTS created_by CASCADE;
ALTER TABLE public.voice_rooms DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.voice_rooms DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.call_events DROP COLUMN IF EXISTS voice_room_id CASCADE;
ALTER TABLE public.call_events DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.call_events DROP COLUMN IF EXISTS event_type CASCADE;
ALTER TABLE public.call_events DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.call_events DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.call_participants DROP COLUMN IF EXISTS joined_at CASCADE;
ALTER TABLE public.call_participants DROP COLUMN IF EXISTS left_at CASCADE;
ALTER TABLE public.call_participants DROP COLUMN IF EXISTS is_muted CASCADE;
ALTER TABLE public.call_participants DROP COLUMN IF EXISTS role CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS voice_room_id CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS booking_id CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS caller_id CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS callee_id CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS started_at CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS ended_at CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS duration_seconds CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS recording_consent CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS recording_url CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS recording_consent_at CASCADE;
ALTER TABLE public.consultation_sessions DROP COLUMN IF EXISTS recording_egress_id CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS story_id CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS kind CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS source_type CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS source_url CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS source_storage_path CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS seed_canvas_data CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS result_canvas_data CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS result_canvas_html CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS result_canvas_css CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS extracted_tokens CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS brief CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS slot_profile CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS creativity_seed CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS applied_to_page_id CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS applied_version_id CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS error_message CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS created_by CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS processed_at CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS applied_at CASCADE;
ALTER TABLE public.web_artifact_jobs DROP COLUMN IF EXISTS metadata CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS clow CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS request_input CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS model_id CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS provider_slug CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS run_id CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS story_id CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS decision_id CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS status CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS claimed_by CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS response CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS error_detail CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS tokens_in CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS tokens_out CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS latency_ms CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS enqueued_at CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS claimed_at CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS completed_at CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.workbench_execution_requests DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.workflow_statuses DROP COLUMN IF EXISTS label_i18n_key CASCADE;
ALTER TABLE public.workflow_statuses DROP COLUMN IF EXISTS sort_order CASCADE;
ALTER TABLE public.workflow_statuses DROP COLUMN IF EXISTS swimlane_color CASCADE;
ALTER TABLE public.workflow_statuses DROP COLUMN IF EXISTS is_terminal CASCADE;
ALTER TABLE public.workflow_statuses DROP COLUMN IF EXISTS is_active CASCADE;
ALTER TABLE public.workflow_statuses DROP COLUMN IF EXISTS notes CASCADE;
ALTER TABLE public.workflow_statuses DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.workflow_statuses DROP COLUMN IF EXISTS updated_at CASCADE;
ALTER TABLE public.workflow_status_transitions DROP COLUMN IF EXISTS requires_role CASCADE;
ALTER TABLE public.workflow_status_transitions DROP COLUMN IF EXISTS is_active CASCADE;
ALTER TABLE public.workflow_status_transitions DROP COLUMN IF EXISTS notes CASCADE;
ALTER TABLE public.workflow_status_transitions DROP COLUMN IF EXISTS created_at CASCADE;
ALTER TABLE public.workflow_status_transitions DROP COLUMN IF EXISTS updated_at CASCADE;

-- ── FULLY-MISSING: keep proving the whole-table CREATE path + enum reconcile ──
-- FK-leaf tables dropped entirely (no inbound FKs). plugin_transition_rules is
-- here (not column-dropped) because its enum columns from_status/to_status are
-- in its UNIQUE → kept by the attribute-only drop → they'd keep referencing
-- plugin_status and the DROP TYPE … CASCADE below would shed them + the UNIQUE
-- the seed's ON CONFLICT needs. Whole-dropping recreates it WITH the constraint.
DROP TABLE IF EXISTS public.ai_decisions            CASCADE;
DROP TABLE IF EXISTS public.delivery_statuses       CASCADE;
DROP TABLE IF EXISTS public.dirigent_nudges         CASCADE;
DROP TABLE IF EXISTS public.message_user_feedback   CASCADE;
DROP TABLE IF EXISTS public.tracked_actions         CASCADE;
DROP TABLE IF EXISTS public.plugin_transition_rules CASCADE;

-- …and the 9 enums the generational tables' columns use (plugin_* / playwright_*
-- / web_artifact_*). Every enum-typed column on a SURVIVING table is an attribute
-- column dropped above; the only enum-typed KEY columns live on
-- plugin_transition_rules, whole-dropped just above. So no surviving table
-- references these types → CASCADE here only sheds function dependencies; heals
-- re-creates the enums (guarded DO blocks) before the ADD COLUMN pass that
-- re-adds the enum-typed columns.
DROP TYPE IF EXISTS public.plugin_kind CASCADE;
DROP TYPE IF EXISTS public.plugin_trust_tier CASCADE;
DROP TYPE IF EXISTS public.plugin_status CASCADE;
DROP TYPE IF EXISTS public.plugin_health_event_kind CASCADE;
DROP TYPE IF EXISTS public.playwright_run_status CASCADE;
DROP TYPE IF EXISTS public.playwright_run_trigger CASCADE;
DROP TYPE IF EXISTS public.web_artifact_kind CASCADE;
DROP TYPE IF EXISTS public.web_artifact_source_type CASCADE;
DROP TYPE IF EXISTS public.web_artifact_job_status CASCADE;

-- ── #516/#512 existing-DB reconcile (this PR) ──────────────────────────────
-- Polymorphic story_entries columns + the entry_type_definitions registry +
-- news_articles.tags were baseline-folded by #516/#512 → absent on a pre-fold DB.
-- Strip them so heals (4/6) + the reseed (6/6) must restore them. DROP … CASCADE
-- also sheds the dependent index / CHECK / public-discussion policy that the no-op
-- CREATE TABLE IF NOT EXISTS can't restore — exactly the existing-DB shape. story_id
-- regains its pre-#516 NOT NULL (heals must DROP it again to admit non-story subjects).
ALTER TABLE public.story_entries  DROP COLUMN IF EXISTS subject_type      CASCADE;
ALTER TABLE public.story_entries  DROP COLUMN IF EXISTS subject_id        CASCADE;
ALTER TABLE public.story_entries  DROP COLUMN IF EXISTS status            CASCADE;
ALTER TABLE public.story_entries  DROP COLUMN IF EXISTS moderation_reason CASCADE;
ALTER TABLE public.story_entries  ALTER COLUMN story_id SET NOT NULL;
DROP TABLE  IF EXISTS public.entry_type_definitions CASCADE;
ALTER TABLE public.news_articles  DROP COLUMN IF EXISTS tags CASCADE;
-- ── li_* evidence silo: the read surface an existing DB never received ───────
-- Sources landed 2026-07-16 and the generator folded them into the baseline, but
-- a DB created before that fold takes the adopt-baseline branch and never runs
-- them. Measured live 2026-07-21: all five li_* tables held their rows (101 docs,
-- 348 obligations) while pg_proc had none of these functions and pg_policies none
-- of these policies — the RPC "existed" in source and returned nothing in prod.
-- Both halves must be dropped: with the functions restored but the policies still
-- missing, RLS-enabled-with-zero-policies denies every row and the surface comes
-- back GREEN OVER NO DATA, which is the failure this gate has to be able to see.
-- Derived, not enumerated: the no-op check below asserts ZERO policies remain
-- on li_* tables, so the DROP must cover whatever the baseline ships — a hand
-- list rots the moment an 11th policy lands (it did: 3d8a8239 added
-- li_source_registry_member_tier_select on 07-25, the gate did not RUN again
-- until 07-27, and the stale list aborted the whole job as "would be a no-op").
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename LIKE 'li\_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.get_document_register(jsonb)  CASCADE;
DROP FUNCTION IF EXISTS public.get_document_detail(jsonb)    CASCADE;
DROP FUNCTION IF EXISTS public.get_document_digest(jsonb)    CASCADE;
DROP FUNCTION IF EXISTS public.get_obligation_queue(jsonb)   CASCADE;
DROP FUNCTION IF EXISTS public.get_evidence_findings(jsonb)  CASCADE;
-- Dotazy na pravdu (2026-09-28): čtecí blok + verdikty nad pravidly.
DROP FUNCTION IF EXISTS public.get_finding_questions(jsonb)  CASCADE;
DROP TABLE IF EXISTS public.li_finding_verdicts CASCADE;
DROP FUNCTION IF EXISTS public.li_get_document(text) CASCADE;
DROP FUNCTION IF EXISTS public.li_list_documents(text, text, uuid, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.li_list_obligations(text, text, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.li_list_findings(text, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.li_list_links(text, text, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.li_list_entity_suggestions(integer, integer) CASCADE;
-- Po JMÉNĚ, ne po signatuře. `DROP FUNCTION ... (text,uuid,text,text)` je
-- pravopis, ne vlastnost: jakmile funkce dostane další argument, DROP tiše
-- nic neudělá, funkce přežije a celá brána se stane no-opem. Doloženo
-- 2026-07-28: dispatcher dostal `p_evidence jsonb` a tenhle řádek přestal
-- platit — reality-check níž to naštěstí zachytil a shodil setup nahlas.
-- Ostatní li_* funkce mají signaturu stabilní, ale tohle je zapisovatel a ten
-- se mění nejčastěji, takže se maže celý jeho overload set.
DO $drop_writer$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'submit_evidence_review_audited'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END
$drop_writer$;

-- ── 2026-09-26: fronta předání čte živý stav ze zdroje ───────────────────────
-- DB z doby před `source_state` NEMÁ dva indexy registru (ukazatel `doc_slug`
-- a obecný GIN nad `fields` pro identitu ve zdroji) a nese STAROU funkci
-- `get_workflow_my_steps_block` bez dvoukrokového čtení (`src_ptr` → `src_id`).
-- Baseline se na existující DB znovu neaplikuje, takže obojí musí dodat heals.
-- Registr přitom NENÍ prázdný: indexy se staví nad řádky, které tam už leží
-- (včetně překonané generace — partial `superseded_by IS NULL` ji nesmí nést).
DROP INDEX IF EXISTS public.idx_li_source_registry_doc_slug_valid;
DROP INDEX IF EXISTS public.idx_li_source_registry_fields_gin;
INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, status, fields, superseded_by)
VALUES ('upgrade-probe-sha-1', 'upgrade-probe-1', 'delivery_note', 'AUTO_PASS',
        '{"settled":{"value":"False"},"zdroj_id":{"value":"UP-1"}}'::jsonb, 'upgrade-probe-2'),
       ('upgrade-probe-sha-2', 'upgrade-probe-2', 'delivery_note', 'AUTO_PASS',
        '{"settled":{"value":"True"},"zdroj_id":{"value":"UP-1"}}'::jsonb, NULL)
ON CONFLICT DO NOTHING;
-- Stará funkce: tvar (jsonb → jsonb) zůstává, tělo neumí `stable_key`.
CREATE OR REPLACE FUNCTION public.get_workflow_my_steps_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE AS $pre_source_state$ SELECT '{}'::jsonb $pre_source_state$;

-- ── 2026-09-29: F2 tabletů — vlastní účet zařízení a pátá cesta viditelnosti ──
-- DB z doby před F2: průkaz bez ucet_id/plati_do (a bez jejich kontrol a indexu),
-- žádná kiosk_rozsah ani funkce účtu zařízení, STARÝ handle_new_user (member
-- KAŽDÉMU) a STARÝ pětiargumentový predikát. A v datech už SCHVÁLENÝ tablet bez
-- účtu (heals ho musí dorovnat) vedle ČEKAJÍCÍHO (ten účet dostat nesmí).
DROP TABLE IF EXISTS public.kiosk_rozsah CASCADE;
DROP FUNCTION IF EXISTS public.je_ucet_zarizeni_platny(uuid);
DROP FUNCTION IF EXISTS public.current_device_kid();
DROP FUNCTION IF EXISTS public.zaloz_ucet_zarizeni_interni(text);
ALTER TABLE public.knock_device_credentials DROP COLUMN IF EXISTS ucet_id CASCADE;
ALTER TABLE public.knock_device_credentials DROP COLUMN IF EXISTS plati_do CASCADE;
DROP FUNCTION IF EXISTS public.workflow_step_visible_to(uuid,uuid,text,jsonb,text,text);
CREATE FUNCTION public.workflow_step_visible_to(
  p_uid uuid, p_assigned_user uuid, p_assigned_role text, p_input jsonb, p_scope text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $pre_f2_pred$
BEGIN
  IF (p_uid = auth.uid() OR public.is_service_role() OR public.is_admin_or_staff()) IS NOT TRUE THEN
    RETURN false;
  END IF;
  RETURN p_assigned_user IS NOT NULL AND p_assigned_user = p_uid;
END
$pre_f2_pred$;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $pre_f2_hnu$
BEGIN
  INSERT INTO public.user_roles (user_id, role, granted_by, granted_at)
  VALUES (NEW.id, 'member'::app_role, NULL, NOW())
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.profiles (id, user_id) VALUES (NEW.id, NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END
$pre_f2_hnu$;
-- F2-B/C: bez relace, projekce, tahače a rozvozů; detail kroku STARÝ (bez projekce tabletu).
DROP FUNCTION IF EXISTS public.kiosk_vydej_relaci(text);
DROP FUNCTION IF EXISTS public.kiosk_projekce(text, jsonb);
DROP FUNCTION IF EXISTS public.get_kiosk_rozvozy(text, text);
DROP FUNCTION IF EXISTS public.kiosk_krok_nasi_flotily(jsonb);
DROP FUNCTION IF EXISTS public.get_workflow_step_polozky(uuid);
DROP FUNCTION IF EXISTS public.kiosk_tahac(text);
DO $pre_f2c_detail$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.get_workflow_step_detail(uuid)'::regprocedure) INTO d;
  d := replace(d, 'public.kiosk_projekce(v_s.step_code, v_s.input_data)', 'v_s.input_data');
  EXECUTE d;
END
$pre_f2c_detail$;
INSERT INTO public.knock_device_credentials (kid, public_key_hex, scope, druh, approved_at)
VALUES ('dev-' || repeat('a1', 8), '04' || repeat('a1', 64), 'upgrade-probe-f2', 'tablet', now()),
       ('dev-' || repeat('b2', 8), '04' || repeat('b2', 64), 'upgrade-probe-f2', 'tablet', NULL);
-- ── 2026-09-28: executor akcí po události (F3a) ──────────────────────────────
-- DB z doby před F3a nemá RPC executoru (claim/finish/requeue/cron), jeho dva
-- indexy ani CHECK principála, a nese STARÝ dispečer s mrtvým mostem net.http_post
-- a celým řádkem v notify. Navíc v ní může ležet pravidlo pro kanál executoru BEZ
-- principála — heals ho nesmí shodit (CHECK jde NOT VALID + pokus o VALIDATE).
DROP FUNCTION IF EXISTS public.claim_proactive_run(uuid, text, text[]);
DROP FUNCTION IF EXISTS public.claim_pending_proactive_runs(text, text[], integer, integer);
DROP FUNCTION IF EXISTS public.requeue_stale_proactive_runs(text[], integer, integer);
DROP FUNCTION IF EXISTS public.finish_proactive_run(uuid, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.record_cron_proactive_run(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.list_cron_proactive_definitions(text[]);
DROP INDEX IF EXISTS public.idx_ai_proactive_runs_otevrene;
DROP INDEX IF EXISTS public.uq_ai_proactive_runs_cron_slot;
ALTER TABLE public.ai_proactive_trigger_definitions
  DROP CONSTRAINT IF EXISTS ai_proactive_defs_executor_principal_check;
INSERT INTO public.ai_proactive_trigger_definitions
  (name, source_table, source_event, action_config, is_active)
VALUES ('upgrade-probe-f3a-bez-principala', 'story_entries', 'INSERT', '{"channel":"push"}'::jsonb, false);
CREATE OR REPLACE FUNCTION public.fn_dispatch_proactive_triggers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $pre_f3a$
BEGIN
  PERFORM pg_notify('ai_proactive_dispatch', jsonb_build_object('source_data', to_jsonb(NEW))::text);
  PERFORM net.http_post(url := 'http://n8n/webhook/x', body := '{}'::jsonb);
  RETURN NEW;
END
$pre_f3a$;
SQL
# Fronta ze zdroje: indexy musí být PRYČ a funkce STARÁ, jinak je 5/6 no-op.
fz_idx_left=$(scalar "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('idx_li_source_registry_doc_slug_valid','idx_li_source_registry_fields_gin');")
if [ "${fz_idx_left:-1}" -ne 0 ]; then
  echo "❌ setup error: ${fz_idx_left} index(y) fronty ze zdroje po DROP pořád existují — gate would be a no-op"; exit 1
fi
fz_fn_new=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_workflow_my_steps_block' AND p.prosrc LIKE '%stable_key%';")
if [ "${fz_fn_new:-1}" -ne 0 ]; then
  echo "❌ setup error: get_workflow_my_steps_block už umí stable_key před heals — gate would be a no-op"; exit 1
fi

# F2: sloupce, tabulka a funkce účtu zařízení PRYČ, predikát a handle_new_user STARÉ — jinak je 5/6 no-op.
f2_col=$(scalar "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='knock_device_credentials' AND column_name IN ('ucet_id','plati_do');")
f2_tbl=$(scalar "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='kiosk_rozsah';")
f2_fn=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('je_ucet_zarizeni_platny','current_device_kid','zaloz_ucet_zarizeni_interni');")
f2_pred=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='workflow_step_visible_to' AND p.pronargs=5;")
f2_hnu=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='handle_new_user' AND p.prosrc LIKE '%ucet_id%';")
f2c_fn=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('kiosk_vydej_relaci','kiosk_projekce','get_kiosk_rozvozy','kiosk_tahac');")
f2c_det=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_workflow_step_detail' AND p.prosrc LIKE '%kiosk_projekce(v_s.step_code, v_s.input_data)%';")
if [ "${f2c_fn:-1}" -ne 0 ] || [ "${f2c_det:-1}" -ne 0 ]; then
  echo "❌ setup error: F2-B/C regrese neproběhla (funkce=${f2c_fn} detail_s_projekci=${f2c_det}) — gate would be a no-op"; exit 1
fi
if [ "${f2_col:-1}" -ne 0 ] || [ "${f2_tbl:-1}" -ne 0 ] || [ "${f2_fn:-1}" -ne 0 ] || [ "${f2_pred:-0}" -ne 1 ] || [ "${f2_hnu:-1}" -ne 0 ]; then
  echo "❌ setup error: F2 regrese neproběhla (sloupce=${f2_col} tabulka=${f2_tbl} funkce=${f2_fn} starý_predikát=${f2_pred} nový_hnu=${f2_hnu}) — gate would be a no-op"; exit 1
fi
# F3a: RPC executoru PRYČ, dispečer STARÝ (s net.http_post), CHECK chybí — jinak je 5/6 no-op.
f3a_left=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('claim_proactive_run','claim_pending_proactive_runs','requeue_stale_proactive_runs','finish_proactive_run','record_cron_proactive_run','list_cron_proactive_definitions');")
f3a_old=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_dispatch_proactive_triggers' AND p.prosrc LIKE '%net.http_post%';")
f3a_chk=$(scalar "SELECT count(*) FROM pg_constraint WHERE conname='ai_proactive_defs_executor_principal_check';")
if [ "${f3a_left:-1}" -ne 0 ] || [ "${f3a_old:-0}" -ne 1 ] || [ "${f3a_chk:-1}" -ne 0 ]; then
  echo "❌ setup error: F3a regrese neproběhla (rpc=${f3a_left} starý_dispečer=${f3a_old} check=${f3a_chk}) — gate would be a no-op"; exit 1
fi
# Assert the regression is REAL — otherwise the whole gate is a silent no-op.
# Same reality-check for the li_* silo: if these did not actually go away, the
# 5/6 assertions below would pass on leftovers and prove nothing.
li_fn_left=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_document_register','get_document_detail','get_document_digest','get_obligation_queue','get_evidence_findings','get_finding_questions','li_list_documents','li_get_document','li_list_obligations','li_list_findings','li_list_links','li_list_entity_suggestions','submit_evidence_review_audited');")
if [ "${li_fn_left:-1}" -ne 0 ]; then
  echo "❌ setup error: ${li_fn_left} li_* surface function(s) still present after DROP — gate would be a no-op"; exit 1
fi
li_pol_left=$(scalar "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'li\\_%';")
if [ "${li_pol_left:-1}" -ne 0 ]; then
  echo "❌ setup error: ${li_pol_left} li_* polic(ies) still present after DROP — gate would be a no-op"; exit 1
fi
gone=$(scalar "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='claude_hook_bindings' AND column_name='config';")
if [ "${gone:-1}" -ne 0 ]; then
  echo "❌ setup error: claude_hook_bindings.config still present after DROP — gate would be a no-op"; exit 1
fi
# COLUMN-DRIFT reality-check: plugin_catalog.agent_spec is the EXACT column whose
# absence aborted the prod migrate (COMMENT ON COLUMN …agent_spec). The table
# must SURVIVE (column-drift, not whole-drop) with the column GONE — else the
# column-backfill half of this gate is a silent no-op.
pc_tbl=$(scalar "SELECT to_regclass('public.plugin_catalog');")
if [ -z "$pc_tbl" ]; then
  echo "❌ setup error: plugin_catalog should SURVIVE column-drift but was dropped — column-backfill path untested"; exit 1
fi
gone_col=$(scalar "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='plugin_catalog' AND column_name='agent_spec';")
if [ "${gone_col:-1}" -ne 0 ]; then
  echo "❌ setup error: plugin_catalog.agent_spec still present after DROP — column-backfill would be a no-op"; exit 1
fi
# FULLY-MISSING reality-check: ai_decisions is whole-dropped. If its DROP didn't
# take, the whole-table CREATE half of this gate would be a silent no-op.
gone_whole=$(scalar "SELECT to_regclass('public.ai_decisions');")
if [ -n "$gone_whole" ]; then
  echo "❌ setup error: ai_decisions still present after DROP — fully-missing reconcile would be a no-op"; exit 1
fi
gone_enum=$(scalar "SELECT count(*) FROM pg_type WHERE typname='plugin_kind';")
if [ "${gone_enum:-1}" -ne 0 ]; then
  echo "❌ setup error: enum plugin_kind still present after DROP — enum reconcile would be a no-op"; exit 1
fi
# #516/#512 reality-check: the polymorphic column + the new registry table must be GONE,
# else their reconcile (asserted in 5/6) + the reseed (6/6) would be silent no-ops.
gone_se=$(scalar "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='story_entries' AND column_name='subject_id';")
if [ "${gone_se:-1}" -ne 0 ]; then
  echo "❌ setup error: story_entries.subject_id still present after DROP — #516 column reconcile would be a no-op"; exit 1
fi
gone_etd=$(scalar "SELECT to_regclass('public.entry_type_definitions');")
if [ -n "$gone_etd" ]; then
  echo "❌ setup error: entry_type_definitions still present after DROP — #516 table reconcile would be a no-op"; exit 1
fi
# ── politiky tabulky znalostí do stavu dnešních instancí ─────────────────────
# Na databázi založené dřív jsou dvě PERMISSIVE politiky TO public pod starými jmény;
# druhá pouští každou globální položku. Heals je musí ZAHODIT — vedle nových by se
# s nimi sečetly a díra by zůstala.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP POLICY IF EXISTS knowledge_items_global_anon_read ON public.knowledge_items;
DROP POLICY IF EXISTS knowledge_items_global_authenticated_read ON public.knowledge_items;
DROP POLICY IF EXISTS knowledge_items_story_participants_read ON public.knowledge_items;
DROP POLICY IF EXISTS knowledge_items_admin_read ON public.knowledge_items;
CREATE POLICY "Anyone can read active public knowledge items" ON public.knowledge_items
  AS PERMISSIVE FOR SELECT TO public
  USING (status = 'active' AND visibility IN ('public', 'members') AND story_id IS NULL);
CREATE POLICY "Per-story KB visible to participants" ON public.knowledge_items
  AS PERMISSIVE FOR SELECT TO public
  USING (story_id IS NULL OR (SELECT is_admin_or_staff()));
SQL
stare=$(scalar "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='knowledge_items' AND policyname IN ('Anyone can read active public knowledge items','Per-story KB visible to participants');")
if [ "${stare:-0}" -ne 2 ]; then
  echo "❌ setup error: staré politiky znalostí se nepodařilo založit ($stare ze 2) — jejich zahození by se neměřilo"; exit 1
fi
# ── hledání rysů osobnosti do stavu dnešních instancí ────────────────────────
# Na databázi založené dřív funkce stav položky nefiltruje a cestu má bez pg_temp.
# Sonda ji do toho stavu vrátí z dnešní definice (signaturu drží katalog); heals ji
# musí PŘEHRÁT — zdroj bez \ir v heals by se na běžící databázi nikdy neprojevil.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $zk$
DECLARE f oid; d text;
BEGIN
  SELECT p.oid INTO STRICT f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_search_personality_context';
  d := replace(pg_get_functiondef(f), 'AND public.knowledge_state_readable(ki.quarantine_status)', '');
  EXECUTE d;
  EXECUTE format('ALTER FUNCTION %s SET search_path TO ''public'', ''extensions''', f::regprocedure);
END $zk$;
SQL
stara=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='fn_search_personality_context' AND p.prosrc NOT LIKE '%knowledge_state_readable%' AND array_to_string(p.proconfig, ',') NOT LIKE '%pg_temp%';")
if [ "${stara:-0}" -ne 1 ]; then
  echo "❌ setup error: hledání rysů osobnosti se nepodařilo vrátit do starého stavu — přehrání z heals by se neměřilo"; exit 1
fi
# ── druhý index znalostí do stavu dnešních instancí ──────────────────────────
# Na databázi založené dřív spoušť o stavu karantény neví a sestavení dokumentu
# ho nečte. Sonda obě funkce nahradí tělem BEZ nového rozhodování (signatury
# jsou bez typů rozšíření, jdou založit přímo); heals je musí PŘEHRÁT.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE OR REPLACE FUNCTION public.fn_notify_knowledge_change() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $zk$ BEGIN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $zk$;
CREATE OR REPLACE FUNCTION public.fn_build_ragnarok_document(p_source_table text, p_source_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $zk$ BEGIN RETURN '{}'::jsonb; END $zk$;
DROP FUNCTION IF EXISTS public.knowledge_ragnarok_action(text, text, text, text, text, boolean);
SQL
stare=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('fn_notify_knowledge_change','fn_build_ragnarok_document') AND p.prosrc NOT LIKE '%knowledge_%' AND array_to_string(p.proconfig, ',') NOT LIKE '%pg_temp%';")
if [ "${stare:-0}" -ne 2 ]; then
  echo "❌ setup error: funkce druhého indexu se nepodařilo vrátit do starého stavu ($stare ze 2) — přehrání z heals by se neměřilo"; exit 1
fi
# ── citace běhu do stavu dnešních instancí ───────────────────────────────────
# Na databázi založené dřív má funkce sloupce bez aliasu tabulky a každé volání končí
# chybou 42702. Sonda ji do toho stavu vrátí z dnešní definice; heals ji musí PŘEHRÁT
# a krok 5 ji opravdu ZAVOLÁ (text funkce by vadu, která se projeví až při volání, neukázal).
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $zk$
DECLARE f oid;
BEGIN
  SELECT p.oid INTO STRICT f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_get_run_citations';
  EXECUTE replace(pg_get_functiondef(f), 'ka.relevance_score', 'relevance_score');
END $zk$;
SQL
if psql "$PROBE_URL" -v ON_ERROR_STOP=1 -tA -c "BEGIN; SET LOCAL ROLE service_role; SELECT count(*) FROM public.fn_get_run_citations(gen_random_uuid()); ROLLBACK;" >/dev/null 2>&1; then
  echo "❌ setup error: citace běhu po návratu do starého stavu NEPADAJÍ — přehrání z heals by se neměřilo"; exit 1
fi
# ── čtecí funkce znalostí do stavu dnešních instancí ─────────────────────────
# Na databázi založené dřív filtrují stav výčtem zakázaných hodnot (nebo vůbec) a
# pomocník čitelného stavu neexistuje. Sonda z dnešních definic volání pomocníka
# vymění za starý výčet (signatury drží katalog) a pomocníka zahodí: heals ho musí
# založit DŘÍV, než přehrají první funkci, a přehrát všech deset souborů.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $zk$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('mcp_search_knowledge_v2','mcp_search_knowledge_v3','fn_get_platform_warmup_state','mcp_get_knowledge_item','fn_get_psyche_traits','fn_get_tao_principles','fn_get_run_citations','fn_get_run_extract_context','extract_training_pairs_from_kb','compose_context') LOOP
    EXECUTE regexp_replace(pg_get_functiondef(r.oid), 'public\.knowledge_state_readable\((\w+)\.quarantine_status\)',
                           '\1.quarantine_status NOT IN (''flagged'', ''quarantined'')', 'g');
  END LOOP;
END $zk$;
DROP FUNCTION public.knowledge_state_readable(text);
SQL
# Kolik funkcí tu je, určuje i starší část sondy (v2 a v3 vrací do tvaru před Brick6);
# podmínka je proto „žádná už pomocníka nevolá a pomocník neexistuje“, ne pevný počet.
stare=$(scalar "SELECT count(*) FILTER (WHERE p.prosrc LIKE '%knowledge_state_readable%') || '/' || (SELECT count(*) FROM pg_proc h JOIN pg_namespace hn ON hn.oid=h.pronamespace WHERE hn.nspname='public' AND h.proname='knowledge_state_readable') || '/' || (count(*) >= 8) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('mcp_search_knowledge_v2','mcp_search_knowledge_v3','fn_get_platform_warmup_state','mcp_get_knowledge_item','fn_get_psyche_traits','fn_get_tao_principles','fn_get_run_citations','fn_get_run_extract_context','extract_training_pairs_from_kb','compose_context');")
if [ "$stare" != "0/0/true" ]; then
  echo "❌ setup error: čtecí funkce znalostí se nepodařilo vrátit do starého stavu ($stare; čekám 0 s pomocníkem / 0 pomocníků / aspoň 8 funkcí) — přehrání z heals by se neměřilo"; exit 1
fi
# ── fronty zpracování a graf běhu do stavu dnešních instancí ─────────────────
# Na databázi založené dřív stav položky nečtou vůbec a cestu mají 'public'. Sonda z dnešních
# definic volání pomocníka vyjme a cestu vrátí; heals musí přehrát všechny čtyři soubory.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $zk$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('fn_get_chunks_needing_context','fn_get_embeddings_needing_v2','fn_chunks_bez_zive_identity','fn_get_run_graph_context') LOOP
    EXECUTE replace(regexp_replace(pg_get_functiondef(r.oid), '\s+AND public\.knowledge_state_readable\(ki\.quarantine_status\)', '', 'g'),
                    $$SET search_path TO 'pg_catalog', 'public', 'pg_temp'$$, $$SET search_path TO 'public'$$);
  END LOOP;
END $zk$;
SQL
stare=$(scalar "SELECT count(*) FILTER (WHERE p.prosrc LIKE '%knowledge_state_readable%') || '/' || count(*) FILTER (WHERE array_to_string(p.proconfig, ',') LIKE '%pg_temp%') || '/' || count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('fn_get_chunks_needing_context','fn_get_embeddings_needing_v2','fn_chunks_bez_zive_identity','fn_get_run_graph_context');")
if [ "$stare" != "0/0/4" ]; then
  echo "❌ setup error: fronty zpracování a graf běhu se nepodařilo vrátit do starého stavu ($stare; čekám 0 s pomocníkem / 0 se zpevněnou cestou / 4 funkce) — přehrání z heals by se neměřilo"; exit 1
fi
# ── čtení podle id do stavu dnešních instancí ────────────────────────────────
# Na databázi založené dřív má funkce dva parametry (bez publika). Sonda ji do toho tvaru vrátí:
# heals musí starou signaturu zahodit a založit novou — jinak zůstanou dvě přetížení a volání
# dvěma jmennými parametry skončí „is not unique“ (poučení z hledání v2).
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP FUNCTION public.mcp_get_knowledge_item(uuid, text, uuid);
CREATE FUNCTION public.mcp_get_knowledge_item(p_item_id uuid DEFAULT NULL::uuid, p_source_slug text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE sql STABLE AS $zk$ SELECT NULL::jsonb $zk$;
SQL
stare=$(scalar "SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ' ORDER BY 1) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='mcp_get_knowledge_item';")
if [ "$stare" != "p_item_id uuid, p_source_slug text" ]; then
  echo "❌ setup error: čtení podle id se nepodařilo vrátit na dvouargumentový tvar ($stare) — výměna signatury by se neměřila"; exit 1
fi
# ── granty funkcí spouští znalostí do stavu dnešních instancí ────────────────
# Na databázi založené dřív mají obě funkce EXECUTE pro PUBLIC, authenticated i service_role.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT EXECUTE ON FUNCTION public.sync_expert_rule_to_knowledge_item() TO PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_topic_version_to_knowledge_item() TO PUBLIC, authenticated, service_role;
SQL
stare=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) r(role) WHERE ns.nspname='public' AND p.proname IN ('sync_expert_rule_to_knowledge_item','sync_topic_version_to_knowledge_item') AND has_function_privilege(r.role, p.oid, 'EXECUTE');")
if [ "${stare:-0}" -ne 6 ]; then
  echo "❌ setup error: granty funkcí spouští znalostí se nepodařilo vrátit ($stare ze 6) — jejich odebrání by se neměřilo"; exit 1
fi
# ── granty statistik znalostí do stavu dnešních instancí ─────────────────────
# Na databázi založené dřív má funkce EXECUTE pro anon i authenticated.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q -c "GRANT EXECUTE ON FUNCTION public.mcp_get_knowledge_stats() TO anon, authenticated;"
stare=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace CROSS JOIN (VALUES ('anon'),('authenticated')) r(role) WHERE ns.nspname='public' AND p.proname='mcp_get_knowledge_stats' AND has_function_privilege(r.role, p.oid, 'EXECUTE');")
if [ "${stare:-0}" -ne 2 ]; then
  echo "❌ setup error: granty statistik znalostí se nepodařilo vrátit ($stare ze 2) — jejich odebrání by se neměřilo"; exit 1
fi
# ── čtení osobnosti do stavu dnešních instancí ───────────────────────────────
# Na databázi založené dřív čtou rysy a zásady položky VŠECH příběhů. Sonda ze tří funkcí
# podmínku na příběh odebere (v2 a v3 sonda zahazuje celé — tam stačí kontrola po heals).
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $zk$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('fn_get_psyche_traits', 'fn_get_tao_principles', 'fn_search_personality_context') LOOP
    EXECUTE replace(pg_get_functiondef(r.oid), 'AND ki.story_id IS NULL', '');
  END LOOP;
END $zk$;
SQL
stare=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('fn_get_psyche_traits','fn_get_tao_principles','fn_search_personality_context') AND p.prosrc NOT LIKE '%ki.story_id IS NULL%';")
if [ "${stare:-0}" -ne 3 ]; then
  echo "❌ setup error: čtení osobnosti se nepodařilo vrátit do starého stavu ($stare ze 3) — přehrání z heals by se neměřilo"; exit 1
fi
# ── hledání v2 do stavu předchozího mainu: DVĚ přetížení ─────────────────────
# Sonda výš nechává jen starou 9argumentovou v2. Na instancích je vedle ní 11argumentová a ty
# dvě se liší jen parametry s výchozí hodnotou — volání bez příběhu je nejednoznačné. Sonda
# 11argumentovou založí a ZMĚŘÍ, že volání bez příběhu opravdu padá; heals musí nechat jednu.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE FUNCTION public.mcp_search_knowledge_v2(p_query_embedding vector DEFAULT NULL, p_query_text text DEFAULT NULL, p_item_types text[] DEFAULT '{}', p_category text DEFAULT NULL, p_expertise_slug text DEFAULT NULL, p_context_tags text[] DEFAULT '{}', p_include_ai_instructions boolean DEFAULT true, p_limit integer DEFAULT 20, p_similarity_threshold double precision DEFAULT 0.3, p_story_id uuid DEFAULT NULL, p_audience_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS 'SELECT ''[]''::jsonb';
SQL
v2n=$(scalar "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='mcp_search_knowledge_v2';")
if [ "${v2n:-0}" -ne 2 ] || psql "$PROBE_URL" -v ON_ERROR_STOP=1 -qtA -c "SELECT public.mcp_search_knowledge_v2(p_query_text => 'x'::text);" >/dev/null 2>&1; then
  echo "❌ setup error: stav „dvě přetížení v2, volání bez příběhu nejednoznačné“ se nepodařilo založit (přetížení: ${v2n:-?}) — odstranění by se neměřilo"; exit 1
fi
# ── expertní pravidla do stavu předchozího mainu (revize B1) ─────────────────
# Politiky čtení napřímo s vlastními výčty (soubor politik v heals nebyl), pomocník viditelnosti pravidel
# neexistuje a čtyři čtenáři mají tvar bez parametru publika. Heals musí politiky převést na domov,
# pomocníka založit, staré tvary zahodit a čtenáře přehrát. Politiky PŘED zahozením množiny štítků níž
# (nové na ní závisí).
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP POLICY IF EXISTS anon_read_public_rules ON public.expert_rules;
DROP POLICY IF EXISTS auth_read_public_and_members_rules ON public.expert_rules;
CREATE POLICY anon_read_public_rules ON public.expert_rules FOR SELECT TO anon USING (status = 'published' AND visibility = 'public');
CREATE POLICY auth_read_public_and_members_rules ON public.expert_rules FOR SELECT TO authenticated USING (status = 'published' AND visibility IN ('public', 'members'));
DROP FUNCTION IF EXISTS public.get_expert_rule_detail(text, uuid);
DROP FUNCTION IF EXISTS public.mcp_get_rule_detail(text, uuid);
DROP FUNCTION IF EXISTS public.mcp_search_knowledge(text, text, text, text[], boolean, integer, uuid);
DROP FUNCTION IF EXISTS public.mcp_get_agent_knowledge(text, text, uuid);
CREATE FUNCTION public.get_expert_rule_detail(p_rule_slug text) RETURNS jsonb LANGUAGE sql AS $zk$ SELECT NULL::jsonb $zk$;
CREATE FUNCTION public.mcp_get_rule_detail(p_rule_slug text) RETURNS jsonb LANGUAGE sql AS $zk$ SELECT NULL::jsonb $zk$;
CREATE FUNCTION public.mcp_search_knowledge(p_query text DEFAULT NULL, p_category text DEFAULT NULL, p_expertise_slug text DEFAULT NULL, p_context_tags text[] DEFAULT '{}', p_include_ai_instructions boolean DEFAULT true, p_limit integer DEFAULT 20) RETURNS jsonb LANGUAGE sql AS $zk$ SELECT '[]'::jsonb $zk$;
CREATE FUNCTION public.mcp_get_agent_knowledge(p_agent_slug text, p_binding_type text DEFAULT NULL) RETURNS TABLE(id uuid) LANGUAGE sql AS $zk$ SELECT NULL::uuid WHERE false $zk$;
DROP FUNCTION IF EXISTS public.expert_rule_visible_to(text, uuid, uuid);
SQL
stare=$(scalar "SELECT (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.expert_rules'::regclass AND pg_get_expr(polqual, polrelid) LIKE '%knowledge_visibilities_for_caller%') || '/' || (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'expert_rule_visible_to') || '/' || (SELECT string_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')', ',' ORDER BY proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('get_expert_rule_detail', 'mcp_get_rule_detail', 'mcp_get_agent_knowledge'));")
if [ "$stare" != "0/0/get_expert_rule_detail(p_rule_slug text),mcp_get_agent_knowledge(p_agent_slug text, p_binding_type text),mcp_get_rule_detail(p_rule_slug text)" ]; then
  echo "❌ setup error: expertní pravidla se nepodařilo vrátit do stavu předchozího mainu ($stare) — přehrání z heals by se neměřilo"; exit 1
fi
# ── pomocník viditelnosti: na databázi založené dřív neexistuje, nebo má dva vstupy ──
# (v2 a v3 sonda vrací do starého tvaru výš; heals musí pomocníka založit DŘÍV, než je přehrají.
# Politiky tabulky jsou v tu chvíli staré — na domov nezávisí, proto ho jde zahodit.)
# Sonda nechá dvouvstupový tvar bez „je přihlášen“: heals ho musí zahodit — žádný obal vedle nového.
# Množina štítků pro politiky a domov gildy na databázi založené dřív neexistují — sonda je zahodí, heals je musí založit.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP FUNCTION IF EXISTS public.knowledge_visibility_for_caller(text);
DROP FUNCTION IF EXISTS public.knowledge_visibilities_for_caller();
DROP FUNCTION IF EXISTS public.knowledge_audience_in_guild(uuid);
DROP FUNCTION IF EXISTS public.knowledge_visibility_searchable(text, boolean, boolean);
CREATE OR REPLACE FUNCTION public.knowledge_visibility_searchable(p_visibility text, p_in_guild boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $zk$ SELECT true $zk$;
SQL
stare=$(scalar "SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ' ORDER BY 1) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='knowledge_visibility_searchable';")
if [ "$stare" != "p_visibility text, p_in_guild boolean" ]; then
  echo "❌ setup error: pomocník viditelnosti se nepodařilo vrátit na dvouvstupový tvar ($stare) — výměna signatury by se neměřila"; exit 1
fi
# ── vrstva mozku do tvaru předchozího mainu: bez parametru publika (a bez viditelnosti) ──
# Heals musí bezargumentový tvar zahodit (soubory nesou DROP) a založit tvar s publikem — jinak by
# vedle sebe žila dvě přetížení a volání bez argumentů by skončilo „is not unique“.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP FUNCTION IF EXISTS public.fn_get_tao_principles(uuid);
DROP FUNCTION IF EXISTS public.fn_get_psyche_traits(uuid);
CREATE FUNCTION public.fn_get_tao_principles() RETURNS jsonb LANGUAGE sql AS $zk$ SELECT '[]'::jsonb $zk$;
CREATE FUNCTION public.fn_get_psyche_traits() RETURNS jsonb LANGUAGE sql AS $zk$ SELECT '[]'::jsonb $zk$;
SQL
stare=$(scalar "SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ',' ORDER BY 1) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('fn_get_tao_principles','fn_get_psyche_traits');")
if [ "$stare" != "fn_get_psyche_traits(),fn_get_tao_principles()" ]; then
  echo "❌ setup error: vrstvu mozku se nepodařilo vrátit na bezargumentový tvar ($stare) — výměna signatury by se neměřila"; exit 1
fi
# ── spoušť guardu profilu partnera do stavu předchozího mainu: jen BEFORE UPDATE (tgtype 19) ──
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP TRIGGER IF EXISTS partner_profiles_privilege_guard ON public.partner_profiles;
CREATE TRIGGER partner_profiles_privilege_guard BEFORE UPDATE ON public.partner_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_partner_profile_privilege_columns();
SQL
stara=$(scalar "SELECT tgtype FROM pg_trigger WHERE tgrelid = 'public.partner_profiles'::regclass AND tgname = 'partner_profiles_privilege_guard';")
if [ "${stara:-0}" -ne 19 ]; then
  echo "❌ setup error: spoušť guardu se nepodařilo vrátit na BEFORE UPDATE ($stara) — přehrání z heals by se neměřilo"; exit 1
fi
# ── seznam položek příběhu do stavu předchozího mainu: bez vlastníka ─────────────
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $zk$
DECLARE f oid;
BEGIN
  SELECT p.oid INTO STRICT f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'list_story_knowledge_items';
  EXECUTE replace(pg_get_functiondef(f), 'AND (ps.user_id = v_user_id', 'AND (false');
END $zk$;
SQL
stara=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='list_story_knowledge_items' AND p.prosrc NOT LIKE '%(ps.user_id = v_user_id%';")
if [ "${stara:-0}" -ne 1 ]; then
  echo "❌ setup error: seznam položek příběhu se nepodařilo vrátit do stavu bez vlastníka — přehrání z heals by se neměřilo"; exit 1
fi
# ── graf běhu do stavu dnešních instancí ─────────────────────────────────────
# Na databázi založené dřív čte závěrečný dotaz výstupní sloupce bez aliasu a volání s citacemi
# končí 42702. Sonda funkci do toho stavu vrátí a ZMĚŘÍ, že volání padá (běh musí mít citaci —
# bez ní se funkce vrací dřív a vada by se neprojevila).
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $zk$
DECLARE f oid;
BEGIN
  SELECT p.oid INTO STRICT f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_get_run_graph_context';
  EXECUTE replace(pg_get_functiondef(f), 'hops.seed_label', 'seed_label');
END $zk$;
SQL
if psql "$PROBE_URL" -v ON_ERROR_STOP=1 -qtA >/dev/null 2>&1 <<'SQL'
BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES ('0f0f0f0f-0000-4000-8000-00000000a001', 'zk-upgrade-graf@test.local');
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('0f0f0f0f-0000-4000-8000-00000000a002', 'ZK upgrade graf', '0f0f0f0f-0000-4000-8000-00000000a001');
INSERT INTO public.ai_runs (id, kind, story_id, citation_chunk_ids) VALUES ('0f0f0f0f-0000-4000-8000-00000000a003', 'chat', '0f0f0f0f-0000-4000-8000-00000000a002', ARRAY[gen_random_uuid()]);
SET LOCAL ROLE service_role;
SELECT count(*) FROM public.fn_get_run_graph_context('0f0f0f0f-0000-4000-8000-00000000a003'::uuid, NULL, NULL);
ROLLBACK;
SQL
then
  echo "❌ setup error: graf běhu po návratu do starého stavu NEPADÁ — přehrání z heals by se neměřilo"; exit 1
fi
# ── čtyři mrtvé funkce, které heals odstraňují ───────────────────────────────
# Na databázi založené dřív existují (zdroj je smazaný, baseline je už nenese).
# Sonda je proto založí se STEJNOU signaturou — jinak by DROP … IF EXISTS byl
# no-op a kontrola v kroku 5 by prošla nad ničím.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE FUNCTION public.raw_query_admin(p_sql text, p_params text[] DEFAULT '{}'::text[]) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN END $f$;
CREATE FUNCTION public.edge_database_dump_table(p_actor_user_id uuid, p_table text) RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;
CREATE FUNCTION public.fn_rollback_agent_config(p_agent_configuration_id uuid, p_proposal_id uuid DEFAULT NULL, p_reason text DEFAULT 'auto_rollback_regression', p_target_version integer DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;
CREATE FUNCTION public.get_story_basic_info(p_story_id uuid DEFAULT NULL) RETURNS TABLE(id uuid, title text) LANGUAGE plpgsql AS $f$ BEGIN RETURN; END $f$;
SQL
mrtve=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('raw_query_admin','edge_database_dump_table','fn_rollback_agent_config','get_story_basic_info');")
if [ "${mrtve:-0}" -ne 4 ]; then
  echo "❌ setup error: mrtvé funkce se nepodařilo založit ($mrtve ze 4) — jejich odstranění by se neměřilo"; exit 1
fi
# ── příjem pošty: staré signatury, které heals zahodí (2026-10-06) ─────────────
# Baseline už nese jen nové tvary (append s p_event_id, výběr opakování s p_sources)
# a jednorázový ingest vůbec ne. Na dřívějších databázích ale staré signatury jsou —
# a dokud jsou, jdou volat a kontrolu skenu obcházejí. Sonda je proto založí.
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE FUNCTION public.append_inbound_comm_entry_audited(p_story_id uuid, p_channel text, p_external_id text, p_from text DEFAULT NULL, p_subject text DEFAULT NULL, p_body text DEFAULT NULL, p_parent_entry_id uuid DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;
CREATE FUNCTION public.ingest_inbound_comm_audited(p_channel text, p_external_id text, p_story_id uuid, p_from text DEFAULT NULL, p_subject text DEFAULT NULL, p_body text DEFAULT NULL, p_parent_entry_id uuid DEFAULT NULL, p_routed_to text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;
CREATE FUNCTION public.get_retryable_integration_events(p_limit integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN RETURN '[]'::jsonb; END $f$;
SQL
posta_stare=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.oid::regprocedure::text IN ('append_inbound_comm_entry_audited(uuid,text,text,text,text,text,uuid,jsonb)','ingest_inbound_comm_audited(text,text,uuid,text,text,text,uuid,text,jsonb)','get_retryable_integration_events(integer)')")
if [ "${posta_stare:-0}" -ne 3 ]; then
  echo "❌ setup error: staré signatury příjmu pošty se nepodařilo založit ($posta_stare ze 3) — jejich odstranění by se neměřilo"; exit 1
fi
# ── schéma public do stavu dnešních instancí ─────────────────────────────────
# Změřeno 2026-10-03 na živé instanci: {vlastník=UC, postgres=UC, =UC} — CREATE
# pro PUBLIC a ŽÁDNÝ výslovný grant roli, která v public vytváří (smazal ho reset).
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT CREATE ON SCHEMA public TO PUBLIC;
REVOKE ALL ON SCHEMA public FROM nocodb_app;
SQL
# Kontrolní vzorek MĚŘIDLA: nad tímhle stavem musí kontrola SELHAT, a to pro díru,
# ne z jiného důvodu. Kdyby prošla, zelená v kroku 5 by neznamenala nic.
verify_out=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q -f "$VERIFY_PUBLIC" 2>&1) && verify_rc=0 || verify_rc=$?
case "$verify_rc:$verify_out" in
  0:*) echo "❌ setup error: kontrola schématu public PROŠLA nad stavem s CREATE pro PUBLIC — měřidlo díru nevidí"; exit 1 ;;
  *"PUBLIC má ve schématu public právo CREATE"*) ;;
  *) echo "❌ setup error: kontrola schématu public selhala z jiného důvodu než kvůli díře (rc=$verify_rc): $verify_out"; exit 1 ;;
esac
acl_out=$(verify_public_acl "$PROBE_URL" 2>&1) && acl_rc=0 || acl_rc=$?
case "$acl_rc:$acl_out" in
  0:*) echo "❌ setup error: čtecí kontrola schématu public PROŠLA tam, kde zkouška chováním ukázala díru — živé ověření by ji nevidělo"; exit 1 ;;
  *"PUBLIC má ve schématu public právo CREATE"*) ;;
  *) echo "❌ setup error: čtecí kontrola schématu public selhala z jiného důvodu než kvůli díře (rc=$acl_rc): $acl_out"; exit 1 ;;
esac
echo "   regressed: agent-activity surface + generational tables stripped of attribute columns (column-drift) + whole-dropped tables + 9 enums removed + #516/#512 discussion/news surface + schema public ACL as on today's instances + 4 dead definer functions recreated"

echo "── 4/6  re-run the REAL runner — the prod-redeploy path (heals.sql) ─────"
# No pending deltas now: this exercises migrate.mjs's no-pending branch, which is
# precisely the existing-DB case that must still apply heals.sql.
( cd "$ROOT" && AISHA_DB_URL="$PROBE_URL" node scripts/db/migrate.mjs )

echo "── 5/6  assert the surface is reconciled ───────────────────────────────"
fail=0
assert_col() {
  local tbl="$1" col="$2" n
  n=$(scalar "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='$tbl' AND column_name='$col';")
  if [ "${n:-0}" -lt 1 ]; then echo "   ❌ missing column $tbl.$col"; fail=1; else echo "   ✓ $tbl.$col"; fi
}
assert_tbl() {
  local tbl="$1" got
  got=$(scalar "SELECT to_regclass('public.$tbl');")
  if [ -z "$got" ]; then echo "   ❌ missing table $tbl"; fail=1; else echo "   ✓ $tbl"; fi
}
assert_fn() {
  local sig="$1" got
  got=$(scalar "SELECT to_regprocedure('$sig');")
  if [ -z "$got" ]; then echo "   ❌ missing function $sig"; fail=1; else echo "   ✓ $sig"; fi
}
# Pro funkce, jejichž signatura se legitimně vyvíjí: ověřuje se, že heals
# funkci VRÁTILY, ne jakým tvarem. Signaturu hlídá heals-signature-drift.
assert_fn_by_name() {
  local name="$1" n
  n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='$name';")
  if [ "${n:-0}" -lt 1 ]; then echo "   ❌ missing function public.$name (any signature)"; fail=1; else echo "   ✓ public.$name ($n overload(s))"; fi
}
assert_policy() {
  local tbl="$1" pol="$2" n
  n=$(scalar "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='$tbl' AND policyname='$pol';")
  if [ "${n:-0}" -lt 1 ]; then echo "   ❌ missing policy $tbl.$pol"; fail=1; else echo "   ✓ policy $tbl.$pol"; fi
}
# li_* evidence silo — BOTH halves. Functions alone would be a green probe over
# no data: the tables have RLS enabled, so without a policy every row is denied.
assert_fn 'public.get_document_register(jsonb)'
assert_fn 'public.get_document_detail(jsonb)'
assert_fn 'public.get_document_digest(jsonb)'
assert_fn 'public.get_obligation_queue(jsonb)'
assert_fn 'public.get_evidence_findings(jsonb)'
assert_fn 'public.get_finding_questions(jsonb)'
assert_fn 'public.li_list_documents(text, text, uuid, integer, integer)'
assert_fn 'public.li_get_document(text)'
assert_fn 'public.li_list_obligations(text, text, integer, integer)'
assert_fn 'public.li_list_findings(text, integer, integer)'
assert_fn 'public.li_list_links(text, text, integer, integer)'
assert_fn 'public.li_list_entity_suggestions(integer, integer)'
assert_fn_by_name 'submit_evidence_review_audited'   # zapisovatel — signatura se mění, existence ne
# Fronta předání ze zdroje (2026-09-26): heals vrátil oba indexy registru
# (postavené nad řádky, které v registru už ležely) a NOVOU funkci s dvoukrokovým
# čtením — ne jen „nějakou“ get_workflow_my_steps_block.
for fz_idx in idx_li_source_registry_doc_slug_valid idx_li_source_registry_fields_gin; do
  n=$(scalar "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='$fz_idx';")
  if [ "${n:-0}" -lt 1 ]; then echo "   ❌ missing index $fz_idx"; fail=1; else echo "   ✓ index $fz_idx"; fi
done
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='get_workflow_my_steps_block' AND p.prosrc LIKE '%stable_key%' AND p.prosrc LIKE '%src_ptr%' AND p.prosecdef;")
if [ "${n:-0}" -lt 1 ]; then echo "   ❌ get_workflow_my_steps_block zůstala STARÁ (bez stable_key/src_ptr nebo bez SECURITY DEFINER)"; fail=1; else echo "   ✓ get_workflow_my_steps_block s source_state.stable_key"; fi
n=$(scalar "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='idx_li_source_registry_fields_gin' AND indexdef LIKE '%jsonb_path_ops%' AND indexdef LIKE '%superseded_by IS NULL%';")
if [ "${n:-0}" -lt 1 ]; then echo "   ❌ idx_li_source_registry_fields_gin nemá tvar GIN jsonb_path_ops / partial"; fail=1; else echo "   ✓ idx_li_source_registry_fields_gin: GIN jsonb_path_ops, partial"; fi
# Executor akcí po události (F3a, 2026-09-28): RPC, indexy, CHECK principála a NOVÝ
# dispečer (bez pg_net, notify jen s identifikátory) — a data na existující DB přežila:
# pravidlo bez principála zůstalo (CHECK je NOT VALID, migrate kvůli němu nespadl).
assert_fn 'public.claim_proactive_run(uuid, text, text[])'
assert_fn 'public.claim_pending_proactive_runs(text, text[], integer, integer)'
assert_fn 'public.requeue_stale_proactive_runs(text[], integer, integer)'
assert_fn 'public.finish_proactive_run(uuid, text, text, jsonb, text)'
assert_fn 'public.record_cron_proactive_run(uuid, timestamp with time zone)'
assert_fn 'public.list_cron_proactive_definitions(text[])'
for f3a_idx in idx_ai_proactive_runs_otevrene uq_ai_proactive_runs_cron_slot; do
  n=$(scalar "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='$f3a_idx';")
  if [ "${n:-0}" -lt 1 ]; then echo "   ❌ missing index $f3a_idx"; fail=1; else echo "   ✓ index $f3a_idx"; fi
done
n=$(scalar "SELECT count(*) FROM pg_constraint WHERE conname='ai_proactive_defs_executor_principal_check';")
if [ "${n:-0}" -lt 1 ]; then echo "   ❌ chybí CHECK ai_proactive_defs_executor_principal_check"; fail=1; else echo "   ✓ CHECK principála pravidel executoru"; fi
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='fn_dispatch_proactive_triggers' AND p.prosrc NOT LIKE '%net.http_post%' AND p.prosrc LIKE '%proactive_run_id%' AND p.prosrc NOT LIKE '%''source_data'',%';")
if [ "${n:-0}" -lt 1 ]; then echo "   ❌ fn_dispatch_proactive_triggers zůstal STARÝ (pg_net nebo řádek v notify)"; fail=1; else echo "   ✓ dispečer bez pg_net, notify jen s identifikátory"; fi
n=$(scalar "SELECT count(*) FROM public.ai_proactive_trigger_definitions WHERE name='upgrade-probe-f3a-bez-principala';")
if [ "${n:-0}" -ne 1 ]; then echo "   ❌ heals smazal/ztratil existující pravidlo (data na existující DB nesmí zmizet)"; fail=1; else echo "   ✓ existující pravidlo bez principála přežilo (CHECK NOT VALID)"; fi
# 2026-07-30: čtecí policies SLOUČENY (perf: predikát nároku do InitPlanu) —
# li_source_registry_{admin_select,member_tier_select,read_admin} → _read,
# li_obligations_{admin_select,read_admin} → _read. Verifier musí asertovat
# KANONICKÁ jména, jinak je gate červený na každém commitu od toho sloučení
# (přesně to se stalo: #46 v mainu, cold-start padal i na nasazeném HEAD).
assert_policy li_source_registry    li_source_registry_read
assert_policy li_obligations        li_obligations_read
assert_policy li_findings           li_findings_admin_select
assert_policy li_links              li_links_admin_select
assert_policy li_entity_suggestions li_entity_suggestions_admin_select
assert_policy li_finding_verdicts   li_finding_verdicts_admin_select
assert_tbl li_finding_verdicts
assert_col claude_hook_bindings config
assert_col agent_runs inputs
assert_tbl agent_phase_catalog
assert_tbl agent_live_sessions
assert_tbl ai_cost_class_catalog
assert_tbl ai_spend_policies
assert_fn 'public.aisha_pre_request()'

# ── #516/#512 existing-DB reconcile (this PR): the polymorphic-discussion +
#    news-archive surface. story_entries regains its 4 #516 columns (subject_id
#    re-enforced NOT NULL after backfill), the entry_type_definitions registry is
#    re-created (the reseed in 6/6 inserts into it), and news_articles.tags + its
#    reader RPC are back. Without the heals reconcile these stay missing and the
#    reseed (6/6) aborts on the missing table — the exact prod-redeploy failure. ──
assert_col story_entries subject_type
assert_col story_entries subject_id
assert_col story_entries status
assert_col story_entries moderation_reason
assert_tbl entry_type_definitions
assert_col news_articles tags
assert_fn 'public.get_news_tags()'

# ── the 61 "generational" feature tables — the heals reconcile this gate exists
#    to prove. Each was dropped above; all must be back after the real migrate
#    re-applied heals.sql (the prod-redeploy path). Order = baseline FK-topo. ──
assert_tbl ai_decisions
assert_tbl ai_provider_registry
assert_tbl ai_risk_policies
assert_tbl ai_batch_jobs
assert_tbl ai_runtime_registry
assert_tbl aisha_static_defense_rules
assert_tbl aitg_aisha_reflections
assert_tbl aitg_automation_settings
assert_tbl aitg_test_catalog
assert_tbl aitg_drift_alerts
assert_tbl aitg_payloads
assert_tbl aitg_payload_proposals
assert_tbl aitg_runs
assert_tbl aitg_findings
assert_tbl aitg_waivers
assert_tbl audience_broker_sync_state
assert_tbl ai_run_critic_iterations
assert_tbl delivery_statuses
assert_tbl dirigent_nudges
assert_tbl flowboard_graphs
assert_tbl intranet_chat_channels
assert_tbl intranet_chat_members
assert_tbl intranet_chat_messages
assert_tbl lead_submissions
assert_tbl llm_tier_defaults
assert_tbl llm_quota
assert_tbl mcp_server_registry
assert_tbl message_user_feedback
assert_tbl openclaw_notifications
assert_tbl branding_hostname_mapping
assert_tbl personality_signals
assert_tbl plugin_catalog
assert_tbl plugin_audit_events
assert_tbl plugin_health_events
assert_tbl plugin_kv
assert_tbl plugin_schedules
assert_tbl plugin_tenant_overrides
assert_tbl plugin_transition_rules
assert_tbl plugin_versions
assert_tbl rag_eval_baselines
assert_tbl signal_tag_rules
assert_tbl story_goal_state
assert_tbl graph_nodes
assert_tbl graph_edges
assert_tbl knowledge_multimodal_pages
assert_tbl agent_knowledge_bindings
assert_tbl playwright_runs
assert_tbl rag_eval_golden
assert_tbl rag_eval_runs
assert_tbl sla_tracking
assert_tbl story_matrix_rooms
assert_tbl user_engagement_metrics
assert_tbl tracked_actions
assert_tbl voice_rooms
assert_tbl call_events
assert_tbl call_participants
assert_tbl consultation_sessions
assert_tbl web_artifact_jobs
assert_tbl workbench_execution_requests
assert_tbl workflow_statuses
assert_tbl workflow_status_transitions

# ── COLUMN-DRIFT restore proof: the column-dropped tables still EXIST (the
#    assert_tbl above passes trivially for them); what matters is that the
#    backfill-aware heals re-ADDED every stripped attribute column. A
#    representative column per table (incl. plugin_catalog.agent_spec — the
#    exact prod failure) must be back. If heals only \\ir'd the table file
#    (CREATE TABLE IF NOT EXISTS = no-op on the surviving older table) these
#    would be MISSING.
assert_col ai_provider_registry display_name
assert_col ai_provider_registry is_enabled
assert_col ai_provider_registry updated_at
assert_col ai_risk_policies auto_allow_at_or_below
assert_col ai_risk_policies is_active
assert_col ai_risk_policies updated_at
assert_col ai_batch_jobs status
assert_col ai_batch_jobs actual_cost
assert_col ai_batch_jobs updated_at
assert_col ai_runtime_registry runtime_kind
assert_col ai_runtime_registry needs_network
assert_col ai_runtime_registry updated_at
assert_col ai_runtime_registry is_in_process_executor
assert_col ai_model_registry provider_registry_id
assert_col ai_model_registry slot_affinity
assert_col aisha_static_defense_rules category
assert_col aisha_static_defense_rules status
assert_col aisha_static_defense_rules updated_at
assert_col aitg_aisha_reflections trust_score_snapshot
assert_col aitg_aisha_reflections new_failures_count
assert_col aitg_aisha_reflections created_at
assert_col aitg_automation_settings display_name
assert_col aitg_automation_settings workflow_id
assert_col aitg_automation_settings created_at
assert_col aitg_test_catalog layer
assert_col aitg_test_catalog lifecycle_phases
assert_col aitg_test_catalog created_at
assert_col aitg_drift_alerts test_id
assert_col aitg_drift_alerts severity
assert_col aitg_drift_alerts created_at
assert_col aitg_payloads test_id
assert_col aitg_payloads tags
assert_col aitg_payloads created_at
assert_col aitg_payload_proposals test_id
assert_col aitg_payload_proposals proposed_by
assert_col aitg_payload_proposals created_at
assert_col aitg_runs test_id
assert_col aitg_runs evidence_uri
assert_col aitg_runs finished_at
assert_col aitg_findings run_id
assert_col aitg_findings observed
assert_col aitg_findings fixed_at
assert_col aitg_waivers test_id
assert_col aitg_waivers approved_by
assert_col aitg_waivers created_at
assert_col audience_broker_sync_state last_sync_started_at
assert_col audience_broker_sync_state total_syncs
assert_col audience_broker_sync_state updated_at
assert_col ai_run_critic_iterations faithfulness_estimate
assert_col ai_run_critic_iterations judge_model
assert_col ai_run_critic_iterations created_at
assert_col flowboard_graphs slug
assert_col flowboard_graphs status
assert_col flowboard_graphs updated_at
assert_col intranet_chat_channels display_name
assert_col intranet_chat_channels is_archived
assert_col intranet_chat_channels updated_at
assert_col intranet_chat_members role
assert_col intranet_chat_members joined_at
assert_col intranet_chat_messages channel_id
assert_col intranet_chat_messages metadata
assert_col intranet_chat_messages updated_at
assert_col lead_submissions source
assert_col lead_submissions locale
assert_col lead_submissions updated_at
assert_col llm_tier_defaults daily_token_limit
assert_col llm_tier_defaults description
assert_col llm_tier_defaults updated_at
assert_col llm_quota tier
assert_col llm_quota consumed_cost_today
assert_col llm_quota updated_at
assert_col mcp_server_registry display_name
assert_col mcp_server_registry status
assert_col mcp_server_registry updated_at
assert_col openclaw_notifications channel
assert_col openclaw_notifications sent_at
assert_col openclaw_notifications updated_at
assert_col branding_hostname_mapping branding_profile_id
assert_col branding_hostname_mapping secondary_route
assert_col branding_hostname_mapping updated_at
assert_col personality_signals user_id
assert_col personality_signals weight
assert_col personality_signals created_at
assert_col plugin_catalog name
assert_col plugin_catalog config_schema
assert_col plugin_catalog updated_at
assert_col plugin_audit_events plugin_id
assert_col plugin_audit_events action
assert_col plugin_audit_events created_at
assert_col plugin_health_events plugin_id
assert_col plugin_health_events latency_ms
assert_col plugin_health_events recorded_at
assert_col plugin_kv value
assert_col plugin_kv created_at
assert_col plugin_kv updated_at
assert_col plugin_schedules cron_expr
assert_col plugin_schedules next_run_at
assert_col plugin_schedules updated_at
assert_col plugin_tenant_overrides enabled
assert_col plugin_tenant_overrides created_at
assert_col plugin_tenant_overrides updated_at
assert_col plugin_versions artifact_sha256
assert_col plugin_versions submitted_by
assert_col plugin_versions created_at
assert_col rag_eval_baselines n_runs
assert_col rag_eval_baselines context_recall_avg
assert_col rag_eval_baselines created_at
assert_col signal_tag_rules event_type_pattern
assert_col signal_tag_rules is_active
assert_col signal_tag_rules updated_at
assert_col story_goal_state acceptance_criteria
assert_col story_goal_state fingerprint
assert_col story_goal_state updated_at
assert_col graph_nodes entity_label
assert_col graph_nodes embedding
assert_col graph_nodes updated_at
assert_col graph_edges confidence
assert_col graph_edges source_ai_run_id
assert_col graph_edges created_at
assert_col knowledge_multimodal_pages page_image_uri
assert_col knowledge_multimodal_pages embedding_version
assert_col knowledge_multimodal_pages created_at
assert_col agent_knowledge_bindings agent_slug
assert_col agent_knowledge_bindings is_active
assert_col agent_knowledge_bindings created_by
assert_col playwright_runs trigger_kind
assert_col playwright_runs error_message
assert_col playwright_runs triggered_rollback_id
assert_col rag_eval_golden question
assert_col rag_eval_golden language
assert_col rag_eval_golden updated_at
assert_col rag_eval_runs golden_id
assert_col rag_eval_runs faithfulness_score
assert_col rag_eval_runs created_at
assert_col sla_tracking story_id
assert_col sla_tracking sla_breached
assert_col sla_tracking updated_at
assert_col story_matrix_rooms matrix_room_id
assert_col story_matrix_rooms created_at
assert_col story_matrix_rooms display_name
assert_col user_engagement_metrics app_accesses_30d
assert_col user_engagement_metrics unique_attendees_30d
assert_col user_engagement_metrics updated_at
assert_col voice_rooms name
assert_col voice_rooms is_active
assert_col voice_rooms updated_at
assert_col call_events voice_room_id
assert_col call_events event_type
assert_col call_events created_at
assert_col call_participants joined_at
assert_col call_participants is_muted
assert_col call_participants role
assert_col consultation_sessions voice_room_id
assert_col consultation_sessions duration_seconds
assert_col consultation_sessions recording_egress_id
assert_col web_artifact_jobs story_id
assert_col web_artifact_jobs brief
assert_col web_artifact_jobs metadata
assert_col workbench_execution_requests clow
assert_col workbench_execution_requests response
assert_col workbench_execution_requests updated_at
assert_col workflow_statuses label_i18n_key
assert_col workflow_statuses is_active
assert_col workflow_statuses updated_at
assert_col workflow_status_transitions requires_role
assert_col workflow_status_transitions notes
assert_col workflow_status_transitions updated_at
assert_col plugin_catalog agent_spec

# ── Bricks 2–6 RAG axis reconcile (registry ordering + locale/tier class) ────
assert_col knowledge_items locale
assert_col knowledge_items minimum_tier
assert_col knowledge_items source_concept_id
assert_col knowledge_chunks locale
assert_col knowledge_embeddings locale
assert_col ai_model_registry is_embedding
assert_col knowledge_embeddings model_registry_id
# FK guard must be restored AFTER the registry exists (the ordering NG this run regresses)
fkn=$(scalar "SELECT count(*) FROM pg_constraint WHERE conname IN ('knowledge_embeddings_model_registry_id_fkey','knowledge_embeddings_model_v2_registry_id_fkey');")
if [ "${fkn:-0}" -lt 2 ]; then echo "   ❌ knowledge_embeddings model-registry FKs missing"; fail=1; else echo "   ✓ knowledge_embeddings model-registry FKs"; fi
# widened per-locale ON CONFLICT arbiters
for ix in knowledge_chunks_knowledge_item_id_chunk_index_key knowledge_embeddings_chunk_id_key idx_knowledge_items_source_unique; do
  n=$(scalar "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='$ix' AND indexdef LIKE '%locale%';")
  if [ "${n:-0}" -lt 1 ]; then echo "   ❌ index $ix not widened to locale"; fail=1; else echo "   ✓ index $ix (locale)"; fi
done
# RPC surface converged to exactly the canonical locale-aware overload per name
for fn in insert_knowledge_chunk insert_knowledge_embedding clear_knowledge_item_chunks upsert_story_knowledge_item_audited; do
  n=$(scalar "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='$fn';")
  loc=$(scalar "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='$fn' AND 'p_locale' = ANY(proargnames);")
  if [ "${n:-0}" -ne 1 ] || [ "${loc:-0}" -ne 1 ]; then echo "   ❌ $fn: want exactly 1 locale-aware overload (have ${n:-0}, locale-aware ${loc:-0})"; fail=1; else echo "   ✓ $fn single locale-aware overload"; fi
done
# search surface: every remaining v2/v3 overload is tier-GATED (an upgraded DB keeping
# the pre-Brick6 UNGATED body is a silent ACL regression, not a compile error)
ungated=$(scalar "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('mcp_search_knowledge_v2','mcp_search_knowledge_v3') AND prosrc NOT LIKE '%minimum_tier%';")
searchn=$(scalar "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('mcp_search_knowledge_v2','mcp_search_knowledge_v3');")
if [ "${ungated:-1}" -ne 0 ] || [ "${searchn:-0}" -lt 2 ]; then echo "   ❌ search surface: ${ungated:-?} ungated overload(s) of ${searchn:-?}"; fail=1; else echo "   ✓ v2/v3 overloads all tier-gated (${searchn})"; fi
# call-time proof: the deferred body actually runs on the reconciled schema (this is
# the failure the column asserts alone cannot see — 42703 at first search)
# (SET LOCAL ROLE service_role mirrors the PostgREST invocation context — v3's own
#  fail-closed gate rejects anonymous callers, which is correct and not under test here)
smoke_err=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -qtA \
  -c "BEGIN; SET LOCAL ROLE service_role; SELECT count(*) FROM public.mcp_search_knowledge_v3(p_query_embedding_v1 := ('[' || repeat('0,', 1535) || '0]')::vector, p_query_text := 'upgrade-smoke', p_limit := 1); ROLLBACK;" 2>&1 >/dev/null) \
  && echo "   ✓ mcp_search_knowledge_v3 executes (locale/tier deps live at call time)" \
  || { echo "   ❌ mcp_search_knowledge_v3 aborts at call time:"; echo "$smoke_err" | sed 's/^/      /'; fail=1; }

# enum reconcile (one representative — all 9 ride the same guarded-DO path)
assert_type() {
  local ty="$1" n
  n=$(scalar "SELECT count(*) FROM pg_type WHERE typname='$ty';")
  if [ "${n:-0}" -lt 1 ]; then echo "   ❌ missing enum $ty"; fail=1; else echo "   ✓ enum $ty"; fi
}
assert_type plugin_kind
assert_type web_artifact_kind
assert_type playwright_run_status

# the 409 fix is only live if the hook is also WIRED on the authenticator role
prereq=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -tA -c "SELECT count(*) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole WHERE r.rolname='authenticator' AND EXISTS (SELECT 1 FROM unnest(s.setconfig) c WHERE c LIKE 'pgrst.db_pre_request=%aisha_pre_request%');" 2>/dev/null)
if [ "${prereq:-0}" -lt 1 ]; then echo "   ❌ authenticator.db_pre_request not wired to aisha_pre_request"; fail=1; else echo "   ✓ authenticator.db_pre_request → aisha_pre_request"; fi
# F2 tabletů (2026-09-29): tvar převzatý z SoT + DORovnání dat na existující DB.
assert_col knock_device_credentials ucet_id
assert_col knock_device_credentials plati_do
assert_tbl kiosk_rozsah
assert_fn 'public.je_ucet_zarizeni_platny(uuid)'
assert_fn 'public.current_device_kid()'
assert_fn 'public.zaloz_ucet_zarizeni_interni(text)'
n=$(scalar "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='uq_knock_device_credentials_ucet';")
if [ "${n:-0}" -lt 1 ]; then echo "   ❌ missing index uq_knock_device_credentials_ucet"; fail=1; else echo "   ✓ index uq_knock_device_credentials_ucet"; fi
n=$(scalar "SELECT count(*) FROM pg_constraint WHERE conname IN ('knock_device_credentials_ucet_jen_tablet','knock_device_credentials_ucet_fkey');")
if [ "${n:-0}" -lt 2 ]; then echo "   ❌ kontroly účtu zařízení chybí (${n:-0}/2)"; fail=1; else echo "   ✓ kontroly účtu zařízení (jen tablet, FK)"; fi
# Predikát: PRÁVĚ JEDEN podpis (šestiargumentový s pátou cestou) — starý pětiargumentový
# by volání se 5 argumenty učinil nejednoznačným (42725) nebo by trefil verzi bez páté cesty.
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='workflow_step_visible_to';")
n6=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='workflow_step_visible_to' AND p.pronargs=6 AND p.prosrc LIKE '%je_ucet_zarizeni_platny%';")
if [ "${n:-0}" -ne 1 ] || [ "${n6:-0}" -ne 1 ]; then echo "   ❌ workflow_step_visible_to: chci 1 podpis s pátou cestou (podpisů ${n:-?}, nových ${n6:-?})"; fail=1; else echo "   ✓ workflow_step_visible_to: jediný podpis, pátá cesta"; fi
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='handle_new_user' AND p.prosrc LIKE '%ucet_id = NEW.id%';")
if [ "${n:-0}" -lt 1 ]; then echo "   ❌ handle_new_user zůstal STARÝ (member každému účtu)"; fail=1; else echo "   ✓ handle_new_user: member jen mimo účty zařízení"; fi
# Data: schválený tablet dostal účet — BEZ role, s profilem; čekající účet nedostal.
f2_ucet=$(scalar "SELECT coalesce(ucet_id::text,'') FROM public.knock_device_credentials WHERE kid='dev-' || repeat('a1', 8);")
if [ -z "$f2_ucet" ]; then echo "   ❌ dorovnání: schválený tablet bez účtu"; fail=1; else
  n=$(scalar "SELECT (SELECT count(*) FROM aisha_auth.users WHERE id='$f2_ucet') || '|' || (SELECT count(*) FROM public.user_roles WHERE user_id='$f2_ucet') || '|' || (SELECT count(*) FROM public.profiles WHERE user_id='$f2_ucet');")
  if [ "$n" != "1|0|1" ]; then echo "   ❌ dorovnání: účet tabletu uživatel|role|profil = $n (chci 1|0|1)"; fail=1; else echo "   ✓ dorovnání: schválený tablet má účet bez role, s profilem"; fi
fi
n=$(scalar "SELECT count(*) FROM public.knock_device_credentials WHERE kid='dev-' || repeat('b2', 8) AND ucet_id IS NULL;")
if [ "${n:-0}" -ne 1 ]; then echo "   ❌ dorovnání založilo účet i ČEKAJÍCÍMU tabletu"; fail=1; else echo "   ✓ čekající tablet účet nedostal"; fi
# F2-B/C: relace, projekce, tahač, rozvozy; detail kroku předává kód kroku a tabletu vydá projekci.
assert_fn 'public.kiosk_vydej_relaci(text)'
assert_fn 'public.kiosk_projekce(text, jsonb)'
assert_fn 'public.kiosk_tahac(text)'
assert_fn 'public.get_kiosk_rozvozy(text, text)'
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='get_workflow_step_detail' AND p.prosrc LIKE '%kiosk_projekce(v_s.step_code, v_s.input_data)%' AND p.prosrc LIKE '%v_s.step_code)%';")
if [ "${n:-0}" -lt 1 ]; then echo "   ❌ get_workflow_step_detail zůstal STARÝ (bez projekce tabletu / kódu kroku)"; fail=1; else echo "   ✓ detail kroku: kód kroku + projekce tabletu"; fi
n=$(scalar "SELECT count(*) FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name IN ('kiosk_vydej_relaci','kiosk_projekce') AND grantee IN ('anon','authenticated','PUBLIC');")
if [ "${n:-1}" -ne 0 ]; then echo "   ❌ relace/projekce mají grant klientům ($n)"; fail=1; else echo "   ✓ relace a projekce jen pro server"; fi
# 2026-09-30: rozsah tabletu = NAŠE flotila spárovaná s Webdispečinkem + okno nedoručených.
assert_col kiosk_rozsah okno_zpet
assert_col kiosk_rozsah okno_dopredu
assert_col kiosk_rozsah zdroj_stav
assert_col kiosk_rozsah jen_flotila
assert_col kiosk_rozsah pole_polozek
assert_fn 'public.get_workflow_step_polozky(uuid)'
assert_fn 'public.kiosk_krok_nasi_flotily(jsonb)'
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='workflow_step_visible_to' AND p.prosrc LIKE '%kiosk_krok_nasi_flotily%';")
if [ "${n:-0}" -ne 1 ]; then echo "   ❌ větev zařízení predikátu nečte flotilu (kiosk_krok_nasi_flotily)"; fail=1; else echo "   ✓ větev zařízení: jen naše flotila"; fi
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='get_kiosk_rozvozy' AND p.prosrc LIKE '%okno_zpet%' AND p.prosrc LIKE '%zdroj_stav%';")
if [ "${n:-0}" -ne 1 ]; then echo "   ❌ get_kiosk_rozvozy zůstal STARÝ (jen dnešek, bez stavu zdroje)"; fail=1; else echo "   ✓ rozvozy tabletu: okno nedoručených + stav zdroje"; fi
n=$(scalar "SELECT count(*) FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name='kiosk_krok_nasi_flotily' AND grantee IN ('anon','authenticated','PUBLIC');")
if [ "${n:-1}" -ne 0 ]; then echo "   ❌ pomocník flotily má grant klientům ($n)"; fail=1; else echo "   ✓ pomocník flotily jen pro server"; fi
# Politiky tabulky znalostí: staré dvě pryč, nové čtyři cílené na role.
n=$(scalar "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='knowledge_items' AND policyname IN ('Anyone can read active public knowledge items','Per-story KB visible to participants');")
if [ "${n:-1}" -ne 0 ]; then echo "   ❌ staré politiky znalostí přežily heals ($n ze 2) — sčítají se s novými"; fail=1; fi
politiky=$(scalar "SELECT string_agg(policyname || ':' || array_to_string(roles, '+'), ',' ORDER BY policyname) FROM pg_policies WHERE schemaname='public' AND tablename='knowledge_items';")
chci="knowledge_items_admin_read:authenticated,knowledge_items_global_anon_read:anon,knowledge_items_global_authenticated_read:authenticated,knowledge_items_story_participants_read:authenticated"
if [ "$politiky" != "$chci" ]; then echo "   ❌ politiky znalostí po heals: $politiky"; fail=1; else echo "   ✓ tabulka znalostí: čtyři politiky cílené na role, staré dvě pryč"; fi
# Hledání rysů osobnosti: heals funkci přehrály — čitelný stav v obou větvích, pg_temp poslední.
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='fn_search_personality_context' AND (length(p.prosrc) - length(replace(p.prosrc, 'public.knowledge_state_readable(', ''))) / length('public.knowledge_state_readable(') = 2 AND array_to_string(p.proconfig, ',') LIKE '%pg_temp';")
if [ "${n:-0}" -ne 1 ]; then echo "   ❌ hledání rysů osobnosti zůstalo STARÉ (bez čitelného stavu v obou větvích nebo bez pg_temp na konci cesty)"; fail=1; else echo "   ✓ hledání rysů osobnosti: čitelný stav v obou větvích, pg_temp poslední"; fi
# Druhý index znalostí: heals přehrály spoušť i sestavení dokumentu a založily rozhodovací funkci.
n=$(scalar "SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='fn_notify_knowledge_change' AND p.prosrc LIKE '%public.knowledge_ragnarok_action(%' AND array_to_string(p.proconfig, ',') LIKE '%pg_temp') + (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='fn_build_ragnarok_document' AND p.prosrc LIKE '%public.knowledge_state_readable(%' AND array_to_string(p.proconfig, ',') LIKE '%pg_temp') + (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='knowledge_ragnarok_action');")
if [ "${n:-0}" -ne 3 ]; then echo "   ❌ druhý index znalostí zůstal STARÝ ($n ze 3: spoušť, sestavení dokumentu, rozhodovací funkce)"; fail=1; else echo "   ✓ druhý index znalostí: spoušť rozhoduje čistou funkcí, dokument jen pro čitelnou položku"; fi
# Citace běhu: heals funkci přehrály — volání projde (dřív 42702 při každém volání).
citace_err=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -tA \
  -c "BEGIN; SET LOCAL ROLE service_role; SELECT count(*) FROM public.fn_get_run_citations(gen_random_uuid()); ROLLBACK;" 2>&1) \
  && echo "   ✓ citace běhu: volání projde" \
  || { echo "   ❌ citace běhu při volání padají:"; echo "$citace_err" | sed 's/^/      /'; fail=1; }
# Čtecí funkce znalostí: heals založily pomocníka a přehrály všech deset souborů (10 funkcí — hledání v2 má jedno přetížení).
n=$(scalar "SELECT count(*) FILTER (WHERE p.prosrc LIKE '%public.knowledge_state_readable(%' AND p.prosrc NOT LIKE '%quarantine_status NOT IN%' AND array_to_string(p.proconfig, ',') LIKE '%pg_temp') || '/' || count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('mcp_search_knowledge_v2','mcp_search_knowledge_v3','fn_get_platform_warmup_state','mcp_get_knowledge_item','fn_get_psyche_traits','fn_get_tao_principles','fn_get_run_citations','fn_get_run_extract_context','extract_training_pairs_from_kb','compose_context');")
h=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='knowledge_state_readable';")
if [ "$n" != "10/10" ] || [ "${h:-0}" -ne 1 ]; then echo "   ❌ čtecí funkce znalostí zůstaly STARÉ ($n s allowlistem a pg_temp, pomocník: $h)"; fail=1; else echo "   ✓ čtecí funkce znalostí: 10 z 10 volá pomocníka čitelného stavu, pg_temp poslední"; fi
# Funkce spouští znalostí: po heals je nesmí spustit žádná role API (ani přes PUBLIC).
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) r(role) WHERE ns.nspname='public' AND p.proname IN ('sync_expert_rule_to_knowledge_item','sync_topic_version_to_knowledge_item') AND has_function_privilege(r.role, p.oid, 'EXECUTE');")
if [ "${n:-1}" -ne 0 ]; then echo "   ❌ funkce spouští znalostí mají po heals EXECUTE pro roli API ($n ze 6)"; fail=1; else echo "   ✓ funkce spouští znalostí: žádný grant rolím API"; fi
# Vrstva mozku jen globálně: tři čtení osobnosti nesou podmínku na příběh a v hledání v2/v3
# je výjimka podle typu jen spolu s `ki.story_id IS NULL` (počet výskytů výjimky = počet
# výskytů s podmínkou).
n=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -tA <<'SQL'
WITH f AS (
  SELECT p.proname, p.prosrc,
         'ki.item_type::text IN (''core_value'', ''personality_trait'')' AS vyjimka,
         'ki.story_id IS NULL AND ki.item_type::text IN (''core_value'', ''personality_trait'')' AS s_podminkou
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public'
)
SELECT (SELECT count(*) FROM f WHERE proname IN ('fn_get_psyche_traits', 'fn_get_tao_principles', 'fn_search_personality_context') AND prosrc LIKE '%ki.story_id IS NULL%')
       || '/' ||
       (SELECT count(*) FROM f WHERE proname IN ('mcp_search_knowledge_v2', 'mcp_search_knowledge_v3')
           AND (length(prosrc) - length(replace(prosrc, vyjimka, ''))) / length(vyjimka)
               <> (length(prosrc) - length(replace(prosrc, s_podminkou, ''))) / length(s_podminkou));
SQL
)
if [ "$n" != "3/0" ]; then echo "   ❌ vrstva mozku po heals není jen globální ($n; čekám 3 čtení osobnosti s podmínkou / 0 hledání s výjimkou bez podmínky)"; fail=1; else echo "   ✓ vrstva mozku jen globálně: tři čtení osobnosti i hledání v2/v3"; fi
# Hledání v2: po heals PRÁVĚ JEDNO přetížení a projdou tři tvary volání — pozičně 9 argumenty,
# jmenně bez příběhu, jmenně s příběhem (na předchozím mainu první dva končily „is not unique“).
v2n=$(scalar "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='mcp_search_knowledge_v2';")
v2_err=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -qtA 2>&1 <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT jsonb_typeof(public.mcp_search_knowledge_v2(NULL::vector, 'x'::text, '{}'::text[], NULL::text, NULL::text, '{}'::text[], true, 5, 0.3::double precision));
SELECT jsonb_typeof(public.mcp_search_knowledge_v2(p_query_text => 'x'::text));
SELECT jsonb_typeof(public.mcp_search_knowledge_v2(p_query_text => 'x'::text, p_story_id => NULL::uuid));
ROLLBACK;
SQL
) && v2_ok=1 || v2_ok=0
if [ "${v2n:-0}" -ne 1 ] || [ "$v2_ok" -ne 1 ]; then echo "   ❌ hledání v2 po heals: přetížení ${v2n:-?} (čekám 1), volání: $v2_err"; fail=1; else echo "   ✓ hledání v2: jedno přetížení; volání pozičně, jmenně bez příběhu i s příběhem projde"; fi
# Hledání v3 (sonda ho před heals zahazuje celé): po heals nese plniče parametrů. Viditelnost měří tvrzení o jejím domově níž.
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='mcp_search_knowledge_v3' AND p.prosrc LIKE '%gea.slug = p_expertise_slug%' AND p.prosrc LIKE '%cardinality(p_item_types) = 0%' AND p.prosrc LIKE '%kc.source_field <> ''ai_instructions''%';")
if [ "${n:-0}" -ne 1 ]; then echo "   ❌ hledání v3 po heals nenese plniče parametrů"; fail=1; else echo "   ✓ hledání v3: plniče parametrů (výběr odbornosti, prázdný seznam typů, pokyny pro model)"; fi
# Viditelnost: JEDEN domov se vstupem „je přihlášen“ (jedna signatura), rolím API NEvydaný (vkládá se do dotazů
# definer funkcí) a všechny čtecí cesty mu předávají identitu (počet volání v každé funkci = počet jejích větví).
n=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -tA <<'SQL'
SELECT (SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ' ORDER BY 1) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public' AND p.proname = 'knowledge_visibility_searchable')
       || '/' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = 'knowledge_visibility_searchable'
                    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
       || '/' || (SELECT string_agg(p.proname || '=' || ((length(p.prosrc) - length(replace(p.prosrc, 'public.knowledge_visibility_searchable(', ''))) / length('public.knowledge_visibility_searchable('))::text, ',' ORDER BY p.proname)
                    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public'
                     AND p.proname IN ('mcp_search_knowledge_v2', 'mcp_search_knowledge_v3', 'mcp_get_knowledge_item', 'fn_get_tao_principles', 'fn_get_psyche_traits',
                                       'fn_search_personality_context', 'fn_get_run_citations', 'fn_get_run_graph_context', 'knowledge_visibilities_for_caller',
                                       'list_story_knowledge_items'));
SQL
)
cekam="p_visibility text, p_signed_in boolean, p_in_guild boolean/0/fn_get_psyche_traits=1,fn_get_run_citations=2,fn_get_run_graph_context=2,fn_get_tao_principles=1,fn_search_personality_context=2,knowledge_visibilities_for_caller=1,list_story_knowledge_items=1,mcp_get_knowledge_item=1,mcp_search_knowledge_v2=1,mcp_search_knowledge_v3=2"
if [ "$n" != "$cekam" ]; then echo "   ❌ viditelnost po heals: $n (čekám $cekam)"; fail=1; else echo "   ✓ viditelnost: jeden domov s „je přihlášen“, nevydaný; devět čtecích funkcí a množina pro politiky ho volají ve všech větvích"; fi
# Množina štítků pro politiky: definer bez parametru, vydaná anonymovi i přihlášenému; starý pomocník s voláním na řádek pryč.
n=$(scalar "SELECT coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')/' || p.prosecdef::text || '/' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text, ' | ' ORDER BY p.proname), '') FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('knowledge_visibilities_for_caller', 'knowledge_visibility_for_caller');")
if [ "$n" != "knowledge_visibilities_for_caller()/true/true/true" ]; then echo "   ❌ množina štítků pro politiky po heals: [$n] (čekám knowledge_visibilities_for_caller()/true/true/true a nic dalšího)"; fail=1; else echo "   ✓ množina štítků pro politiky: jednou za dotaz z identity volajícího; pomocník s voláním na řádek pryč"; fi
# Domov gildy (G1): schválený konzultant studie + certifikace od správy; rolím API nevydaný.
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='knowledge_audience_in_guild' AND p.prosrc LIKE '%study_consultants%' AND p.prosrc LIKE '%is_certified%' AND p.prosrc NOT LIKE '%guild_tier%' AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');")
if [ "${n:-0}" -ne 1 ]; then echo "   ❌ domov gildy po heals chybí, je vydaný nebo nemá definici G1"; fail=1; else echo "   ✓ domov gildy: G1 (schválený konzultant + certifikace), nevydaný"; fi
# Politiky tabulky po heals se ptají množiny štítků pro volajícího a vlastní výčet (members) nenesou.
n=$(scalar "SELECT string_agg(polname || '=' || (pg_get_expr(polqual, polrelid) LIKE '%knowledge_visibilities_for_caller()%')::text || '/' || (pg_get_expr(polqual, polrelid) LIKE '%members%')::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.knowledge_items'::regclass AND polname IN ('knowledge_items_global_anon_read', 'knowledge_items_global_authenticated_read');")
if [ "$n" != "knowledge_items_global_anon_read=true/false,knowledge_items_global_authenticated_read=true/false" ]; then echo "   ❌ politiky tabulky po heals nevolají domov viditelnosti ($n)"; fail=1; else echo "   ✓ politiky tabulky: množina štítků pro volajícího (domov), bez vlastního výčtu"; fi
# Chováním: nepřihlášený přes tabulku dostane `public`, ne `members`; přihlášený obě.
n=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -qtA 2>&1 <<'SQL'
BEGIN;
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, visibility) VALUES
  ('0f0f0f0f-0000-4000-8000-00000000b001', 'domain_doc', 'ZK upgrade public', 't', 'active', 'public'),
  ('0f0f0f0f-0000-4000-8000-00000000b002', 'domain_doc', 'ZK upgrade members', 't', 'active', 'members');
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT 'anon=' || string_agg(title, ',' ORDER BY title) FROM public.knowledge_items WHERE id IN ('0f0f0f0f-0000-4000-8000-00000000b001', '0f0f0f0f-0000-4000-8000-00000000b002');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"0f0f0f0f-0000-4000-8000-00000000b003"}', true);
SET LOCAL ROLE authenticated;
SELECT 'prihlaseny=' || string_agg(title, ',' ORDER BY title) FROM public.knowledge_items WHERE id IN ('0f0f0f0f-0000-4000-8000-00000000b001', '0f0f0f0f-0000-4000-8000-00000000b002');
ROLLBACK;
SQL
)
if [ "$(echo "$n" | grep -E '^(anon|prihlaseny)=' | tr '\n' ' ' | sed 's/ *$//')" != "anon=ZK upgrade public prihlaseny=ZK upgrade members,ZK upgrade public" ]; then echo "   ❌ tabulka po heals vydá nepřihlášenému víc než public, nebo přihlášenému míň: $n"; fail=1; else echo "   ✓ tabulka chováním: nepřihlášený jen public, přihlášený public + members"; fi
# Vrstva mozku: po heals jediná signatura s publikem a volání bez argumentů projde (službou).
n=$(scalar "SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ',' ORDER BY 1) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('fn_get_tao_principles','fn_get_psyche_traits');")
mozek_err=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -qtA 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT jsonb_typeof(public.fn_get_tao_principles()), jsonb_typeof(public.fn_get_psyche_traits());
SELECT jsonb_typeof(public.fn_get_tao_principles(p_audience_user_id => gen_random_uuid()));
ROLLBACK;
SQL
) && mozek_ok=1 || mozek_ok=0
if [ "$n" != "fn_get_psyche_traits(p_audience_user_id uuid),fn_get_tao_principles(p_audience_user_id uuid)" ] || [ "$mozek_ok" -ne 1 ]; then echo "   ❌ vrstva mozku po heals: [$n] volání: $mozek_err"; fail=1; else echo "   ✓ vrstva mozku: jedna signatura s publikem; volání bez argumentů i s publikem projde"; fi
# Skládání kontextu: žadatele jmenuje jen služba a vrstvy mozku ho dostávají.
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='compose_context' AND p.prosrc LIKE '%WHEN public.get_jwt_role() = ''service_role'' THEN COALESCE(p_requester_id, auth.uid())%' AND p.prosrc LIKE '%fn_get_tao_principles(p_audience_user_id := v_requester)%' AND p.prosrc LIKE '%fn_get_psyche_traits(p_audience_user_id := v_requester)%';")
if [ "${n:-0}" -ne 1 ]; then echo "   ❌ compose_context po heals nepřipíná žadatele nebo ho nepředává vrstvě mozku"; fail=1; else echo "   ✓ compose_context: žadatele jmenuje jen služba, vrstva mozku ho dostává"; fi
# Čtení podle id: správa čte i soukromou položku; vlastní výčet viditelností pryč.
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='mcp_get_knowledge_item' AND p.prosrc LIKE '%v_is_admin%' AND p.prosrc NOT LIKE '%ki.visibility IN%';")
if [ "${n:-0}" -ne 1 ]; then echo "   ❌ čtení podle id po heals nese vlastní výčet viditelností nebo nemá větev správy"; fail=1; else echo "   ✓ čtení podle id: větev správy, bez vlastního výčtu"; fi
# Hledání v3 (sonda ho před heals zahazuje celé): po heals měří přístup k příběhu u publika, v obou větvích.
n=$(scalar "SELECT ((length(p.prosrc) - length(replace(p.prosrc, '(ki.story_id IS NOT NULL AND v_story_ok)', ''))) / length('(ki.story_id IS NOT NULL AND v_story_ok)'))::text || '/' || (p.prosrc LIKE '%v_story_ok := p_story_id IS NULL%')::text || '/' || ((length(p.prosrc) - length(replace(p.prosrc, '(ki.story_id IS NULL AND public.knowledge_visibility_searchable(', ''))) / length('(ki.story_id IS NULL AND public.knowledge_visibility_searchable('))::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='mcp_search_knowledge_v3';")
if [ "$n" != "2/true/2" ]; then echo "   ❌ hledání v3 po heals neměří přístup k příběhu u publika ($n; čekám 2/true/2)"; fail=1; else echo "   ✓ hledání v3: přístup k příběhu se měří u publika, v obou větvích; viditelnost rozhoduje jen u globální položky"; fi
# Seznam položek příběhu: heals ho přehrály — vlastník příběhu je tam.
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='list_story_knowledge_items' AND p.prosrc LIKE '%(ps.user_id = v_user_id%' AND p.prosrc LIKE '%OR (ki.status = ''active''%public.knowledge_visibility_searchable(ki.visibility%';")
if [ "${n:-0}" -ne 1 ]; then echo "   ❌ seznam položek příběhu zůstal STARÝ (bez vlastníka, bez štítku nebo bez filtru aktivních ve výchozím příběhu)"; fail=1; else echo "   ✓ seznam položek příběhu: vlastník, účastník, správa; výchozí příběh jen aktivní a podle štítku"; fi
# Citace a graf běhu: výchozí příběh už neotevírá soukromé položky — položka příběhu podle pravidel příběhu + štítku.
n=$(scalar "SELECT string_agg(p.proname || '=' || (p.prosrc LIKE '%is_stack_default AND public.knowledge_visibility_searchable(%' OR p.prosrc LIKE '%v_pribeh_vychozi AND public.knowledge_visibility_searchable(%')::text, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('fn_get_run_citations', 'fn_get_run_graph_context');")
if [ "$n" != "fn_get_run_citations=true,fn_get_run_graph_context=true" ]; then echo "   ❌ citace / graf běhu po heals pouštějí výchozí příběh bez štítku ($n)"; fail=1; else echo "   ✓ citace a graf běhu: výchozí příběh jen podle štítku"; fi
# Graf běhu: heals funkci přehrály — volání nad během s citací projde (dřív 42702).
graf_err=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -qtA 2>&1 <<'SQL'
BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES ('0f0f0f0f-0000-4000-8000-00000000a001', 'zk-upgrade-graf@test.local');
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('0f0f0f0f-0000-4000-8000-00000000a002', 'ZK upgrade graf', '0f0f0f0f-0000-4000-8000-00000000a001');
INSERT INTO public.ai_runs (id, kind, story_id, citation_chunk_ids) VALUES ('0f0f0f0f-0000-4000-8000-00000000a003', 'chat', '0f0f0f0f-0000-4000-8000-00000000a002', ARRAY[gen_random_uuid()]);
SET LOCAL ROLE service_role;
SELECT count(*) FROM public.fn_get_run_graph_context('0f0f0f0f-0000-4000-8000-00000000a003'::uuid, NULL, NULL);
ROLLBACK;
SQL
) && echo "   ✓ graf běhu: volání nad během s citací projde" \
  || { echo "   ❌ graf běhu při volání padá:"; echo "$graf_err" | sed 's/^/      /'; fail=1; }
# Fronty zpracování a graf běhu: po heals všechny čtyři volají pomocníka čitelného stavu, pg_temp poslední.
n=$(scalar "SELECT count(*) FILTER (WHERE p.prosrc LIKE '%public.knowledge_state_readable(ki.quarantine_status)%' AND array_to_string(p.proconfig, ',') LIKE '%pg_temp') || '/' || count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('fn_get_chunks_needing_context','fn_get_embeddings_needing_v2','fn_chunks_bez_zive_identity','fn_get_run_graph_context');")
if [ "$n" != "4/4" ]; then echo "   ❌ fronty zpracování a graf běhu zůstaly STARÉ ($n volá pomocníka čitelného stavu se zpevněnou cestou)"; fail=1; else echo "   ✓ fronty zpracování a graf běhu: 4 ze 4 volají pomocníka čitelného stavu, pg_temp poslední"; fi
# Statistiky znalostí: po heals je nespustí anon ani authenticated; službě grant zůstal.
n=$(scalar "SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace CROSS JOIN (VALUES ('anon'),('authenticated')) r(role) WHERE ns.nspname='public' AND p.proname='mcp_get_knowledge_stats' AND has_function_privilege(r.role, p.oid, 'EXECUTE')) || '/' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='mcp_get_knowledge_stats' AND has_function_privilege('service_role', p.oid, 'EXECUTE'));")
if [ "$n" != "0/1" ]; then echo "   ❌ statistiky znalostí po heals: $n (čekám 0 rolí API s EXECUTE / 1 = služba ho má)"; fail=1; else echo "   ✓ statistiky znalostí: anon ani authenticated je nespustí, služba ano"; fi
# Čtení podle id: po heals PRÁVĚ JEDNO přetížení (s publikem) a projde volání starým tvarem i novým.
n=$(scalar "SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ' ORDER BY 1) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='mcp_get_knowledge_item';")
if [ "$n" != "p_item_id uuid, p_source_slug text, p_audience_user_id uuid" ]; then echo "   ❌ čtení podle id po heals: přetížení [$n] (čekám jedno, s p_audience_user_id)"; fail=1; fi
id_err=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -qtA 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT public.mcp_get_knowledge_item(p_item_id => gen_random_uuid(), p_source_slug => NULL::text) IS NULL;
SELECT public.mcp_get_knowledge_item(p_source_slug => 'zk-upgrade-neexistuje') IS NULL;
SELECT public.mcp_get_knowledge_item(gen_random_uuid(), NULL::text) IS NULL;
SELECT public.mcp_get_knowledge_item(p_item_id => gen_random_uuid(), p_audience_user_id => gen_random_uuid()) IS NULL;
ROLLBACK;
SQL
) && echo "   ✓ čtení podle id: jedno přetížení; volání dvěma jmennými parametry, jedním, pozičně i s publikem projde" \
  || { echo "   ❌ čtení podle id po heals při volání padá:"; echo "$id_err" | sed 's/^/      /'; fail=1; }
# Expertní pravidla (revize B1): pomocník viditelnosti existuje a není vydaný; čtyři čtenáři mají jen tvar
# s publikem; všichni čtenáři obsahu pravidel ho volají; politiky čtení napřímo se ptají množiny štítků.
n=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -tA <<'SQL'
SELECT (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'expert_rule_visible_to'
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       || '/' || (SELECT string_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')', ',' ORDER BY proname, pg_get_function_identity_arguments(oid))
                    FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('get_expert_rule_detail', 'mcp_get_rule_detail', 'mcp_get_agent_knowledge'))
       || '/' || (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'mcp_search_knowledge')
       || '/' || (SELECT coalesce(string_agg(proname, ',' ORDER BY proname), '') FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                    AND proname IN ('assess_code_quality', 'compose_context', 'evaluate_test_strategy', 'generate_copilot_instructions', 'generate_default_copilot_instructions', 'get_expert_rule_detail', 'get_expert_rules', 'get_expertise_areas', 'get_guild_member_detail', 'get_guild_members', 'get_instruction_payload', 'get_my_rule_subscriptions', 'get_story_knowledge_context', 'get_story_rulesets', 'list_agent_kb_bindings', 'mcp_consult_dirigent', 'mcp_get_agent_knowledge', 'mcp_get_compliance_context', 'mcp_get_expertise_areas', 'mcp_get_rule_detail', 'mcp_get_story_context', 'mcp_match_experts', 'mcp_propose_improvement', 'mcp_request_unblock', 'mcp_search_knowledge', 'moderate_development_flow', 'recommend_ruleset_for_story', 'subscribe_to_expert_rule', 'create_story_ruleset') AND prosrc NOT LIKE '%public.expert_rule_visible_to(%')
       || '/' || (SELECT string_agg(polname || '=' || (pg_get_expr(polqual, polrelid) LIKE '%knowledge_visibilities_for_caller()%' AND pg_get_expr(polqual, polrelid) NOT LIKE '%members%')::text, ',' ORDER BY polname)
                    FROM pg_policy WHERE polrelid = 'public.expert_rules'::regclass AND polname IN ('anon_read_public_rules', 'auth_read_public_and_members_rules'));
SQL
)
cekam="1/get_expert_rule_detail(p_rule_slug text, p_audience_user_id uuid),mcp_get_agent_knowledge(p_agent_slug text, p_binding_type text, p_audience_user_id uuid),mcp_get_rule_detail(p_rule_slug text, p_audience_user_id uuid)/1//anon_read_public_rules=true,auth_read_public_and_members_rules=true"
if [ "$n" != "$cekam" ]; then echo "   ❌ expertní pravidla po heals: $n (čekám $cekam)"; fail=1; else echo "   ✓ expertní pravidla: pomocník viditelnosti, tvary s publikem, všichni čtenáři ho volají, politiky přes domov"; fi
# Chováním: nepřihlášený soukromé pravidlo nedostane ani tabulkou, ani detailem; veřejné ano.
# (Chyba volání se vypíše a brána spadne tvrzením — ne tichým koncem skriptu pod `set -e`.)
# Spouště publikace (zápis běhu do ai_runs chce výchozí příběh ze seedu, který tu ještě neproběhl) se pro
# vložení sond vypnou — sonda měří čtení, ne publikaci.
if n=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -qtA 2>&1 <<'SQL'
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO aisha_auth.users (id, email) VALUES ('0f0f0f0f-0000-4000-8000-00000000c001', 'zk-upgrade-pravidla@test.local');
INSERT INTO public.partner_profiles (id, user_id, display_name, city) VALUES ('0f0f0f0f-0000-4000-8000-00000000c002', '0f0f0f0f-0000-4000-8000-00000000c001', 'ZK autor', 'Brno');
INSERT INTO public.expert_rules (slug, title, body_markdown, status, visibility, author_partner_id) VALUES
  ('zk-upgrade-pub', 'ZK pub', 't', 'published', 'public', '0f0f0f0f-0000-4000-8000-00000000c002'),
  ('zk-upgrade-pri', 'ZK pri', 't', 'published', 'private', '0f0f0f0f-0000-4000-8000-00000000c002');
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT 'tabulka=' || string_agg(slug, ',' ORDER BY slug) FROM public.expert_rules WHERE slug LIKE 'zk-upgrade-%';
SELECT 'detail=' || (public.get_expert_rule_detail('zk-upgrade-pub') IS NOT NULL)::text || '/' || (public.get_expert_rule_detail('zk-upgrade-pri') IS NOT NULL)::text;
ROLLBACK;
SQL
); then
  if [ "$(echo "$n" | grep -E '^(tabulka|detail)=' | tr '\n' ' ' | sed 's/ *$//')" != "tabulka=zk-upgrade-pub detail=true/false" ]; then echo "   ❌ expertní pravidla chováním po heals: $n"; fail=1; else echo "   ✓ expertní pravidla chováním: nepřihlášený soukromé nedostane tabulkou ani detailem"; fi
else
  echo "   ❌ expertní pravidla chováním po heals: volání padá:"; echo "$n" | sed 's/^/      /'; fail=1
fi
# Guard profilu partnera (revize 2, N2): po heals BEFORE INSERT OR UPDATE (tgtype 23) a chováním přihlášený
# nezaloží vlastní profil s is_certified = true (na předchozím mainu prošlo).
n=$(scalar "SELECT tgtype FROM pg_trigger WHERE tgrelid = 'public.partner_profiles'::regclass AND tgname = 'partner_profiles_privilege_guard';")
if pp_err=$(psql "$PROBE_URL" -v ON_ERROR_STOP=1 -qtA 2>&1 <<'SQL'
BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES ('0f0f0f0f-0000-4000-8000-00000000d001', 'zk-upgrade-guard@test.local');
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"0f0f0f0f-0000-4000-8000-00000000d001"}', true);
SELECT set_config('request.jwt.claim.sub', '0f0f0f0f-0000-4000-8000-00000000d001', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.partner_profiles (user_id, display_name, city, is_certified) VALUES ('0f0f0f0f-0000-4000-8000-00000000d001', 'ZK', 'Brno', true);
ROLLBACK;
SQL
); then
  echo "   ❌ guard profilu po heals: přihlášený založil certifikovaný profil (tgtype $n)"; fail=1
elif [ "$n" != "23" ] || ! grep -q "is_certified is server-managed" <<< "$pp_err"; then
  echo "   ❌ guard profilu po heals: tgtype $n (čekám 23), chyba: $pp_err"; fail=1
else
  echo "   ✓ guard profilu partnera: BEFORE INSERT OR UPDATE; přihlášený nezaloží certifikovaný profil"
fi
# Čtyři mrtvé funkce SECURITY DEFINER: heals je na běžící databázi odstraní.
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('raw_query_admin','edge_database_dump_table','fn_rollback_agent_config','get_story_basic_info');")
if [ "${n:-1}" -ne 0 ]; then echo "   ❌ mrtvé funkce přežily heals ($n ze 4)"; fail=1; else echo "   ✓ čtyři mrtvé definer funkce jsou pryč"; fi
# Příjem pošty: staré signatury pryč, nové tvary jsou (jinak by sken šel obejít).
n=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.oid::regprocedure::text IN ('append_inbound_comm_entry_audited(uuid,text,text,text,text,text,uuid,jsonb)','ingest_inbound_comm_audited(text,text,uuid,text,text,text,uuid,text,jsonb)','get_retryable_integration_events(integer)')")
m=$(scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.oid::regprocedure::text IN ('append_inbound_comm_entry_audited(uuid,text,text,text,text,text,uuid,jsonb,uuid)','get_retryable_integration_events(text[],integer)')")
if [ "${n:-1}" -ne 0 ] || [ "${m:-0}" -ne 2 ]; then echo "   ❌ příjem pošty po heals: starých signatur $n (čekám 0), nových $m (čekám 2)"; fail=1; else echo "   ✓ příjem pošty: staré signatury (append bez eventu, ingest bez skenu, opakování bez zdrojů) pryč, nové tvary jsou"; fi
# Schéma public: heals vrátily grant roli, která v public vytváří, a CREATE pro
# PUBLIC odebraly. Měří se chováním (pokus o CREATE TABLE pod každou rolí) i čtecí
# kontrolou, kterou pouští živé ověření — projít musí obě.
if psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q -f "$VERIFY_PUBLIC" && verify_public_acl "$PROBE_URL"; then
  echo "   ✓ schéma public: vytváří jen vyjmenovaná role"
else
  echo "   ❌ schéma public: heals práva nedorovnaly (chyba výš říká, která role co smí)"; fail=1
fi
if [ "$fail" -ne 0 ]; then
  echo "❌ heals.sql did NOT reconcile the existing DB — db:seed would fail on redeploy"; exit 1
fi

echo "── 6/6  apply the REAL seed (the exact step that failed in prod) ────────"
psql "$PROBE_URL" -v ON_ERROR_STOP=1 -q -f "$SEED"

echo "✅ upgrade-path gate PASSED — existing pre-fold DB reconciled by heals.sql; seed applies clean"
