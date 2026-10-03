-- pgTAP — REAL audit-ledger hash chain (Ledger Path 1)
-- ============================================================================
-- blockchain_audit_records used to be a decorative ledger: previous_hash was
-- never written, the outbox trigger wrote no hash at all, and audit_journal's
-- "blockchain_hash" was salted with session-local now()::text. This locks the
-- real chain: deterministic canonical record hash (fn_audit_ledger_record_hash),
-- tip-linking BEFORE INSERT trigger, immutable-column/DELETE tamper guard,
-- fn_verify_audit_chain broken-link detector (fail-loud, first broken link),
-- and the deterministic, recomputable v2 audit_journal hash
-- (write_audit_journal + fn_verify_audit_journal_entry).
-- Runs after baseline+heals; fully rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(24);

-- Pre-generated row ids so assertions can reference them.
SELECT set_config('tap.r1', gen_random_uuid()::text, true);
SELECT set_config('tap.r2', gen_random_uuid()::text, true);
SELECT set_config('tap.r3', gen_random_uuid()::text, true);
SELECT set_config('tap.ref', gen_random_uuid()::text, true);
SELECT set_config('tap.aj_legacy', gen_random_uuid()::text, true);

-- ── Objects present ─────────────────────────────────────────────────────────
SELECT has_function('public', 'fn_audit_ledger_record_hash', '(1) canonical record-hash fn exists');
SELECT has_function('public', 'fn_blockchain_audit_chain_link', '(2) chain-link trigger fn exists');
SELECT has_function('public', 'fn_blockchain_audit_guard', '(3) tamper-guard trigger fn exists');
SELECT has_function('public', 'fn_verify_audit_chain', ARRAY['integer'], '(4) broken-chain detector exists');
SELECT has_function('public', 'fn_verify_audit_journal_entry', ARRAY['uuid'], '(5) audit_journal entry verifier exists');
SELECT has_trigger('public', 'blockchain_audit_records', 'trg_blockchain_audit_chain_link',
  '(6) BEFORE INSERT chain-link trigger installed');
SELECT has_trigger('public', 'blockchain_audit_records', 'trg_blockchain_audit_guard',
  '(7) tamper-guard trigger installed');
SELECT has_index('public', 'blockchain_audit_records', 'idx_bar_previous_hash',
  '(8) unique previous_hash index (structural fork prevention)');

-- ── Hash determinism (no clock/random salt) ────────────────────────────────
SELECT is(
  fn_audit_ledger_record_hash(repeat('0',64), 't', '{"a":1}'::jsonb, NULL, NULL, NULL, NULL, '2026-01-02T03:04:05.123456Z'::timestamptz),
  fn_audit_ledger_record_hash(repeat('0',64), 't', '{"a":1}'::jsonb, NULL, NULL, NULL, NULL, '2026-01-02T03:04:05.123456Z'::timestamptz),
  '(9) identical inputs → identical hash (deterministic)');
SELECT isnt(
  fn_audit_ledger_record_hash(repeat('0',64), 't', '{"a":1}'::jsonb, NULL, NULL, NULL, NULL, '2026-01-02T03:04:05.123456Z'::timestamptz),
  fn_audit_ledger_record_hash(repeat('0',64), 't', '{"a":2}'::jsonb, NULL, NULL, NULL, NULL, '2026-01-02T03:04:05.123456Z'::timestamptz),
  '(10) different data → different hash');

-- ── Chain linking on INSERT ────────────────────────────────────────────────
INSERT INTO blockchain_audit_records (id, record_type, data, status)
VALUES (current_setting('tap.r1')::uuid, 'token_sync', '{"k":"v1"}'::jsonb, 'queued');

SELECT is(
  (SELECT record_hash FROM blockchain_audit_records WHERE id = current_setting('tap.r1')::uuid),
  (SELECT fn_audit_ledger_record_hash(previous_hash, record_type, data, reference_table,
      reference_id, token_transaction_id, correlation_id, created_at)
     FROM blockchain_audit_records WHERE id = current_setting('tap.r1')::uuid),
  '(11) stored record_hash is recomputable from stored columns alone');

-- Caller-supplied record_hash (legacy payload-hash semantic) is preserved.
INSERT INTO blockchain_audit_records (id, record_type, record_hash, data, status)
VALUES (current_setting('tap.r2')::uuid, 'token_sync', 'cafe0000payloadhash', '{"k":"v2"}'::jsonb, 'queued');

SELECT is(
  (SELECT data ->> 'payload_hash' FROM blockchain_audit_records WHERE id = current_setting('tap.r2')::uuid),
  'cafe0000payloadhash',
  '(12) caller-supplied record_hash preserved as data.payload_hash');
SELECT is(
  (SELECT previous_hash FROM blockchain_audit_records WHERE id = current_setting('tap.r2')::uuid),
  (SELECT record_hash FROM blockchain_audit_records WHERE id = current_setting('tap.r1')::uuid),
  '(13) previous_hash links to the prior row''s record_hash');

-- ── Detector: intact chain verifies ────────────────────────────────────────
SET ROLE service_role;
SELECT ok(
  (public.fn_verify_audit_chain() ->> 'ok')::boolean,
  '(14) fn_verify_audit_chain: intact chain → ok=true');
SELECT is(
  public.fn_verify_audit_chain() ->> 'head_hash',
  (SELECT record_hash FROM blockchain_audit_records WHERE id = current_setting('tap.r2')::uuid),
  '(15) chain head is the newest row''s record_hash');
RESET ROLE;

-- ── Tamper guard ───────────────────────────────────────────────────────────
SELECT throws_ok(
  format($q$ UPDATE blockchain_audit_records SET data = '{"k":"tampered"}'::jsonb WHERE id = %L $q$,
         current_setting('tap.r1')),
  'P0001', NULL,
  '(16) UPDATE of chain-carrying column is rejected');
SELECT throws_ok(
  format($q$ DELETE FROM blockchain_audit_records WHERE id = %L $q$, current_setting('tap.r1')),
  'P0001', NULL,
  '(17) DELETE is rejected (broken link)');
SELECT lives_ok(
  format($q$ UPDATE blockchain_audit_records SET status = 'dispatched' WHERE id = %L $q$,
         current_setting('tap.r1')),
  '(18) outbox status machine stays updatable');

-- ── Detector: finds the FIRST broken link after (escaped) tampering ────────
SELECT set_config('aisha.audit_ledger_rebuild', 'on', true);
UPDATE blockchain_audit_records SET data = '{"k":"tampered"}'::jsonb
WHERE id = current_setting('tap.r1')::uuid;
SELECT set_config('aisha.audit_ledger_rebuild', 'off', true);

SET ROLE service_role;
SELECT ok(
  NOT (public.fn_verify_audit_chain() ->> 'ok')::boolean,
  '(19) tampered row content → ok=false');
SELECT is(
  public.fn_verify_audit_chain() -> 'first_broken' ->> 'reason',
  'record_hash_mismatch',
  '(20) first broken link reported as record_hash_mismatch');
RESET ROLE;

-- Restoring the exact original content heals verification (precision check).
SELECT set_config('aisha.audit_ledger_rebuild', 'on', true);
UPDATE blockchain_audit_records SET data = '{"k":"v1"}'::jsonb
WHERE id = current_setting('tap.r1')::uuid;
SELECT set_config('aisha.audit_ledger_rebuild', 'off', true);

-- ── Idempotent outbox path (ON CONFLICT DO NOTHING) stays chain-safe ───────
INSERT INTO blockchain_audit_records (id, record_type, data, status, reference_table, reference_id)
VALUES (current_setting('tap.r3')::uuid, 'token_sync', '{}'::jsonb, 'queued',
        'token_transactions', current_setting('tap.ref')::uuid);
SELECT lives_ok(
  format($q$
    INSERT INTO blockchain_audit_records (record_type, data, status, reference_table, reference_id)
    VALUES ('token_sync', '{}'::jsonb, 'queued', 'token_transactions', %L)
    ON CONFLICT (reference_table, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
  $q$, current_setting('tap.ref')),
  '(21) duplicate outbox insert is a no-op, not a chain error');

SET ROLE service_role;
SELECT ok(
  (public.fn_verify_audit_chain() ->> 'ok')::boolean,
  '(22) chain verifies end-to-end after restore + idempotent re-insert');
RESET ROLE;

-- ── audit_journal deterministic v2 hash ────────────────────────────────────
SELECT set_config('tap.aj1', public.write_audit_journal(
  p_action_type := 'create'::journal_action_type,
  p_area        := 'blockchain'::journal_area,
  p_details     := '{"probe":"ledger-path-1"}'::jsonb,
  p_entity_id   := 'tap-entity',
  p_entity_type := 'tap_test',
  p_summary     := 'pgTAP ledger probe'
)::text, true);

SELECT ok(
  (SELECT blockchain_hash LIKE 'v2:%' FROM audit_journal WHERE id = current_setting('tap.aj1')::uuid),
  '(23) write_audit_journal stores the v2 deterministic hash in the blockchain_hash column');

INSERT INTO audit_journal (id, action, entity_type, entity_id, metadata, created_at)
VALUES (current_setting('tap.aj_legacy')::uuid, 'create', 'tap_test', 'legacy-entity',
        jsonb_build_object('blockchain_hash', md5('legacy-salted-hash')), now());

SET ROLE service_role;
SELECT results_eq(
  format($q$
    SELECT ARRAY[
      public.fn_verify_audit_journal_entry(%L::uuid) ->> 'state',
      public.fn_verify_audit_journal_entry(%L::uuid) ->> 'state'
    ]
  $q$, current_setting('tap.aj1'), current_setting('tap.aj_legacy')),
  $$ VALUES (ARRAY['verified','unverifiable_legacy']) $$,
  '(24) v2 entry verifies; legacy now()-salted hash honestly reported unverifiable');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
