import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Runtime coverage for the service-side blockchain + reward RPCs that ship with
 * the ledger-sync work (svc-blockchain). Real-DB harness (throwaway pg17 via
 * `npm run test:db`). Each DO block RAISEs on a failed assertion → non-zero psql
 * exit → psqlMultiline throws → the test fails.
 *
 * Covers what a plain `vitest run` (esbuild, no DB) cannot: the actual SQL
 * behaviour of get/update_blockchain_audit_record(_status), get_user_cosmos_address,
 * get_reward_claim / fulfill_reward_claim, the write_audit_journal unknown-actor
 * guard, the least-privilege posture (service_role only), and a fn_hermes_learning_loop
 * smoke.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("Blockchain + Reward RPCs Runtime");
});

describe("blockchain + reward RPCs (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "blockchain audit RPCs: get by id, empty-set for unknown, status update sets processing_started_at, COALESCE preserves fields",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_id   uuid;
  v_cnt  integer;
  v_ts   timestamptz;
  v_hash text;
  v_rc   integer;
BEGIN
  INSERT INTO public.blockchain_audit_records (reference_table, reference_id, retry_count)
  VALUES ('token_transactions', gen_random_uuid(), 2)
  RETURNING id INTO v_id;

  -- get by id returns exactly one row
  SELECT count(*) INTO v_cnt FROM public.get_blockchain_audit_record(v_id);
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'get_blockchain_audit_record: expected 1 row, got %', v_cnt; END IF;

  -- unknown id returns empty set
  SELECT count(*) INTO v_cnt FROM public.get_blockchain_audit_record(gen_random_uuid());
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'get_blockchain_audit_record(unknown): expected 0 rows, got %', v_cnt; END IF;

  -- update to 'processing' stamps processing_started_at
  PERFORM public.update_blockchain_audit_status(v_id, 'processing');
  SELECT processing_started_at INTO v_ts FROM public.blockchain_audit_records WHERE id = v_id;
  IF v_ts IS NULL THEN RAISE EXCEPTION 'update(processing): processing_started_at not stamped'; END IF;

  -- set a tx hash; then a later NULL-field call must PRESERVE it (COALESCE) + retry_count
  PERFORM public.update_blockchain_audit_status(v_id, 'confirmed', NULL, 5, 'cosmos_tx_abc');
  PERFORM public.update_blockchain_audit_status(v_id, 'confirmed');
  SELECT cosmos_tx_hash, retry_count INTO v_hash, v_rc FROM public.blockchain_audit_records WHERE id = v_id;
  IF v_hash <> 'cosmos_tx_abc' THEN RAISE EXCEPTION 'COALESCE failed: cosmos_tx_hash=%', v_hash; END IF;
  IF v_rc <> 5 THEN RAISE EXCEPTION 'COALESCE failed: retry_count=%', v_rc; END IF;

  -- append-only ledger (Ledger Path 1): DELETE must be rejected by the tamper guard
  BEGIN
    DELETE FROM public.blockchain_audit_records WHERE id = v_id;
    RAISE EXCEPTION 'audit ledger guard missing: DELETE unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'audit ledger: DELETE forbidden%' THEN RAISE; END IF;
  END;
END $$;`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "reward RPCs: get_reward_claim scoped to owner (null for wrong user), fulfill marks fulfilled + tx_hash",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_user  uuid;
  v_claim uuid;
  v_json  jsonb;
BEGIN
  SELECT u.id INTO v_user FROM aisha_auth.users u JOIN public.profiles p ON p.id = u.id LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'fixture: no seeded user with a profile'; END IF;

  INSERT INTO public.reward_claims (user_id, amount, denom, status)
  VALUES (v_user, 100, 'uash', 'pending') RETURNING id INTO v_claim;

  -- owner sees the claim
  v_json := public.get_reward_claim(v_claim, v_user);
  IF v_json IS NULL OR v_json->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'get_reward_claim(owner): unexpected %', v_json; END IF;
  IF (v_json->>'amount')::bigint <> 100 THEN RAISE EXCEPTION 'get_reward_claim: amount mismatch %', v_json; END IF;

  -- a different user gets NULL (scoped)
  v_json := public.get_reward_claim(v_claim, gen_random_uuid());
  IF v_json IS NOT NULL THEN RAISE EXCEPTION 'get_reward_claim(wrong user): expected NULL, got %', v_json; END IF;

  -- fulfill marks fulfilled + records tx hash
  PERFORM public.fulfill_reward_claim(v_claim, 'cosmos_reward_tx');
  v_json := public.get_reward_claim(v_claim, v_user);
  IF v_json->>'status' <> 'fulfilled' THEN RAISE EXCEPTION 'fulfill: status=%', v_json->>'status'; END IF;
  IF (SELECT tx_hash FROM public.reward_claims WHERE id = v_claim) <> 'cosmos_reward_tx' THEN
    RAISE EXCEPTION 'fulfill: tx_hash not persisted'; END IF;

  -- unknown claim → success:false (idempotent-safe, no raise)
  IF (public.fulfill_reward_claim(gen_random_uuid(), 'x')->>'success')::boolean <> false THEN
    RAISE EXCEPTION 'fulfill(unknown): expected success:false'; END IF;

  DELETE FROM public.reward_claims WHERE id = v_claim;
END $$;`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "get_user_cosmos_address returns the profile's cosmos_address (and null jsonb field when unset)",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_user uuid;
  v_prev text;
  v_json jsonb;
BEGIN
  SELECT id, cosmos_address INTO v_user, v_prev FROM public.profiles LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'fixture: no seeded profile'; END IF;

  UPDATE public.profiles SET cosmos_address = 'cosmos1testcosmosaddr' WHERE id = v_user;
  v_json := public.get_user_cosmos_address(v_user);
  IF v_json->>'cosmos_address' <> 'cosmos1testcosmosaddr' THEN
    RAISE EXCEPTION 'get_user_cosmos_address: %', v_json; END IF;

  -- restore
  UPDATE public.profiles SET cosmos_address = v_prev WHERE id = v_user;
END $$;`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "write_audit_journal tolerates an unknown actor (no FK 23503 — unknown-actor guard)",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_journal uuid;
BEGIN
  -- a random, non-existent user id must NOT raise a foreign-key violation: the
  -- service-role blockchain path journals with whatever actor it has.
  v_journal := public.write_audit_journal(
    p_action_type := 'integration'::journal_action_type,
    p_area := 'blockchain'::journal_area,
    p_details := jsonb_build_object('test', true),
    p_entity_id := gen_random_uuid()::text,
    p_entity_type := 'reward_claims',
    p_severity := 'info'::journal_severity,
    p_summary := 'rpc runtime test',
    p_user_id := gen_random_uuid()
  );
  IF v_journal IS NULL THEN RAISE EXCEPTION 'write_audit_journal returned NULL journal id'; END IF;
END $$;`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "least-privilege posture: new RPCs are REVOKE'd from PUBLIC/anon and GRANTed to service_role",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_fn text;
  v_svc_only text[] := ARRAY[
    'public.get_blockchain_audit_record(uuid)',
    'public.get_user_cosmos_address(uuid)',
    'public.update_blockchain_audit_status(uuid,text,text,integer,text)',
    'public.get_reward_claim(uuid,uuid)',
    'public.fulfill_reward_claim(uuid,text)'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_svc_only LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon must NOT execute %', v_fn; END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role must execute %', v_fn; END IF;
  END LOOP;
END $$;`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "fn_hermes_learning_loop smoke: returns an eval + actioned flag for an existing story",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_story uuid;
  v_user  uuid;
  v_json  jsonb;
BEGIN
  SELECT id INTO v_story FROM public.partner_stories LIMIT 1;
  IF v_story IS NULL THEN
    RAISE NOTICE 'no seeded partner_story — skipping hermes loop smoke';
    RETURN;
  END IF;
  -- evaluate_story_self requires auth.uid() OR role=service_role. Set an authed
  -- user (the authenticated path); svc-agent-runner uses the service_role bypass.
  SELECT id INTO v_user FROM public.profiles LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_json := public.fn_hermes_learning_loop(v_story, NULL, NULL);
  IF NOT (v_json ? 'eval') THEN RAISE EXCEPTION 'fn_hermes_learning_loop: missing eval, got %', v_json; END IF;
  IF NOT (v_json ? 'actioned') THEN RAISE EXCEPTION 'fn_hermes_learning_loop: missing actioned flag'; END IF;
END $$;`);
      expect(run).not.toThrow();
    },
  );
});
