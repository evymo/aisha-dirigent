-- pgTAP acceptance — Omni governance-residency (on-prem residency gate, §11 / DoD #5)
-- ============================================================================
-- Source of truth: docs/planning/AISHA_OMNI_GATEWAY.md
--   §11   detectDataSensitivity → confidential ⇒ clow.allow_local=true + "filtr cloud kandidátů"
--   §1 #4 aisha_resolve_clow_backend (baseline.sql:17681) is the authoritative resolver
--   §20   Regresní pojistky: "governance residency (confidential→žádný cloud call)"
--
-- ISOLATION: this file lives under aisha/db/tests/schema/omni/ — the default
-- run-schema-tests.mjs scans ONLY the top-level aisha/db/tests/schema/*.sql and does
-- NOT recurse into omni/, so this never runs in the normal cold-start gate. It is
-- executed only in acceptance mode (psql -f against an applied schema).
--
-- LIVE-vs-RED for this file:
--   • EXISTENCE assertions (resolver fn, sensitive tables, audit_journal) are LIVE green.
--   • The allow_local=true behaviour assertion is a LIVE RED regression guard: the
--     resolver's filter `(v_allow_local OR backend_kind NOT IN (local_*))` keeps cloud
--     candidates when allow_local=true (boost-only, baseline:17790-17793). §11 demands a
--     HARD cloud filter at confidential. The test asserts the bug is GONE and is EXPECTED
--     TO FAIL today — it goes green only when the resolver excludes direct_cloud/llm_gateway
--     at allow_local=true. Keep it RED.
--
-- Runs as superuser; fixtures bypass RLS. JWT identity simulated via request.jwt.claims
-- so the resolver's auth.uid() gate is satisfied.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

-- ── Parametric identities/keys (session GUCs) ──
SELECT set_config('gr.user',  gen_random_uuid()::text, true);
SELECT set_config('gr.local', 'omni-acc-local-' || substr(gen_random_uuid()::text, 1, 8), true);
SELECT set_config('gr.cloud', 'omni-acc-cloud-' || substr(gen_random_uuid()::text, 1, 8), true);
-- authenticated JWT so aisha_resolve_clow_backend's auth.uid() gate passes.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('gr.user'))::text,
  true
);

-- ============================================================================
-- (1) LIVE existence — the substrate §11 reuses
-- ============================================================================
SELECT has_function(
  'public', 'aisha_resolve_clow_backend', ARRAY['jsonb', 'jsonb'],
  'resolver: aisha_resolve_clow_backend(jsonb, jsonb) exists (§1 #4, baseline:17681)'
);
SELECT has_table('public', 'member_health_documents',
  'confidential anchor table member_health_documents exists (§11/§15)');
SELECT has_table('public', 'dosing_logs',
  'confidential anchor table dosing_logs exists (§11/§15)');
SELECT has_table('public', 'longevity_scores',
  'confidential anchor table longevity_scores exists (§11/§15)');
SELECT has_table('public', 'audit_journal',
  'audit sink audit_journal exists (§11 "Audit do audit_journal")');

-- ============================================================================
-- Seed a minimal provider pair: one LOCAL (vLLM) and one CLOUD (direct_cloud),
-- both healthy/enabled, each with one available model. Joined via provider = slug.
-- ============================================================================
INSERT INTO public.ai_provider_registry
  (slug, display_name, backend_kind, is_enabled, last_health_status, cost_class, supports_chat)
VALUES
  (current_setting('gr.local'), 'Omni Acc Local vLLM', 'local_vllm',  true, 'healthy', 'standard', true),
  (current_setting('gr.cloud'), 'Omni Acc Cloud',      'direct_cloud', true, 'healthy', 'standard', true);

INSERT INTO public.ai_model_registry
  (provider, model_id, is_available, is_deprecated, is_chat_capable)
VALUES
  (current_setting('gr.local'), 'local-qwen-omni-acc', true, false, true),
  (current_setting('gr.cloud'), 'cloud-omni-acc',      true, false, true);

-- ============================================================================
-- (2) LIVE — resolver resolves at all with allow_local=true for a chat clow
-- ============================================================================
SELECT lives_ok(
  $$ SELECT public.aisha_resolve_clow_backend(
       '{"purpose":"omni-acc","task_kind":"chat","allow_local":true}'::jsonb,
       '{}'::jsonb) $$,
  'resolver runs for an allow_local=true chat clow (no exception)'
);

-- (3) LIVE — with allow_local=true the LOCAL candidate is present (boost works)
SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.aisha_resolve_clow_backend(
        '{"purpose":"omni-acc","task_kind":"chat","allow_local":true}'::jsonb,
        '{}'::jsonb) -> 'candidates'
    ) AS c
    WHERE c->>'backend_kind' IN ('local_ollama','local_vllm')
  ),
  'allow_local=true keeps the local backend a candidate (the +0.20 boost path, §6)'
);

-- (4) FALSE-POSITIVE GUARD: allow_local=FALSE must EXCLUDE local candidates
--     (the predicate `backend_kind NOT IN (local_*)` is the only working filter today).
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.aisha_resolve_clow_backend(
        '{"purpose":"omni-acc","task_kind":"chat","allow_local":false}'::jsonb,
        '{}'::jsonb) -> 'candidates'
    ) AS c
    WHERE c->>'backend_kind' IN ('local_ollama','local_vllm')
  ),
  'FALSE-POSITIVE GUARD: allow_local=false excludes local candidates (filter is real for the local direction)'
);

-- (5) LIVE RED regression guard (§11 "filtr cloud kandidátů", DoD #5):
--     a CONFIDENTIAL request sets clow.allow_local=true; the resolver MUST then exclude
--     cloud (direct_cloud/llm_gateway) candidates. Today it does NOT — allow_local=true is
--     boost-only, so the seeded cloud provider still appears as a candidate. We assert the
--     bug is GONE (no cloud candidate). EXPECTED TO FAIL until the resolver hard-filters
--     cloud at allow_local=true. Keep it RED.
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.aisha_resolve_clow_backend(
        '{"purpose":"omni-acc","task_kind":"chat","allow_local":true}'::jsonb,
        '{}'::jsonb) -> 'candidates'
    ) AS c
    WHERE c->>'backend_kind' IN ('direct_cloud','llm_gateway')
  ),
  'RED (DoD #5): allow_local=true must HARD-FILTER cloud candidates (§11) — fails today; resolver only boosts local'
);

SELECT * FROM finish();
ROLLBACK;
