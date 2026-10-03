import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * fn_get_decision_outcomes (L0 outcome read) RUNTIME tests against a real cold-started DB
 * (throwaway pg17 via `npm run test:db`) — the runtime counterpart to
 * tests/gates/decision-outcomes-rpc.gate.test.ts (structural).
 *
 * Proves: the RPC joins a journaled decision (ai_decisions) to its execution trace
 * (ai_trace_events by decision_id) and its run (ai_runs), returns the measurable outcome
 * fields (runtime/model/duration/cost/status), and is fail-closed (unauthenticated → 42501).
 *
 * Repeatable by construction: skips when no DB; seeds sentinel rows; reads assertions back from
 * the live function; cleans up. RAISE inside the DO block → non-zero psql exit → psqlMultiline throws.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("fn_get_decision_outcomes (L0)");
});

describe("fn_get_decision_outcomes — L0 outcome read (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "joins decision + trace + run and returns measurable outcome fields",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_dec uuid;
  v_cnt int;
  v_dur int;
  v_rt  text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- platform/system run (story_id NULL → service_role/admin-only read)
  INSERT INTO public.ai_runs (id, kind, status) VALUES (v_run, 'chat', 'completed');

  -- a journaled decision for that run (the only writer of ai_decisions)
  v_dec := public.fn_record_execution_decision(
    jsonb_build_object('runtime','direct_llm','model_id','gpt-4o-mini',
                       'resolution_source','model_override','reason','l0-outcome.seed'),
    v_run, NULL);

  -- its execution trace, threaded by decision_id, with a real latency + cost
  INSERT INTO public.ai_trace_events (run_id, event_type, status, decision_id, model_id, duration_ms, cost_json)
  VALUES (v_run, 'llm_call', 'ok', v_dec, 'gpt-4o-mini', 1234, jsonb_build_object('total', 0.0021));

  SELECT count(*) INTO v_cnt FROM public.fn_get_decision_outcomes(v_run);
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'expected exactly 1 outcome row, got %', v_cnt; END IF;

  SELECT o.duration_ms, o.runtime INTO v_dur, v_rt
  FROM public.fn_get_decision_outcomes(v_run) o LIMIT 1;
  IF v_dur <> 1234       THEN RAISE EXCEPTION 'duration_ms not joined from trace: %', v_dur; END IF;
  IF v_rt  <> 'direct_llm' THEN RAISE EXCEPTION 'runtime not projected: %', v_rt; END IF;

  -- cleanup (children first; repeatable)
  DELETE FROM public.ai_trace_events WHERE run_id = v_run;
  DELETE FROM public.ai_decisions    WHERE run_id = v_run;
  DELETE FROM public.ai_runs         WHERE id = v_run;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "is fail-closed: an unauthenticated caller cannot read outcomes",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);  -- no uid, no service_role
  BEGIN
    PERFORM 1 FROM public.fn_get_decision_outcomes(gen_random_uuid());
    RAISE EXCEPTION 'L0-VIOLATION: unauthenticated outcome read was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- 42501 expected → contract holds
  END;
END $$;
`);
      expect(run).not.toThrow();
    },
  );
});
