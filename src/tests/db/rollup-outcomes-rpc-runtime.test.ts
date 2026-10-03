import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * fn_rollup_outcomes_to_benchmark (L1 reactive rollup) RUNTIME tests against a real cold-started
 * DB (`npm run test:db`) — the runtime counterpart to tests/gates/fn-rollup-outcomes.gate.test.ts.
 *
 * Proves the post-review design end-to-end with REAL seeded telemetry:
 *  - aggregates ai_decisions ⋈ ai_trace_events per (model × task_kind) into ai_model_reliability
 *    with correct sample_count / success_rate / avg_latency / avg_eval (from faithfulness);
 *  - DOES NOT write ai_model_benchmarks (the C1 regression guard — telemetry must stay out of the
 *    table the resolver ranks on);
 *  - records the observed task_kind (T1);
 *  - is fail-closed for an unauthenticated caller (42501).
 *
 * Repeatable: unique provider/model/task per run; full cleanup (registry delete cascades reliability).
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("fn_rollup_outcomes_to_benchmark (L1)");
});

describe("fn_rollup_outcomes_to_benchmark — L1 reactive rollup (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "rolls real outcomes into ai_model_reliability and leaves ai_model_benchmarks untouched",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_sfx   text := substr(md5(random()::text), 1, 8);
  v_prov  text := 'reltest_prov_' || v_sfx;
  v_model text := 'reltest_model_' || v_sfx;
  v_task  text := 'reltest_kind_' || v_sfx;   -- already lowercase → normalize is a no-op
  v_reg   uuid;
  v_run   uuid := gen_random_uuid();
  v_story uuid := gen_random_uuid();
  v_dec   uuid;
  v_n         int;
  v_samples   bigint;
  v_success   numeric;
  v_latency   int;
  v_eval      numeric;
  v_bench_cnt int;
  v_obs_cnt   int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- registry row: identity is (provider, model_id)
  INSERT INTO public.ai_model_registry (provider, model_id) VALUES (v_prov, v_model) RETURNING id INTO v_reg;

  -- the story the run hangs off: ai_runs.story_id is NOT NULL REFERENCES
  -- partner_stories, so a bare gen_random_uuid() fails the FK. Unnoticed until
  -- now because CI runs test:run with NO database — every src/tests/db/* case
  -- capability-skips there and only executes when a real DB is attached.
  INSERT INTO public.partner_stories (id, title) VALUES (v_story, 'reltest story ' || v_sfx);

  -- a run carrying a REAL eval score (the only source allowed for avg_eval)
  INSERT INTO public.ai_runs (id, kind, status, story_id, faithfulness_score_estimate)
  VALUES (v_run, 'chat', 'succeeded', v_story, 0.9);

  -- a journaled direct_llm decision naming (provider, model, task_kind)
  v_dec := public.fn_record_execution_decision(
    jsonb_build_object('runtime','direct_llm','provider_slug',v_prov,'model_id',v_model,
                       'task_kind',v_task,'resolution_source','model_override','reason','l1-rel.seed'),
    v_run, NULL);

  -- two successful llm_call traces for that decision (n=2, success=1.0, avg latency=1500)
  INSERT INTO public.ai_trace_events (run_id, event_type, status, decision_id, model_id, duration_ms, cost_json)
  VALUES (v_run, 'llm_call', 'ok', v_dec, v_model, 1000, jsonb_build_object('total', 0.001)),
         (v_run, 'llm_call', 'ok', v_dec, v_model, 2000, jsonb_build_object('total', 0.003));

  -- run the rollup
  SELECT public.fn_rollup_outcomes_to_benchmark(168, 1) INTO v_n;
  IF v_n < 1 THEN RAISE EXCEPTION 'rollup upserted no rows (expected >=1): %', v_n; END IF;

  -- reliability row is correct
  SELECT sample_count, ROUND(success_rate,4), avg_latency_ms, ROUND(avg_eval_score,4)
    INTO v_samples, v_success, v_latency, v_eval
  FROM public.ai_model_reliability
  WHERE model_registry_id = v_reg AND task_kind = public.normalize_task_kind(v_task);

  IF v_samples IS DISTINCT FROM 2      THEN RAISE EXCEPTION 'sample_count: % (want 2)', v_samples; END IF;
  IF v_success IS DISTINCT FROM 1.0000 THEN RAISE EXCEPTION 'success_rate: % (want 1.0)', v_success; END IF;
  IF v_latency IS DISTINCT FROM 1500   THEN RAISE EXCEPTION 'avg_latency_ms: % (want 1500)', v_latency; END IF;
  IF v_eval    IS DISTINCT FROM 0.9000 THEN RAISE EXCEPTION 'avg_eval_score: % (want 0.9)', v_eval; END IF;

  -- C1 GUARD: the rollup must NOT have written the ranked benchmarks table
  SELECT count(*) INTO v_bench_cnt FROM public.ai_model_benchmarks WHERE model_registry_id = v_reg;
  IF v_bench_cnt <> 0 THEN
    RAISE EXCEPTION 'C1 VIOLATION: rollup wrote % ai_model_benchmarks row(s)', v_bench_cnt;
  END IF;

  -- T1: the observed task_kind was recorded
  SELECT count(*) INTO v_obs_cnt FROM public.ai_task_kind_registry WHERE task_kind = public.normalize_task_kind(v_task);
  IF v_obs_cnt <> 1 THEN RAISE EXCEPTION 'observed task_kind not recorded: %', v_obs_cnt; END IF;

  -- cleanup (children first; registry delete cascades reliability)
  DELETE FROM public.ai_trace_events       WHERE run_id = v_run;
  DELETE FROM public.ai_decisions          WHERE run_id = v_run;
  DELETE FROM public.ai_runs               WHERE id = v_run;
  DELETE FROM public.ai_model_reliability  WHERE model_registry_id = v_reg;
  DELETE FROM public.ai_model_registry     WHERE id = v_reg;
  DELETE FROM public.ai_task_kind_registry WHERE task_kind = public.normalize_task_kind(v_task);
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "is fail-closed: an unauthenticated caller cannot run the rollup",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);  -- no uid, no service_role
  BEGIN
    PERFORM public.fn_rollup_outcomes_to_benchmark(168, 1);
    RAISE EXCEPTION 'L1-VIOLATION: unauthenticated rollup was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- 42501 expected → contract holds
  END;
END $$;
`);
      expect(run).not.toThrow();
    },
  );
});
