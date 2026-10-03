import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { HEADER, SERVICE_CLAIMS } from "./_e2e-spine";

/**
 * S9 — Feedback loop (governed auto-eval) against a real DB.
 *
 *  (1) Ranking causality: a CURATED record_model_benchmark raises the resolver's top score for that
 *      (model, task) — the deliberate quality path. (Reactive telemetry → ai_model_reliability is
 *      covered by rollup-outcomes-rpc-runtime and is ADVISORY: it does NOT move ranking — by design.)
 *  (2) Advisory proposal lifecycle is callable + gated: fn_create_improvement_proposal →
 *      fn_evaluate_proposal_risk → fn_record_proposal_outcome, each returning the expected shape.
 *
 * Repeatable: unique slugs/anomaly_key + full cleanup.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("S9 feedback loop");
});

describe("S9 — feedback loop (local DB)", () => {
  it.skipIf(!dbAvailable)("curated benchmark raises the resolver score (before/after delta)", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_sfx  text := substr(md5(random()::text), 1, 8);
  v_prov text := 'e2e_fb_' || v_sfx;
  v_mod  text := 'e2e_fbmodel_' || v_sfx;
  v_reg  uuid;
  v_res0 jsonb;
  v_res1 jsonb;
  v_s0   numeric;
  v_s1   numeric;
BEGIN
  ${SERVICE_CLAIMS}

  INSERT INTO public.ai_provider_registry (slug, display_name, backend_kind, auth_kind, is_enabled, last_health_status)
  VALUES (v_prov, 'E2E FB', 'direct_cloud', 'bearer', true, 'healthy');
  INSERT INTO public.ai_model_registry (provider, model_id) VALUES (v_prov, v_mod) RETURNING id INTO v_reg;

  v_res0 := public.aisha_resolve_clow_backend(
    jsonb_build_object('purpose', 'fb', 'task_kind', 'chat'),
    jsonb_build_object('serviceable_slugs', jsonb_build_array(v_prov)));
  v_s0 := (v_res0->'top'->>'score')::numeric;   -- no benchmark → neutral prior

  PERFORM public.record_model_benchmark(p_model_registry_id => v_reg, p_task_type => 'chat', p_overall => 0.95);

  v_res1 := public.aisha_resolve_clow_backend(
    jsonb_build_object('purpose', 'fb', 'task_kind', 'chat'),
    jsonb_build_object('serviceable_slugs', jsonb_build_array(v_prov)));
  v_s1 := (v_res1->'top'->>'score')::numeric;

  IF v_s0 IS NULL OR v_s1 IS NULL THEN RAISE EXCEPTION 'S9: missing score (% / %)', v_s0, v_s1; END IF;
  IF NOT (v_s1 > v_s0) THEN RAISE EXCEPTION 'S9: curated benchmark must raise score (%.4f -> %.4f)', v_s0, v_s1; END IF;

  DELETE FROM public.ai_model_benchmarks WHERE model_registry_id = v_reg;
  DELETE FROM public.ai_model_registry   WHERE id = v_reg;
  DELETE FROM public.ai_provider_registry WHERE slug = v_prov;
END $$;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("advisory proposal machinery is callable + risk-evaluated (create → risk)", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_sfx  text := substr(md5(random()::text), 1, 8);
  v_prop jsonb;
  v_pid  uuid;
  v_risk text;
BEGIN
  ${SERVICE_CLAIMS}

  -- 'dirigent' is a seeded agent_catalog slug (FK improvement_proposals.agent_slug → agent_catalog.slug)
  v_prop := public.fn_create_improvement_proposal(
    'dirigent', 'task_spend', 'e2e proposal',
    jsonb_build_object('anomaly_key', 'e2e_' || v_sfx, 'estimate', 1),
    'E2E Proposal ' || v_sfx);
  v_pid := (v_prop->>'proposal_id')::uuid;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'S9: proposal not created, got %', v_prop; END IF;

  v_risk := public.fn_evaluate_proposal_risk('dirigent', 'task_spend', jsonb_build_object('estimate', 1));
  IF v_risk NOT IN ('low', 'medium', 'high', 'critical') THEN RAISE EXCEPTION 'S9: invalid risk %', v_risk; END IF;

  -- NOTE: fn_record_proposal_outcome needs the Postgres role GUC = service_role (not jwt claims) AND an
  -- 'applied' proposal with story-scoped telemetry to compute baseline→delta — that closed loop is
  -- acceptance-level (see E2E_ORGANISM_BLUEPRINTS S9 + the it.skip stub). Here we prove create + risk-gating.

  DELETE FROM public.improvement_proposals WHERE id = v_pid;
END $$;
`);
    expect(run).not.toThrow();
  });
});
