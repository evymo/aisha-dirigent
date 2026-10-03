import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { HEADER, SERVICE_CLAIMS } from "./_e2e-spine";

/**
 * S1 — Brain / decision matrix (Proof Harness #1) against a real cold-started DB (`npm run test:db`).
 *
 * Proves the heart of the organism: aisha_resolve_clow_backend picks the EXPECTED winner from a
 * curated benchmark, and the choice is DYNAMIC — constraining serviceable_slugs flips the winner
 * (the same task resolves to a different model). This is the "branching / adaptive selection" base.
 *
 * Deterministic: scores are driven by a curated record_model_benchmark (overall 0.9 vs 0.5); the two
 * providers are otherwise identical so overall_score decides. Repeatable: unique slugs + full cleanup.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("S1 brain decision matrix");
});

describe("S1 — aisha_resolve_clow_backend decision matrix (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "picks the curated winner and re-picks dynamically when serviceable_slugs change",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_sfx  text := substr(md5(random()::text), 1, 8);
  v_provA text := 'e2e_provA_' || v_sfx;
  v_provB text := 'e2e_provB_' || v_sfx;
  v_modA  text := 'e2e_modelA_' || v_sfx;
  v_modB  text := 'e2e_modelB_' || v_sfx;
  v_regA uuid;
  v_regB uuid;
  v_res  jsonb;
  v_dyn  jsonb;
BEGIN
  ${SERVICE_CLAIMS}

  -- two enabled+healthy providers, one chat model each (identical except the benchmark)
  INSERT INTO public.ai_provider_registry (slug, display_name, backend_kind, auth_kind, is_enabled, last_health_status)
  VALUES (v_provA, 'E2E Provider A', 'direct_cloud', 'bearer', true, 'healthy'),
         (v_provB, 'E2E Provider B', 'direct_cloud', 'bearer', true, 'healthy');
  INSERT INTO public.ai_model_registry (provider, model_id) VALUES (v_provA, v_modA) RETURNING id INTO v_regA;
  INSERT INTO public.ai_model_registry (provider, model_id) VALUES (v_provB, v_modB) RETURNING id INTO v_regB;

  -- curated quality: A is better at 'chat' → deterministic winner
  PERFORM public.record_model_benchmark(p_model_registry_id => v_regA, p_task_type => 'chat', p_overall => 0.9);
  PERFORM public.record_model_benchmark(p_model_registry_id => v_regB, p_task_type => 'chat', p_overall => 0.5);

  -- resolve over both → A must win
  v_res := public.aisha_resolve_clow_backend(
    jsonb_build_object('purpose', 'e2e chat', 'task_kind', 'chat'),
    jsonb_build_object('serviceable_slugs', jsonb_build_array(v_provA, v_provB)));
  IF (v_res->>'resolved')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'S1: expected resolved=true, got %', v_res;
  END IF;
  IF v_res->'top'->>'model_id' <> v_modA THEN
    RAISE EXCEPTION 'S1: expected winner %, got %', v_modA, v_res->'top'->>'model_id';
  END IF;

  -- DYNAMICS: restrict serviceable to provider B → the SAME task must now resolve to B
  v_dyn := public.aisha_resolve_clow_backend(
    jsonb_build_object('purpose', 'e2e chat', 'task_kind', 'chat'),
    jsonb_build_object('serviceable_slugs', jsonb_build_array(v_provB)));
  IF v_dyn->'top'->>'model_id' <> v_modB THEN
    RAISE EXCEPTION 'S1 dynamics: serviceable=[B] expected %, got %', v_modB, v_dyn->'top'->>'model_id';
  END IF;

  -- cleanup (idempotent, repeatable)
  DELETE FROM public.ai_model_benchmarks WHERE model_registry_id IN (v_regA, v_regB);
  DELETE FROM public.ai_model_registry   WHERE id IN (v_regA, v_regB);
  DELETE FROM public.ai_provider_registry WHERE slug IN (v_provA, v_provB);
END $$;
`);
      expect(run).not.toThrow();
    },
  );
});
