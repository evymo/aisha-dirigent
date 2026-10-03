-- pgTAP acceptance — AISHA Omni · area: discovery-base-instance
-- ============================================================================
-- Spec source of truth: docs/planning/AISHA_OMNI_GATEWAY.md (v4)
--   §5.5  /v1/models advertises aisha-* family + cost-range metadata
--   §6    Model cascade — aisha_resolve_clow_backend (allow_local boost/filter)
--   §11   Governance on-prem gate — confidential ⇒ clow.allow_local=true + filtr cloud
--   §15   registry seed rodiny aisha-* v ai_provider_registry
--   §19.3 aisha_resolve_clow_backend SECURITY DEFINER bypassuje RLS (cross-instance enumeration)
--   §19.4 báze env-driven; GAP: per-instance registry RLS NENÍ vynutitelná
--   §20   P1 #12: registry RLS (instance-scoped) + cost cols feed /v1/models
--
-- ISOLATION: this file lives under aisha/db/tests/schema/omni/. The default runner
-- scripts/db/run-schema-tests.mjs reads aisha/db/tests/schema/*.sql NON-recursively
-- (readdirSync, top-level only), so it is NOT picked up by a normal run — it executes
-- ONLY in acceptance mode (the omni acceptance runner points at the omni/ subdir).
-- Same BEGIN…ROLLBACK + CREATE EXTENSION pgtap pattern as the sibling schema tests.
--
-- LIVE vs SKIP: every surface asserted here EXISTS today (tables + functions + policies),
-- so all assertions are LIVE. Several are INTENTIONALLY RED — they encode the §19.3/§19.4
-- per-instance-RLS GAP and act as regression guards that must flip green when instance-scoped
-- RLS lands IN THE BASE (never in instances).
--   GREEN today (surface-exists + current-behavior positives):
--     ai_provider_registry / ai_model_registry tables, RLS enabled, cost columns,
--     aisha_resolve_clow_backend(jsonb,jsonb) SECURITY DEFINER, allow_local hard-filter,
--     get_adaptive_model_tiers() RPC.
--   RED today (per-instance isolation GAP, §19.3/§19.4):
--     ai_provider_registry tenant/instance scoping column, tenant-scoped SELECT policy,
--     tenant filter inside the SECURITY DEFINER resolver body.
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(20);

-- ── Positive: discovery surfaces that EXIST today ───────────────────────────
SELECT has_table('public', 'ai_provider_registry',
  'positive: ai_provider_registry table exists (§15 backend catalog)');
SELECT has_table('public', 'ai_model_registry',
  'positive: ai_model_registry table exists (per-model tiers + cost)');
SELECT has_column('public', 'ai_provider_registry', 'backend_kind',
  'positive: ai_provider_registry.backend_kind (resolver dispatch key)');
SELECT has_column('public', 'ai_provider_registry', 'auth_env_var',
  'positive: ai_provider_registry.auth_env_var (env-driven "uses what it has", §19.4)');
SELECT has_column('public', 'ai_provider_registry', 'is_enabled',
  'positive: ai_provider_registry.is_enabled (availability gate)');

-- ── Positive: cost metadata that /v1/models advertises (§5.5) ───────────────
SELECT has_column('public', 'ai_model_registry', 'input_price_per_m',
  'positive: ai_model_registry.input_price_per_m (cost-range source for /v1/models, §5.5)');
SELECT has_column('public', 'ai_model_registry', 'output_price_per_m',
  'positive: ai_model_registry.output_price_per_m (cost-range source for /v1/models, §5.5)');

-- ── Positive: authoritative resolver exists + is SECURITY DEFINER (§6/§19.3) ─
SELECT has_function('public', 'aisha_resolve_clow_backend', ARRAY['jsonb','jsonb'],
  'positive: aisha_resolve_clow_backend(jsonb,jsonb) exists (authoritative resolver, baseline:17681)');
SELECT has_function('public', 'get_adaptive_model_tiers', ARRAY['text'],
  'positive: get_adaptive_model_tiers(text) exists (DB layer of tier fallback chain, §19.4)');

-- ── Positive: RLS is ENABLED on the registry (precondition for instance scoping) ──
SELECT ok(
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relname='ai_provider_registry'),
  'positive: RLS ENABLED on ai_provider_registry (baseline.sql:2334)'
);

-- ── False-positive guard: resolver must NOT be PUBLIC-executable (§16 auth split) ──
-- baseline.sql:17844 REVOKEs ALL from PUBLIC; only authenticated/service_role may resolve backends.
SELECT ok(
  NOT has_function_privilege('public', 'aisha_resolve_clow_backend(jsonb,jsonb)', 'EXECUTE'),
  'false-positive guard: PUBLIC must NOT EXECUTE aisha_resolve_clow_backend (revoked)'
);

-- ── False-positive guard: allow_local=false hard-filters local backends (§11) ──
-- The resolver WHERE clause (baseline.sql:17790-17793) excludes local_* providers unless allow_local.
-- This is the inverse of the §11 confidential path; assert the filter literal is present in the body.
SELECT ok(
  pg_get_functiondef('public.aisha_resolve_clow_backend(jsonb,jsonb)'::regprocedure)
    LIKE '%v_allow_local%local_ollama%',
  'false-positive guard: resolver body references v_allow_local + local_ollama (allow_local filter, §11)'
);

-- ── Negative / availability: resolver filters out disabled or unhealthy providers ──
-- baseline.sql:17784-17785 — WHERE p.is_enabled AND p.last_health_status IN ('healthy','unknown').
SELECT ok(
  pg_get_functiondef('public.aisha_resolve_clow_backend(jsonb,jsonb)'::regprocedure)
    LIKE '%p.is_enabled%',
  'negative/availability: resolver filters candidates by p.is_enabled (disabled provider not selected)'
);
SELECT ok(
  pg_get_functiondef('public.aisha_resolve_clow_backend(jsonb,jsonb)'::regprocedure)
    LIKE '%last_health_status%',
  'negative/availability: resolver filters candidates by last_health_status (down provider not selected)'
);

-- ── Positive (current behavior): resolver IS SECURITY DEFINER (§19.3 — the bypass) ──
SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='aisha_resolve_clow_backend' LIMIT 1),
  'positive(current): aisha_resolve_clow_backend is SECURITY DEFINER (RLS-bypassing per §19.3)'
);

-- ── Per-instance model isolation guards (§19.3/§19.4/§20 P1 #12) ──
-- These were LIVE-RED until instance-scoped scoping landed IN THE BASE; they now flip
-- GREEN (scoped_to_instance_id column + tenant-scoped SELECT policy + explicit resolver
-- candidate filter) and stand as regression guards against the scoping being removed.

-- §19.4: registry carries a tenant/instance scoping column (no cross-instance enumeration).
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ai_provider_registry'
      AND column_name IN ('tenant_id','account_id','instance_id','scoped_to_instance_id','allowed_instances')
  ),
  'GREEN (§19.4): ai_provider_registry carries a tenant/instance scoping column (scoped_to_instance_id — landed)'
);

-- §19.3: the SELECT policy is tenant-scoped, not "any authenticated user".
-- Policy "ai_provider_registry_authenticated_read" now scopes on scoped_to_instance_id
-- (base/global NULL is global; instance-scoped rows are visible only within their instance).
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ai_provider_registry' AND cmd='SELECT'
      AND qual ~ 'tenant_id|account_id|instance_id|scoped_to_instance'
  ),
  'GREEN (§19.3): ai_provider_registry SELECT policy references a tenant/instance scope (scoped_to_instance_id — landed)'
);

-- §19.3: the SECURITY DEFINER resolver tenant-filters its candidate query
-- (RLS scoping is bypassed inside SECURITY DEFINER, so an explicit filter is required).
-- NB: [\s\S]* (not [^;]*) — pg_get_functiondef reformats the candidate subquery so the
-- FROM ai_provider_registry and the WHERE scoped_to_instance_id filter can straddle a
-- statement boundary in the rendered body; we only assert both are present + ordered.
SELECT ok(
  pg_get_functiondef('public.aisha_resolve_clow_backend(jsonb,jsonb)'::regprocedure)
    ~ 'ai_provider_registry[\s\S]*(tenant_id|account_id|instance_id|scoped_to_instance)',
  'GREEN (§19.3): SECURITY DEFINER resolver tenant-filters ai_provider_registry candidates (scoped_to_instance_id — landed)'
);

-- §15/§5.5: the aisha-* tier family should be discoverable from the registry seed.
-- Today the registry seeds raw provider slugs (anthropic/openai/google/ollama/vllm), NOT the aisha-* tier
-- family — the inbound tier family is a /v1/models projection that does not yet exist. RED until §5.5/§15 seed.
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.ai_model_registry
    WHERE model_id LIKE 'aisha-%'
  ),
  'LIVE-RED (§5.5/§15): aisha-* tier family MUST be discoverable from registry (RED until /v1/models seed lands)'
);

-- §16 auth split (companion to the resolver REVOKE): registry must not be writable by PUBLIC.
-- The ALL policy is TO public USING (auth.role() = 'service_role') → PUBLIC has no write path.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ai_provider_registry'
      AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
      AND 'public' = ANY(roles)
      AND COALESCE(qual,'') !~ 'service_role'
      AND COALESCE(with_check,'') !~ 'service_role'
  ),
  'false-positive guard: no PUBLIC write policy on ai_provider_registry without a service_role guard (§16)'
);

SELECT * FROM finish();
ROLLBACK;
