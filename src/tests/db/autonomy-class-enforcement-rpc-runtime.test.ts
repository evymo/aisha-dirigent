import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * autonomy_class enforcement — real-DB runtime test (throwaway pg17 via `npm run test:db`, in CI).
 *
 * ai_runtime_registry.autonomy_class carries ENFORCEMENT semantics — 'supervised' = "every
 * action gated by human review" — that NO decision function read until fn_admit_clow gained
 * axis 5. This proves the axis IN ISOLATION and BOTH DIRECTIONS: a read-only, low-criticality
 * clow on hermes (read_only + semi) is ADMITTED straight to 'allow' (spend / runtime /
 * capability / risk all allow, and 'semi' adds nothing); flip ONLY hermes.autonomy_class to
 * 'supervised' and the SAME clow now ASKS (human review) — driven solely by the autonomy axis.
 *
 * This is the CLASS gate for the fix: it fails if autonomy_class stops being enforced (the
 * 'supervised' → allow regression) OR if it over-gates 'semi' (the 'semi' → ask regression).
 * RAISE inside the DO block → non-zero psql exit → execFileSync throws → test fails.
 */
const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("autonomy_class enforcement RPC Runtime");
});

const HEADER = "\\set ON_ERROR_STOP on\n";

describe("fn_admit_clow autonomy axis (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "'supervised' runtime forces ask with every other axis allowing; 'semi' does not",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_user uuid; v_clow jsonb; v_admit jsonb; v_dec text; v_autonomy text;
BEGIN
  SELECT u.id INTO v_user FROM aisha_auth.users u ORDER BY u.created_at LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'fixture: no user seeded'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  -- A minimal read-only clow on hermes (read_only + semi in the seed): no write / internet /
  -- tool needs and no criticality, so the spend, runtime, capability and risk axes all allow.
  v_clow := jsonb_build_object('purpose', 'autonomy axis probe', 'runtime', 'hermes');

  -- BASELINE — hermes ships 'semi' → the autonomy axis allows → the whole verdict is 'allow'.
  UPDATE public.ai_runtime_registry SET autonomy_class = 'semi' WHERE slug = 'hermes';
  v_admit    := public.fn_admit_clow(v_clow, '{}'::jsonb);
  v_dec      := v_admit->>'decision';
  v_autonomy := v_admit->'axis_results'->'autonomy'->>'decision';
  IF v_autonomy <> 'allow' THEN
    RAISE EXCEPTION 'semi hermes: autonomy axis should allow, got % (axes=%)', v_autonomy, v_admit->'axis_results';
  END IF;
  IF v_dec <> 'allow' THEN
    RAISE EXCEPTION 'semi hermes: expected verdict allow (all axes low), got % (axes=%)', v_dec, v_admit->'axis_results';
  END IF;

  -- ENFORCEMENT — flip ONLY autonomy_class to 'supervised': the SAME clow now ASKS, driven by
  -- the autonomy axis alone (spend / runtime / capability / risk are unchanged and still allow).
  UPDATE public.ai_runtime_registry SET autonomy_class = 'supervised' WHERE slug = 'hermes';
  v_admit    := public.fn_admit_clow(v_clow, '{}'::jsonb);
  v_dec      := v_admit->>'decision';
  v_autonomy := v_admit->'axis_results'->'autonomy'->>'decision';
  IF v_autonomy <> 'ask' THEN
    RAISE EXCEPTION 'supervised hermes: autonomy axis should ask, got % (axes=%)', v_autonomy, v_admit->'axis_results';
  END IF;
  IF v_dec <> 'ask' THEN
    RAISE EXCEPTION 'supervised hermes: expected verdict ask (autonomy forces it), got % (axes=%)', v_dec, v_admit->'axis_results';
  END IF;
  IF v_admit->>'awaiting' <> 'supervision_approval' THEN
    RAISE EXCEPTION 'supervised hermes: awaiting should be supervision_approval, got %', v_admit->>'awaiting';
  END IF;

  -- Restore the seeded value (throwaway DB is discarded anyway, but keep it clean for siblings).
  UPDATE public.ai_runtime_registry SET autonomy_class = 'semi' WHERE slug = 'hermes';
  RAISE NOTICE 'autonomy axis proven: semi=allow, supervised=ask';
END $$;`);
      expect(() => run()).not.toThrow();
    },
  );
});
