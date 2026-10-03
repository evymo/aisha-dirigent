-- pgTAP schema-contract tests — Flowboard consent-gate approval (resume keystone)
-- ============================================================================
-- The human-in-the-loop loop needs a way to APPROVE a halted consent gate so the
-- (stateless) executor reads the approval on a resume re-invoke and continues. The
-- approval is a new action branch on the canonical block-action RPC
-- respond_to_story_block_audited('approve_flow_gate', …) — NOT a new RPC. It stamps
-- the flowboard gate entry's metadata.flowboard.status='approved' (+ approver + time).
--
-- This proves the DB CONTRACT the resume path depends on:
--   (1) approve_flow_gate succeeds on a flowboard consent gate (owner, member-mode).
--   (2)/(3) the entry is stamped status='approved' + approved_by=auth.uid().
--   (4) it rejects a non-consent_request entry (22023).
--   (5) it rejects a CLINICAL consent_request (no metadata.flowboard.kind) — the
--       flowboard gate and the clinical signature block share entry_type but are
--       discriminated by metadata.flowboard.kind.
--
-- Runs against the APPLIED (unseeded) cold-start schema as superuser; fixtures use
-- session_replication_role=replica to bypass FK/triggers (synthetic partner_id);
-- JWT identity simulated via request.jwt.claims; the caller is NOT a partner so
-- get_current_partner_id() returns NULL → owner_mode='member' (the run owner).
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);

-- ── Identities ───────────────────────────────────────────────────────────────
SELECT set_config('fp.user',    gen_random_uuid()::text, true);
SELECT set_config('fp.partner', gen_random_uuid()::text, true);
SELECT set_config('fp.story',   gen_random_uuid()::text, true);

-- ── Fixtures (FK/triggers off) ───────────────────────────────────────────────
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id) VALUES (current_setting('fp.user')::uuid);
INSERT INTO partner_stories (id, partner_id, user_id, title)
  VALUES (current_setting('fp.story')::uuid, current_setting('fp.partner')::uuid,
          current_setting('fp.user')::uuid, 'Flowboard run story');

-- ── Authenticate as the flow owner (member-mode: no partner claim) ───────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('fp.user'), 'role', 'authenticated')::text, true);

-- A halted flowboard consent gate entry (kind=consent_request, awaiting_approval).
SELECT set_config('fp.gate_entry',
  create_story_entry_audited(
    current_setting('fp.story')::uuid, 'consent_request', 'Čeká na schválení.',
    '{"flowboard":{"kind":"consent_request","nodeId":"gate-1","status":"awaiting_approval","icon":"lock"}}'::jsonb,
    false)::text, true);

-- (1) approve_flow_gate succeeds
SELECT is(
  (respond_to_story_block_audited('approve_flow_gate', '{}'::jsonb,
     current_setting('fp.gate_entry')::uuid, current_setting('fp.story')::uuid)->>'success')::boolean,
  true, '(1) approve_flow_gate succeeds on a flowboard consent gate (member owner)');

-- (2) the gate metadata is stamped approved
SELECT is(
  (SELECT metadata->'flowboard'->>'status' FROM story_entries WHERE id = current_setting('fp.gate_entry')::uuid),
  'approved', '(2) metadata.flowboard.status is now approved');

-- (3) approved_by is the approver
SELECT is(
  (SELECT metadata->'flowboard'->>'approved_by' FROM story_entries WHERE id = current_setting('fp.gate_entry')::uuid),
  current_setting('fp.user'), '(3) approved_by stamped with the approver uid');

-- (4) rejects a non-consent_request entry
SELECT set_config('fp.step_entry',
  create_story_entry_audited(
    current_setting('fp.story')::uuid, 'automation_step', 'krok',
    '{"flowboard":{"kind":"automation_step"}}'::jsonb, false)::text, true);
SELECT throws_ok(
  $fp$ SELECT respond_to_story_block_audited('approve_flow_gate', '{}'::jsonb,
    current_setting('fp.step_entry')::uuid, current_setting('fp.story')::uuid) $fp$,
  '22023', NULL, '(4) approve_flow_gate rejects a non-consent_request entry (22023)');

-- (5) rejects a CLINICAL consent_request (no metadata.flowboard.kind)
SELECT set_config('fp.clinical_entry',
  create_story_entry_audited(
    current_setting('fp.story')::uuid, 'consent_request', 'klinický souhlas',
    '{"type":"consent_request","consent_name":"X"}'::jsonb, false)::text, true);
SELECT throws_ok(
  $fp$ SELECT respond_to_story_block_audited('approve_flow_gate', '{}'::jsonb,
    current_setting('fp.clinical_entry')::uuid, current_setting('fp.story')::uuid) $fp$,
  '22023', NULL, '(5) approve_flow_gate rejects a clinical consent_request without flowboard.kind (22023)');

SELECT * FROM finish();
ROLLBACK;
