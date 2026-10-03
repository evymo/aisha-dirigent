import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * AI decisions journal RUNTIME tests — invariant I1 "no dispatch without a
 * journaled decision", proven against a REAL cold-started database (throwaway
 * pg17 via `npm run test:db`), not a source grep or a mock.
 *
 * This is the runtime counterpart to:
 *   - tests/reflection/i1-dispatch-journaling.gate.test.ts (structural: every
 *     unifiedChat() site co-locates a journaling primitive — derived from the
 *     source tree, no static roster), and
 *   - tests/reflection/dispatch-journal.unit.test.ts (journalDispatch builds the
 *     right decision, mocked rpc).
 *
 * Here we exercise the DB boundary the runtime actually hits: the exact jsonb
 * decision journalDispatch() emits is accepted by fn_record_execution_decision,
 * projected into the ai_decisions columns, and round-trips — AND the journal is
 * fail-closed (unauthenticated / empty decisions are rejected).
 *
 * Dynamic by construction: skips itself when no DB is reachable, reads its
 * assertions back from the live table (no hard-coded ids/counts), and asserts the
 * decision VOCABULARY the schema enforces rather than any fixed allow-list.
 *
 * RAISE inside the DO block → non-zero psql exit → psqlMultiline throws → fail.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("AI Decisions Journal (I1)");
});

describe("ai_decisions journal — I1 no-dispatch-without-decision (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "journals a model_override/direct_llm decision and projects every column (round-trip)",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_id       uuid;
  v_row      public.ai_decisions%ROWTYPE;
  v_before   bigint;
  v_after    bigint;
  -- the EXACT shape journalDispatch() emits at runtime (toExecutionDecision)
  v_decision jsonb := jsonb_build_object(
    'runtime',           'direct_llm',
    'provider_slug',     'openai',
    'model_id',          'gpt-4o-mini',
    'resolution_source', 'model_override',
    'reason',            'i1-integration.evaluate'
  );
BEGIN
  -- route / edge-fn dispatch context authenticates as service_role
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- idempotent: clear any leftover sentinel rows from a prior run
  DELETE FROM public.ai_decisions WHERE reason = 'i1-integration.evaluate';

  SELECT count(*) INTO v_before FROM public.ai_decisions WHERE reason = 'i1-integration.evaluate';

  v_id := public.fn_record_execution_decision(v_decision, NULL, NULL);
  IF v_id IS NULL THEN RAISE EXCEPTION 'I1: fn returned no decision_id'; END IF;

  SELECT count(*) INTO v_after FROM public.ai_decisions WHERE reason = 'i1-integration.evaluate';
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'I1: expected exactly one new journaled row (before=%, after=%)', v_before, v_after;
  END IF;

  SELECT * INTO v_row FROM public.ai_decisions WHERE id = v_id;
  IF v_row.runtime           <> 'direct_llm'     THEN RAISE EXCEPTION 'projection runtime=%', v_row.runtime; END IF;
  IF v_row.resolution_source <> 'model_override' THEN RAISE EXCEPTION 'projection resolution_source=%', v_row.resolution_source; END IF;
  IF v_row.provider_slug     <> 'openai'         THEN RAISE EXCEPTION 'projection provider_slug=%', v_row.provider_slug; END IF;
  IF v_row.model_id          <> 'gpt-4o-mini'    THEN RAISE EXCEPTION 'projection model_id=%', v_row.model_id; END IF;
  IF v_row.reason            <> 'i1-integration.evaluate' THEN RAISE EXCEPTION 'projection reason=%', v_row.reason; END IF;
  -- full-fidelity blob is preserved
  IF v_row.decision_json->>'model_id' <> 'gpt-4o-mini' THEN RAISE EXCEPTION 'fidelity: decision_json not stored'; END IF;

  DELETE FROM public.ai_decisions WHERE id = v_id;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "is fail-closed: an unauthenticated dispatch cannot journal (only authenticated callers write)",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
BEGIN
  -- no auth.uid(), no service_role claim
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.fn_record_execution_decision(
      jsonb_build_object('runtime', 'direct_llm', 'model_id', 'x'), NULL, NULL);
    RAISE EXCEPTION 'I1-VIOLATION: unauthenticated dispatch was journaled';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- 42501 expected → contract holds
  END;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "rejects an empty decision blob at the journal boundary",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    PERFORM public.fn_record_execution_decision('{}'::jsonb, NULL, NULL);
    RAISE EXCEPTION 'I1-VIOLATION: empty decision was journaled';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;  -- 22023 expected → contract holds
  END;
END $$;
`);
      expect(run).not.toThrow();
    },
  );
});
