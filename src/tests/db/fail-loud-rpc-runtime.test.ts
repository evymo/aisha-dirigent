import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { HEADER, SERVICE_CLAIMS } from "./_e2e-spine";

/**
 * S8 — Fail-loud organs (the organism "hurts loudly"): no silent fallbacks. Against a real DB.
 *
 *  - normalize_task_kind never DROPS a kind — it normalizes dirty input (robustness, open taxonomy).
 *  - aisha_resolve_clow_backend with cloud_forbidden + only-cloud available → resolved:false
 *    (no fallback to a forbidden backend).
 *  - fn_admit_clow: a write-needing task on a non-write runtime is NOT silently allowed.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("S8 fail-loud");
});

describe("S8 — fail-loud invariants (local DB)", () => {
  it.skipIf(!dbAvailable)("resolver refuses (no fallback) and admission does not silently allow", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_sfx  text := substr(md5(random()::text), 1, 8);
  v_prov text := 'e2e_cloud_' || v_sfx;
  v_mod  text := 'e2e_cloudmodel_' || v_sfx;
  v_reg  uuid;
  v_res  jsonb;
  v_admit jsonb;
BEGIN
  ${SERVICE_CLAIMS}

  -- normalize must transform, never drop (open, non-ossifying taxonomy)
  IF public.normalize_task_kind('  Foo Bar ') <> 'foo_bar' THEN
    RAISE EXCEPTION 'S8: normalize_task_kind dropped/garbled input -> %', public.normalize_task_kind('  Foo Bar ');
  END IF;

  -- only a CLOUD provider available
  INSERT INTO public.ai_provider_registry (slug, display_name, backend_kind, auth_kind, is_enabled, last_health_status)
  VALUES (v_prov, 'E2E Cloud', 'direct_cloud', 'bearer', true, 'healthy');
  INSERT INTO public.ai_model_registry (provider, model_id) VALUES (v_prov, v_mod) RETURNING id INTO v_reg;

  -- FAIL-LOUD #1: cloud_forbidden + only-cloud → must NOT resolve (no fallback to forbidden backend)
  v_res := public.aisha_resolve_clow_backend(
    jsonb_build_object('purpose', 'offline only', 'task_kind', 'chat', 'cloud_forbidden', true),
    jsonb_build_object('serviceable_slugs', jsonb_build_array(v_prov)));
  IF (v_res->>'resolved')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'S8: cloud_forbidden with only-cloud must resolve=false, got %', v_res;
  END IF;

  -- FAIL-LOUD #2: a write-needing task on a non-write runtime must not be silently allowed
  v_admit := public.fn_admit_clow(
    jsonb_build_object('purpose', 'needs write', 'runtime', 'direct_llm', 'needs_write', true),
    jsonb_build_object('story_id', gen_random_uuid()));
  IF v_admit->>'decision' = 'allow' THEN
    RAISE EXCEPTION 'S8: needs_write on direct_llm must not be silently allowed, got %', v_admit;
  END IF;

  DELETE FROM public.ai_model_registry   WHERE id = v_reg;
  DELETE FROM public.ai_provider_registry WHERE slug = v_prov;
END $$;
`);
    expect(run).not.toThrow();
  });
});
