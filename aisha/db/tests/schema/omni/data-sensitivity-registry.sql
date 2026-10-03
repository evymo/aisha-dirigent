-- pgTAP: §11 DB-driven data-sensitivity registry (Fix D)
-- Spec: the confidential residency anchor list moves from a hardcoded svc literal
-- to a DB registry the svc reads (cached) and matches against to force on-prem
-- residency; the verdict is auditable. Tests the schema contract + the read RPC
-- (drop-in for the literal) + the audit writer. Run inside a txn (ROLLBACK).
BEGIN;
SELECT plan(12);

-- ── Schema contract ────────────────────────────────────────────────────────
SELECT has_type('public', 'data_sensitivity', 'data_sensitivity enum type exists');
SELECT lives_ok(
  $$ SELECT 'confidential'::public.data_sensitivity $$,
  'data_sensitivity has the load-bearing ''confidential'' label'
);
SELECT has_table('public', 'data_sensitivity_registry', 'data_sensitivity_registry table exists');
SELECT col_is_pk(
  'public', 'data_sensitivity_registry', 'table_name',
  'table_name is the PK (one classification per table)'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.data_sensitivity_registry'::regclass),
  true,
  'RLS is enabled on data_sensitivity_registry'
);
SELECT has_function(
  'public', 'get_data_sensitivity_registry',
  'get_data_sensitivity_registry() read RPC exists'
);
SELECT has_function(
  'public', 'record_residency_audit',
  ARRAY['uuid', 'uuid', 'text', 'text[]', 'text']::name[],
  'record_residency_audit(uuid,uuid,text,text[],text) audit writer exists'
);

-- ── The read RPC is a faithful drop-in for the old literal ───────────────────
SELECT ok(
  (SELECT count(*) FROM public.get_data_sensitivity_registry()
     WHERE sensitivity = 'confidential'
       AND table_name = ANY (ARRAY['member_health_documents', 'dosing_logs', 'longevity_scores'])) = 3,
  'all three baseline confidential anchors are resolved from the DB registry'
);
INSERT INTO public.data_sensitivity_registry (table_name, sensitivity)
  VALUES ('pgtap_secret_table', 'confidential');
SELECT ok(
  EXISTS (SELECT 1 FROM public.get_data_sensitivity_registry()
            WHERE table_name = 'pgtap_secret_table' AND sensitivity = 'confidential'),
  'a newly-registered confidential table is resolved by the RPC (no code change)'
);

-- The svc reads as service_role. The reader is SECURITY INVOKER (no definer
-- bypass), so the RLS service-role read policy — not elevated privilege — is what
-- lets service_role resolve the anchors. (The postgres/superuser reads above
-- bypass RLS; this asserts the REAL svc path is governed by RLS yet still works.)
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role = 'service_role';
SELECT ok(
  (SELECT count(*) FROM public.get_data_sensitivity_registry() WHERE sensitivity = 'confidential') >= 3,
  'service_role resolves the registry via the INVOKER fn + RLS service-role read policy'
);
RESET ROLE;

-- ── Audit writer (DoD #5) ────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT public.record_residency_audit(NULL, NULL, 'confidential', ARRAY['member_health_documents'], 'omni') $$,
  'record_residency_audit writes a verdict without error'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.audit_journal
            WHERE action_type = 'residency_classification' AND severity = 'warning'),
  'a confidential verdict is persisted to audit_journal as a warning'
);

SELECT * FROM finish();
ROLLBACK;
