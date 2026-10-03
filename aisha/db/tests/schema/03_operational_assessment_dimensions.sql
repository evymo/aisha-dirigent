-- pgTAP functional tests — operational-assessment dimension writer/reader (PR #436)
-- ============================================================================
-- Bug #436: save_operational_assessment_dimension() updated only the JSONB
-- `dimensions` column on operational_assessments and left the NORMALIZED table
-- operational_assessment_dimensions EMPTY. The reader
-- get_my_latest_operational_assessment_audited() builds its `dimensions` jsonb
-- by LEFT JOINing that normalized table, so the empty table meant the reader
-- always returned `[]`. The fix makes the writer upsert into the normalized
-- table (ON CONFLICT (assessment_id, dimension) DO UPDATE).
--
-- This test proves the post-fix contract:
--   * one call writes exactly ONE normalized row with the passed normalized_score
--   * a second call for the SAME dimension UPSERTS (still one row, score updated)
--   * the reader surfaces the normalized_score read FROM the normalized table
--   * the function's own ownership guard RAISEs 'Access denied' for a non-owner
--
-- Runs against the APPLIED (unseeded) cold-start schema as superuser; fixtures
-- use session_replication_role=replica to bypass FK/triggers. JWT identity is
-- simulated via request.jwt.claims (auth.uid() = request.jwt.claims->>'sub').
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

-- ── Parametric identities (stable across the file) ───────────────────────────
SELECT set_config('oad.owner',      gen_random_uuid()::text, true);
SELECT set_config('oad.intruder',   gen_random_uuid()::text, true);
SELECT set_config('oad.assessment', gen_random_uuid()::text, true);

-- ── Fixtures: two users + one completed assessment owned by oad.owner ────────
-- status='completed' so the reader (which filters status='completed') returns it.
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id) VALUES
  (current_setting('oad.owner')::uuid),
  (current_setting('oad.intruder')::uuid);
INSERT INTO operational_assessments
  (id, user_id, status, assessment_type, completed_at)
VALUES
  (current_setting('oad.assessment')::uuid, current_setting('oad.owner')::uuid,
   'completed'::assessment_status, 'onboarding', now());
SET session_replication_role = origin;

-- ── Authenticate as the owner ────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('oad.owner'), 'role','authenticated')::text, true);

-- (1) Writer returns true for the owner with a real operational_dimension value.
SELECT is(
  save_operational_assessment_dimension(
    current_setting('oad.assessment')::uuid,  -- p_assessment_id
    'VIT',                                     -- p_dimension (operational_dimension)
    7.50,                                      -- p_raw_score
    72.00,                                     -- p_normalized_score
    4,                                         -- p_tag_count
    false,                                     -- p_has_negative_indicators
    ARRAY['flag_a','flag_b']::text[]           -- p_operational_flags
  ),
  true,
  '(1) writer returns true when the owner saves a VIT dimension');

-- (2) CORE of #436: exactly ONE normalized row exists for (assessment, dimension).
SELECT is(
  (SELECT count(*)::int FROM operational_assessment_dimensions
     WHERE assessment_id = current_setting('oad.assessment')::uuid
       AND dimension = 'VIT'::operational_dimension),
  1,
  '(2) writer populates the normalized table: exactly one VIT row exists');

-- (3) ...and that row carries the normalized_score we passed (table not just JSONB).
SELECT is(
  (SELECT normalized_score FROM operational_assessment_dimensions
     WHERE assessment_id = current_setting('oad.assessment')::uuid
       AND dimension = 'VIT'::operational_dimension),
  72.00::numeric,
  '(3) the normalized VIT row stores the passed normalized_score (72.00)');

-- (4) Upsert: save the SAME dimension again with a DIFFERENT normalized_score.
SELECT is(
  save_operational_assessment_dimension(
    current_setting('oad.assessment')::uuid, 'VIT',
    8.10, 88.00, 5, true, ARRAY['flag_c']::text[]),
  true,
  '(4) writer returns true on the second save of the same VIT dimension');

-- (4b) Still exactly ONE row, and the score was UPDATED (ON CONFLICT upsert).
SELECT is(
  (SELECT count(*)::int FROM operational_assessment_dimensions
     WHERE assessment_id = current_setting('oad.assessment')::uuid
       AND dimension = 'VIT'::operational_dimension),
  1,
  '(4b) re-save upserts in place: still exactly one VIT row');
SELECT is(
  (SELECT normalized_score FROM operational_assessment_dimensions
     WHERE assessment_id = current_setting('oad.assessment')::uuid
       AND dimension = 'VIT'::operational_dimension),
  88.00::numeric,
  '(4c) upsert updated the normalized_score in place (72.00 → 88.00)');

-- (5) Reader surfaces the dimension with the normalizedScore read FROM the
--     normalized table (LEFT JOIN operational_assessment_dimensions).
SELECT ok(
  EXISTS (
    SELECT 1
    FROM get_my_latest_operational_assessment_audited() r,
         jsonb_array_elements(r.dimensions) d
    WHERE d->>'dimension' = 'VIT'
      AND (d->>'normalizedScore')::numeric = 88.00
  ),
  '(5) reader returns the VIT dimension with normalizedScore=88.00 from the normalized table');

-- (6) Ownership guard: a DIFFERENT authenticated user cannot write to the
--     owner''s assessment — the function RAISEs ''Access denied'' (P0001).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('oad.intruder'), 'role','authenticated')::text, true);
SELECT throws_ok(
  $oad$ SELECT save_operational_assessment_dimension(
          current_setting('oad.assessment')::uuid, 'ENE',
          5.0, 50.0, 1, false, ARRAY[]::text[]) $oad$,
  'P0001', 'Access denied',
  '(6) ownership guard: a non-owner is denied with ''Access denied''');

SELECT * FROM finish();
ROLLBACK;