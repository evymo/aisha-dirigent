-- pgTAP — updated_at trigger/column parity (systemic invariant)
-- ============================================================================
-- Every table wired to the generic update_updated_at_column() trigger MUST
-- have an updated_at column — otherwise every UPDATE on it fails at runtime
-- with `record "new" has no field "updated_at"`. This was latent on FIVE
-- tables (ai_model_benchmarks, delivery_transition_rules, delivery_transitions,
-- knowledge_topic_translations, knowledge_topic_versions) until the G4
-- eval-gate pgTAP (18_eval_before_migration_gate.sql) UPDATEd
-- ai_model_benchmarks and tripped it. The columns are now added in the table
-- SoT + healed onto existing DBs; this test locks the whole class.
-- Runs after baseline+heals; rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(2);

-- (1) no update_updated_at_column() trigger targets a table lacking updated_at
SELECT is(
  (SELECT count(*)::int
     FROM pg_trigger t
     JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND p.proname = 'update_updated_at_column'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name   = t.tgrelid::regclass::text
           AND c.column_name  = 'updated_at')),
  0,
  '(1) every update_updated_at_column() trigger target has an updated_at column');

-- (2) the trip-wire table is actually updatable now (trigger fires cleanly)
SELECT lives_ok(
  $$ UPDATE public.ai_model_benchmarks SET overall_score = overall_score WHERE false $$,
  '(2) ai_model_benchmarks UPDATE path is exercisable');

SELECT * FROM finish();
ROLLBACK;
